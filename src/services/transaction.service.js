import { LIMITS, UNDO_WINDOW_SECONDS } from "../constants/enums.js";
import { ERROR_CODES } from "../constants/error-codes.js";
import { HTTP_STATUS } from "../constants/http-status.js";
import * as installmentPlanRepository from "../repositories/installment-plan.repository.js";
import * as recurrenceRepository from "../repositories/recurrence.repository.js";
import * as transactionRepository from "../repositories/transaction.repository.js";
import * as userRepository from "../repositories/user.repository.js";
import { ApiError } from "../utils/api-error.js";
import { toTransactionDto } from "../utils/dto.js";
import { parseQueryAmount, splitInstalments } from "../utils/money.js";
import { afterCursorFilter, decodeCursor, toPage } from "../utils/pagination.js";
import {
  addMonthsClamped,
  instantAt,
  localDateOf,
  localMonthOf,
  localTimeOf,
  nextOccurrenceDate,
} from "../utils/time.js";
import { withTransaction } from "../utils/transaction.js";
import { resolveEntryReferences } from "./ledger-rules.service.js";

const notFound = () =>
  new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND, "Transaction not found");
const badRequest = (code, message, details) =>
  new ApiError(HTTP_STATUS.BAD_REQUEST, code, message, details);

async function assertRecurrenceCapacity(userId) {
  if ((await recurrenceRepository.countNotStopped(userId)) >= LIMITS.activeRecurrences) {
    throw new ApiError(
      HTTP_STATUS.CONFLICT,
      ERROR_CODES.LIMIT_REACHED,
      `You can have at most ${LIMITS.activeRecurrences} active repeat rules`,
    );
  }
}

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;
const OPTIONAL_REFS = ["categoryId", "toAccountId", "note"];

async function currencyOf(userId) {
  const user = await userRepository.findById(userId);
  return user.settings.currencyCode;
}

function localFields(occurredAt, tzid) {
  return {
    occurredAt,
    tzid,
    localDate: localDateOf(occurredAt, tzid),
    localMonth: localMonthOf(occurredAt, tzid),
  };
}

// Only keeps optional fields that carry a value, so nothing is stored as null.
function entryDoc(input, currencyCode, createdOn) {
  const doc = {
    type: input.type,
    amountMinor: input.amountMinor,
    currencyCode,
    accountId: input.accountId,
    createdOn,
    ...localFields(input.occurredAt, input.tzid),
  };
  for (const key of OPTIONAL_REFS) if (input[key]) doc[key] = input[key];
  return doc;
}

function assertRepeatRange(repeat, startsOn) {
  if (repeat?.endsOn && repeat.endsOn < startsOn) {
    throw badRequest(ERROR_CODES.VALIDATION_ERROR, "Request validation failed", [
      { field: "body.repeat.endsOn", message: "must not be before the entry date" },
    ]);
  }
}

function assertInstalmentsAllowed(input, account) {
  if (input.type !== "expense" || account.type !== "credit_card") {
    throw badRequest(
      ERROR_CODES.INSTALMENTS_NOT_ALLOWED,
      "Instalments are only for expenses on a credit card",
    );
  }
}

const MAX_RECURRING_PAST_MS = 366 * 24 * 60 * 60 * 1000;

// Repeating or instalment entries may only start up to a year back, so catch-up stays small.
function assertRecurringStart(input) {
  if (input.occurredAt.getTime() < Date.now() - MAX_RECURRING_PAST_MS) {
    throw badRequest(ERROR_CODES.VALIDATION_ERROR, "Request validation failed", [
      {
        field: "body.occurredAt",
        message: "cannot be more than one year in the past for repeating or instalment entries",
      },
    ]);
  }
}

function assertInstalmentsSplittable(input) {
  if (input.amountMinor < input.instalments.months) {
    throw badRequest(ERROR_CODES.VALIDATION_ERROR, "Request validation failed", [
      {
        field: "body.instalments.months",
        message: "Amount is too small to split into that many instalments",
      },
    ]);
  }
}

function createWithRepeat(userId, doc, input) {
  const { repeat } = input;
  const anchorDay = Number(doc.localDate.slice(8));
  const anchorMonth = Number(doc.localDate.slice(5, 7));
  return withTransaction(async (session) => {
    const rule = await recurrenceRepository.create(
      userId,
      {
        template: {
          type: input.type,
          amountMinor: input.amountMinor,
          categoryId: input.categoryId ?? undefined,
          accountId: input.accountId,
          toAccountId: input.toAccountId ?? undefined,
          note: input.note || undefined,
        },
        tzid: input.tzid,
        localTime: localTimeOf(input.occurredAt, input.tzid),
        freq: repeat.freq,
        interval: repeat.interval,
        anchorDay,
        anchorMonth,
        startsOn: doc.localDate,
        endsOn: repeat.endsOn ?? undefined,
        nextOccurrenceDate: nextOccurrenceDate(doc.localDate, {
          freq: repeat.freq,
          interval: repeat.interval,
          anchorDay,
          anchorMonth,
        }),
        lastGeneratedFor: doc.localDate,
      },
      { session },
    );
    return transactionRepository.create(
      userId,
      { ...doc, recurrenceId: rule._id, occurrenceDate: doc.localDate },
      { session },
    );
  });
}

function createWithInstalments(userId, doc, input) {
  const { months } = input.instalments;
  const time = localTimeOf(input.occurredAt, input.tzid);
  const amounts = splitInstalments(input.amountMinor, months);
  return withTransaction(async (session) => {
    const plan = await installmentPlanRepository.create(
      userId,
      {
        accountId: input.accountId,
        totalMinor: input.amountMinor,
        months,
        startsOn: doc.localDate,
      },
      { session },
    );
    const docs = amounts.map((amountMinor, index) => {
      const date = addMonthsClamped(doc.localDate, index);
      return {
        ...doc,
        amountMinor,
        ...(index > 0 && {
          occurredAt: instantAt(date, time, input.tzid),
          localDate: date,
          localMonth: date.slice(0, 7),
        }),
        installmentPlanId: plan._id,
        installmentIndex: index + 1,
        installmentCount: months,
      };
    });
    const created = await transactionRepository.insertMany(userId, docs, { session });
    return created[0];
  });
}

export async function createTransaction(userId, input, createdOn) {
  if (input.repeat && input.instalments) {
    throw badRequest(
      ERROR_CODES.REPEAT_WITH_INSTALMENTS,
      "An entry cannot both repeat and be split into instalments",
    );
  }
  if (input.repeat || input.instalments) assertRecurringStart(input);
  const { account } = await resolveEntryReferences(userId, input);
  if (input.instalments) {
    assertInstalmentsAllowed(input, account);
    assertInstalmentsSplittable(input);
  }
  if (input.repeat) await assertRecurrenceCapacity(userId);

  const doc = entryDoc(input, await currencyOf(userId), createdOn);
  assertRepeatRange(input.repeat, doc.localDate);

  let created;
  if (input.repeat) created = await createWithRepeat(userId, doc, input);
  else if (input.instalments) created = await createWithInstalments(userId, doc, input);
  else created = await transactionRepository.create(userId, doc);
  return toTransactionDto(created);
}

async function loadActive(userId, id) {
  const entry = await transactionRepository.findActive(userId, id);
  if (!entry) throw notFound();
  return entry;
}

export async function getTransaction(userId, id) {
  return toTransactionDto(await loadActive(userId, id));
}

function mergeEntry(existing, patch) {
  const pick = (key) => (key in patch ? patch[key] : existing[key]);
  return {
    type: pick("type"),
    amountMinor: pick("amountMinor"),
    categoryId: pick("categoryId"),
    accountId: pick("accountId"),
    toAccountId: pick("toAccountId"),
    occurredAt: pick("occurredAt"),
    tzid: pick("tzid"),
    note: pick("note"),
  };
}

export async function updateTransaction(userId, id, patch) {
  const existing = await loadActive(userId, id);
  const merged = mergeEntry(existing, patch);
  await resolveEntryReferences(userId, merged, {
    allowArchivedIds: [existing.accountId, existing.toAccountId, existing.categoryId],
  });

  const set = {
    type: merged.type,
    amountMinor: merged.amountMinor,
    accountId: merged.accountId,
    ...localFields(merged.occurredAt, merged.tzid),
  };
  const unset = [];
  for (const key of OPTIONAL_REFS) {
    if (merged[key]) set[key] = merged[key];
    else unset.push(key);
  }
  const updated = await transactionRepository.updateActive(userId, id, set, unset);
  if (!updated) throw notFound();
  return toTransactionDto(updated);
}

export async function deleteTransaction(userId, id) {
  const deletedAt = new Date();
  const deleted = await transactionRepository.softDelete(userId, id, deletedAt);
  if (!deleted) throw notFound();
  return {
    id: String(deleted._id),
    deletedAt: deletedAt.toISOString(),
    undoUntil: new Date(deletedAt.getTime() + UNDO_WINDOW_SECONDS * 1000).toISOString(),
  };
}

export async function restoreTransaction(userId, id) {
  const restored = await transactionRepository.restore(userId, id);
  if (!restored) throw notFound();
  return toTransactionDto(restored);
}

export async function duplicateTransaction(userId, id, body, createdOn) {
  const original = await loadActive(userId, id);
  const input = {
    type: original.type,
    amountMinor: original.amountMinor,
    categoryId: original.categoryId,
    accountId: original.accountId,
    toAccountId: original.toAccountId,
    note: original.note,
    occurredAt: body.occurredAt ?? new Date(),
    tzid: body.tzid ?? original.tzid,
  };
  await resolveEntryReferences(userId, input);
  const created = await transactionRepository.create(
    userId,
    entryDoc(input, await currencyOf(userId), createdOn),
  );
  return toTransactionDto(created);
}

// Turns validated query filters into repository filters; "q" also matches category/account names and exact amounts.
export async function resolveFilters(userId, query) {
  const { q, from, to, type, accountId, categoryId, min, max } = query;
  const filters = { from, to, type, accountId, categoryId, min, max };
  if (!q) return filters;

  const pattern = q.replace(REGEX_SPECIALS, "\\$&");
  const [categoryIds, accountIds, currencyCode] = await Promise.all([
    transactionRepository.findCategoryIdsByName(userId, pattern),
    transactionRepository.findAccountIdsByName(userId, pattern),
    currencyOf(userId),
  ]);
  return {
    ...filters,
    search: { pattern, categoryIds, accountIds, amountMinor: parseQueryAmount(q, currencyCode) },
  };
}

export async function listTransactions(userId, query) {
  const filters = await resolveFilters(userId, query);
  const rows = await transactionRepository.findFiltered(userId, filters, {
    limit: query.limit + 1,
    cursorFilter: afterCursorFilter(decodeCursor(query.cursor)),
  });
  const { items, nextCursor, limit } = toPage(rows, query.limit);
  return { items: items.map(toTransactionDto), page: { nextCursor, limit } };
}

export async function summarizeTransactions(userId, query) {
  return transactionRepository.summarizeFiltered(userId, await resolveFilters(userId, query));
}

export async function getDay(userId, localDate) {
  const filters = { from: localDate, to: localDate };
  const [rows, totals] = await Promise.all([
    transactionRepository.findFiltered(userId, filters, { limit: 500 }),
    transactionRepository.summarizeFiltered(userId, filters),
  ]);
  return {
    localDate,
    inMinor: totals.incomeMinor,
    outMinor: totals.expenseMinor,
    count: totals.count,
    items: rows.map(toTransactionDto),
  };
}
