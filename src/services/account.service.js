import { LIMITS } from "../constants/enums.js";
import { ERROR_CODES } from "../constants/error-codes.js";
import { HTTP_STATUS } from "../constants/http-status.js";
import * as accountRepository from "../repositories/account.repository.js";
import * as transactionRepository from "../repositories/transaction.repository.js";
import * as userRepository from "../repositories/user.repository.js";
import { ApiError } from "../utils/api-error.js";
import { computeBalances, summarize } from "../utils/balances.js";
import { toTransactionDto } from "../utils/dto.js";
import { percentOf } from "../utils/money.js";
import { isDuplicateKeyError, withTransaction } from "../utils/transaction.js";
import { addMonthsClamped, currentMonthIn, todayIn } from "../utils/time.js";

const CREDIT_ONLY_FIELDS = ["creditLimitMinor", "statementDay", "dueDay"];
const EDITABLE_FIELDS = [
  "name",
  "type",
  "icon",
  "color",
  "last4",
  "openingBalanceMinor",
  "linkedAccountId",
  "creditLimitMinor",
  "statementDay",
  "dueDay",
];

const isSet = (value) => value !== undefined && value !== null;
const notFound = () =>
  new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND, "Account not found");
const conflict = (code, message) => new ApiError(HTTP_STATUS.CONFLICT, code, message);
const invalid = (field, message) =>
  new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, "Request validation failed", [
    { field: `body.${field}`, message },
  ]);

// Statement maths (all in the user's zone, from the statement and due days).

export function lastStatementDateOf(today, statementDay) {
  const thisMonth = addMonthsClamped(today, 0, statementDay);
  return today >= thisMonth ? thisMonth : addMonthsClamped(today, -1, statementDay);
}

export function dueDateAfter(reference, dueDay) {
  const sameMonth = addMonthsClamped(reference, 0, dueDay);
  return sameMonth > reference ? sameMonth : addMonthsClamped(reference, 1, dueDay);
}

// The cache holds promises, so cards sharing a statement date share one aggregation.
async function statementOwed(userId, card, lastStatementDate, cache) {
  if (!cache.has(lastStatementDate)) {
    cache.set(
      lastStatementDate,
      transactionRepository.aggregateAccountFlows(userId, { untilLocalDate: lastStatementDate }),
    );
  }
  const flows = await cache.get(lastStatementDate);
  return computeBalances([card], flows).get(String(card._id)).owedMinor;
}

async function creditCardFields(userId, card, owedMinor, { today, cache }) {
  const lastStatementDate = card.statementDay
    ? lastStatementDateOf(today, card.statementDay)
    : null;
  const dueReference = lastStatementDate ?? today;
  return {
    owedMinor,
    limitUsedPct: card.creditLimitMinor
      ? percentOf(Math.max(owedMinor, 0), card.creditLimitMinor)
      : null,
    statementMinor: lastStatementDate
      ? await statementOwed(userId, card, lastStatementDate, cache)
      : null,
    lastStatementDate,
    dueDate: card.dueDay ? dueDateAfter(dueReference, card.dueDay) : null,
  };
}

function baseDto(account) {
  return {
    id: String(account._id),
    name: account.name,
    type: account.type,
    icon: account.icon,
    color: account.color,
    last4: account.last4 ?? null,
    openingBalanceMinor: account.openingBalanceMinor,
    linkedAccountId: account.linkedAccountId ? String(account.linkedAccountId) : null,
    creditLimitMinor: account.creditLimitMinor ?? null,
    statementDay: account.statementDay ?? null,
    dueDay: account.dueDay ?? null,
    isDefault: account.isDefault,
    sortOrder: account.sortOrder,
    archived: Boolean(account.archivedAt),
    createdAt: account.createdAt.toISOString(),
  };
}

// Every DTO of the user's accounts (archived included); balances always use all accounts for the debit-card roll-up.
async function buildAllDtos(userId) {
  const [accounts, user, flows] = await Promise.all([
    accountRepository.listByUser(userId, { includeArchived: true }),
    userRepository.findById(userId),
    // Balances are "as of now": future-dated entries (later instalments, post-dated items) don't count yet.
    transactionRepository.aggregateAccountFlows(userId, { until: new Date() }),
  ]);
  const balances = computeBalances(accounts, flows);
  const tzid = user.settings.tzid;
  const context = { today: todayIn(tzid), cache: new Map() };

  const dtos = await Promise.all(
    accounts.map(async (account) => {
      const balance = balances.get(String(account._id));
      const extra =
        account.type === "credit_card"
          ? await creditCardFields(userId, account, balance.owedMinor, context)
          : balance;
      return { ...baseDto(account), ...extra };
    }),
  );
  return { accounts, balances, dtos };
}

async function dtoOf(userId, accountId) {
  const { dtos } = await buildAllDtos(userId);
  return dtos.find((dto) => dto.id === String(accountId));
}

export async function listAccounts(userId, { includeArchived }) {
  const { dtos } = await buildAllDtos(userId);
  return includeArchived ? dtos : dtos.filter((dto) => !dto.archived);
}

export async function getSummary(userId) {
  const { accounts, balances } = await buildAllDtos(userId);
  return summarize(accounts, balances);
}

export async function getAccount(userId, accountId, { month }) {
  const account = await accountRepository.findOwned(userId, accountId);
  if (!account) throw notFound();

  const user = await userRepository.findById(userId);
  const activityMonth = month ?? currentMonthIn(user.settings.tzid);
  const debitIds =
    account.type === "bank" ? await accountRepository.findLinkedDebitIds(userId, account._id) : [];
  const [dto, activity] = await Promise.all([
    dtoOf(userId, accountId),
    accountRepository.monthActivity(userId, account._id, debitIds, activityMonth),
  ]);
  return {
    ...dto,
    activity: {
      month: activityMonth,
      inMinor: activity.inMinor,
      outMinor: activity.outMinor,
      recent: activity.recent.map(toTransactionDto),
    },
  };
}

// Rules that depend on the account's final shape, used by create and patch.

function checkFieldCombination(fields) {
  if (fields.type !== "credit_card") {
    for (const key of CREDIT_ONLY_FIELDS) {
      if (isSet(fields[key])) throw invalid(key, "is only allowed for credit cards");
    }
  }
  if (fields.type !== "debit_card" && fields.linkedAccountId) {
    throw invalid("linkedAccountId", "is only allowed for debit cards");
  }
  const opening = fields.openingBalanceMinor ?? 0;
  if (["credit_card", "debit_card"].includes(fields.type) && opening < 0) {
    throw invalid("openingBalanceMinor", "cannot be negative for this account type");
  }
  if (fields.type === "debit_card" && opening !== 0) {
    throw invalid("openingBalanceMinor", "must be 0 for a debit card");
  }
}

async function checkLinkedBank(userId, fields, { keepLinkedId } = {}) {
  if (fields.type !== "debit_card") return;
  if (!fields.linkedAccountId) throw invalid("linkedAccountId", "is required for a debit card");
  const bank = await accountRepository.findOwned(userId, fields.linkedAccountId);
  if (!bank) throw notFound();
  if (bank.type !== "bank") throw invalid("linkedAccountId", "must be a bank account");
  if (bank.archivedAt && String(bank._id) !== String(keepLinkedId)) {
    throw conflict(ERROR_CODES.ACCOUNT_ARCHIVED, `${bank.name} is archived`);
  }
}

const nameTaken = () =>
  conflict(ERROR_CODES.NAME_TAKEN, "You already have an account with this name");

async function assertNameFree(userId, name, excludeId) {
  const taken = await accountRepository.isNameTaken(userId, name.toLowerCase(), { excludeId });
  if (taken) throw nameTaken();
}

// The unique index on activeNameKey is the real guard; a lost race surfaces as a duplicate key.
async function guardName(write) {
  try {
    return await write();
  } catch (error) {
    if (isDuplicateKeyError(error)) throw nameTaken();
    throw error;
  }
}

async function assertUnderLimit(userId) {
  if ((await accountRepository.countActiveByUser(userId)) >= LIMITS.accounts) {
    throw conflict(
      ERROR_CODES.LIMIT_REACHED,
      `You can have at most ${LIMITS.accounts} active accounts`,
    );
  }
}

function withoutNulls(body) {
  return Object.fromEntries(Object.entries(body).filter(([, value]) => isSet(value)));
}

export async function createAccount(userId, body) {
  const fields = { openingBalanceMinor: 0, ...withoutNulls(body) };
  checkFieldCombination(fields);
  await checkLinkedBank(userId, fields);
  await assertNameFree(userId, fields.name);
  await assertUnderLimit(userId);

  const [count, maxOrder] = await Promise.all([
    accountRepository.countByUser(userId),
    accountRepository.maxSortOrder(userId),
  ]);
  const nameKey = fields.name.toLowerCase();
  const created = await guardName(() =>
    accountRepository.create(userId, {
      ...fields,
      nameKey,
      activeNameKey: nameKey,
      isDefault: count === 0,
      sortOrder: maxOrder + 1,
    }),
  );
  return dtoOf(userId, created._id);
}

function mergeForPatch(existing, body) {
  const merged = Object.fromEntries(
    EDITABLE_FIELDS.filter((key) => isSet(existing[key])).map((key) => [key, existing[key]]),
  );
  for (const [key, value] of Object.entries(body)) {
    if (!isSet(value)) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

async function assertTypeChangeAllowed(userId, existing, body) {
  if (body.type === undefined || body.type === existing.type) return;
  const locked =
    (await transactionRepository.isAccountReferenced(userId, existing._id)) ||
    (await accountRepository.hasLinkedDebitCards(userId, existing._id));
  if (locked) {
    throw conflict(ERROR_CODES.TYPE_LOCKED, "The account type can't change once it has activity");
  }
}

export async function updateAccount(userId, accountId, body) {
  const existing = await accountRepository.findOwned(userId, accountId);
  if (!existing) throw notFound();

  await assertTypeChangeAllowed(userId, existing, body);
  const merged = mergeForPatch(existing, body);
  checkFieldCombination(merged);
  await checkLinkedBank(userId, merged, { keepLinkedId: existing.linkedAccountId });
  if (body.name !== undefined && !existing.archivedAt) {
    await assertNameFree(userId, merged.name, existing._id);
  }

  const set = {};
  const unset = {};
  for (const [key, value] of Object.entries(body)) {
    if (!isSet(value)) unset[key] = 1;
    else set[key] = value;
  }
  if (set.name) {
    set.nameKey = set.name.toLowerCase();
    if (!existing.archivedAt) set.activeNameKey = set.nameKey;
  }
  await guardName(() => accountRepository.updateOwned(userId, accountId, { set, unset }));
  return dtoOf(userId, accountId);
}

export async function archiveAccount(userId, accountId) {
  const existing = await accountRepository.findOwned(userId, accountId);
  if (!existing) throw notFound();
  if (!existing.archivedAt) {
    await accountRepository.updateOwned(
      userId,
      accountId,
      { set: { archivedAt: new Date(), isDefault: false }, unset: { activeNameKey: 1 } },
      {},
    );
  }
  return dtoOf(userId, accountId);
}

export async function unarchiveAccount(userId, accountId) {
  const existing = await accountRepository.findOwned(userId, accountId);
  if (!existing) throw notFound();
  if (existing.archivedAt) {
    await assertNameFree(userId, existing.name, existing._id);
    await assertUnderLimit(userId);
    await guardName(() =>
      accountRepository.updateOwned(userId, accountId, {
        set: { activeNameKey: existing.nameKey },
        unset: { archivedAt: 1 },
      }),
    );
  }
  return dtoOf(userId, accountId);
}

export async function setDefaultAccount(userId, accountId) {
  const existing = await accountRepository.findOwned(userId, accountId);
  if (!existing) throw notFound();
  if (existing.archivedAt) {
    throw conflict(ERROR_CODES.ACCOUNT_ARCHIVED, "An archived account can't be the default");
  }
  await withTransaction(async (session) => {
    await accountRepository.clearDefault(userId, { exceptId: accountId, session });
    await accountRepository.updateOwned(
      userId,
      accountId,
      { set: { isDefault: true } },
      { session },
    );
  });
  return dtoOf(userId, accountId);
}

async function isInUse(userId, accountId) {
  const [referenced, templates, linked] = await Promise.all([
    transactionRepository.isAccountReferenced(userId, accountId),
    accountRepository.isUsedByTemplates(userId, accountId),
    accountRepository.hasLinkedDebitCards(userId, accountId),
  ]);
  return referenced || templates || linked;
}

export async function deleteAccount(userId, accountId) {
  const existing = await accountRepository.findOwned(userId, accountId);
  if (!existing) throw notFound();
  if (await isInUse(userId, accountId)) {
    throw conflict(ERROR_CODES.IN_USE, "This account is in use; archive it instead");
  }
  await accountRepository.deleteOwned(userId, accountId);
}

export async function reorderAccounts(userId, ids) {
  if (new Set(ids).size !== ids.length) throw invalid("ids", "must not contain duplicates");
  const owned = await accountRepository.findOwnedByIds(userId, ids);
  if (owned.length !== ids.length) throw notFound();

  const all = await accountRepository.listByUser(userId, { includeArchived: true });
  const listed = new Set(ids);
  const rest = all.map((account) => String(account._id)).filter((id) => !listed.has(id));
  await accountRepository.setSortOrders(userId, [...ids, ...rest]);
  return listAccounts(userId, { includeArchived: true });
}
