import { ERROR_CODES } from "../constants/error-codes.js";
import { HTTP_STATUS } from "../constants/http-status.js";
import * as recurrenceRepository from "../repositories/recurrence.repository.js";
import { ApiError } from "../utils/api-error.js";
import { nextOccurrenceDate, todayIn } from "../utils/time.js";

const idOrNull = (value) => (value ? String(value) : null);

function toRuleDto(rule) {
  const finished = rule.endsOn && rule.endsOn < rule.nextOccurrenceDate;
  return {
    id: String(rule._id),
    type: rule.template.type,
    amountMinor: rule.template.amountMinor,
    categoryId: idOrNull(rule.template.categoryId),
    accountId: String(rule.template.accountId),
    toAccountId: idOrNull(rule.template.toAccountId),
    note: rule.template.note ?? null,
    tzid: rule.tzid,
    localTime: rule.localTime,
    freq: rule.freq,
    interval: rule.interval,
    startsOn: rule.startsOn,
    endsOn: rule.endsOn ?? null,
    nextOccurrence: finished ? null : rule.nextOccurrenceDate,
    paused: Boolean(rule.pausedAt),
    createdAt: rule.createdAt.toISOString(),
  };
}

const notFound = () =>
  new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND, "Repeat rule not found");

// Active rules first, then by next date.
const byActiveThenNext = (a, b) =>
  Number(Boolean(a.pausedAt)) - Number(Boolean(b.pausedAt)) ||
  a.nextOccurrenceDate.localeCompare(b.nextOccurrenceDate);

export async function listRules(userId) {
  const rules = await recurrenceRepository.listNotStopped(userId);
  return rules.sort(byActiveThenNext).map(toRuleDto);
}

function buildChanges(body) {
  const set = {};
  const unset = [];
  if (body.amountMinor !== undefined) set["template.amountMinor"] = body.amountMinor;
  if ("note" in body) {
    if (body.note) set["template.note"] = body.note;
    else unset.push("template.note");
  }
  if ("endsOn" in body) {
    if (body.endsOn) set.endsOn = body.endsOn;
    else unset.push("endsOn");
  }
  return { set, unset };
}

// First occurrence on or after today in the rule's zone, so a resumed rule never backfills the paused gap.
function nextDateFromToday(rule) {
  const today = todayIn(rule.tzid);
  let date = rule.nextOccurrenceDate;
  while (date < today) date = nextOccurrenceDate(date, rule);
  return date;
}

export async function updateRule(userId, ruleId, body) {
  const existing = await recurrenceRepository.findOwnedNotStopped(userId, ruleId);
  if (!existing) throw notFound();
  if (body.endsOn && body.endsOn < existing.startsOn) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
      "Request validation failed",
      [{ field: "body.endsOn", message: "cannot be before the start date" }],
    );
  }

  const { set, unset } = buildChanges(body);
  if (body.paused === true && !existing.pausedAt) set.pausedAt = new Date();
  if (body.paused === false) {
    unset.push("pausedAt");
    if (existing.pausedAt) set.nextOccurrenceDate = nextDateFromToday(existing);
  }

  const updated = await recurrenceRepository.update(userId, ruleId, { set, unset });
  if (!updated) throw notFound();
  return toRuleDto(updated);
}

export async function stopRule(userId, ruleId) {
  if (!(await recurrenceRepository.markStopped(userId, ruleId))) throw notFound();
}
