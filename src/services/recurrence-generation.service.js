import { logger } from "../config/logger.js";
import * as recurrenceRepository from "../repositories/recurrence.repository.js";
import * as transactionRepository from "../repositories/transaction.repository.js";
import * as userRepository from "../repositories/user.repository.js";
import { ApiError } from "../utils/api-error.js";
import { instantAt, localDateOf, nextOccurrenceDate } from "../utils/time.js";
import { isDuplicateKeyError } from "../utils/transaction.js";
import { resolveEntryReferences } from "./ledger-rules.service.js";

// The furthest-ahead zone: if a rule is not due even there, it is not due anywhere.
const FURTHEST_AHEAD_ZONE = "Pacific/Kiritimati";
// Caps one rule's catch-up per run so a years-old daily rule cannot hog a run; the rest follows next run.
const MAX_OCCURRENCES_PER_RULE = 366;
// Caps one whole run; rules left over are picked up by the next run.
const MAX_OCCURRENCES_PER_RUN = 5000;

function buildEntry(rule, date, currencyCode) {
  const { type, amountMinor, categoryId, accountId, toAccountId, note } = rule.template;
  const entry = {
    type,
    amountMinor,
    accountId,
    currencyCode,
    occurredAt: instantAt(date, rule.localTime, rule.tzid),
    tzid: rule.tzid,
    localDate: date,
    localMonth: date.slice(0, 7),
    recurrenceId: rule._id,
    occurrenceDate: date,
    // Generated entries have no client; "web" is the neutral platform value.
    createdOn: "web",
  };
  if (categoryId) entry.categoryId = categoryId;
  if (toAccountId) entry.toAccountId = toAccountId;
  if (note) entry.note = note;
  return entry;
}

async function currencyOf(userId, cache) {
  const key = String(userId);
  if (!cache.has(key)) {
    const user = await userRepository.findById(userId);
    cache.set(key, user?.settings.currencyCode ?? null);
  }
  return cache.get(key);
}

// Inserts one occurrence. Returns "created", "skipped" (already generated) or "paused" (template no longer valid).
async function generateOne(rule, date, currencyCode) {
  try {
    await resolveEntryReferences(rule.userId, rule.template);
  } catch (error) {
    // Only a rule problem pauses the rule; anything else (a DB blip) must retry next run.
    if (!(error instanceof ApiError)) throw error;
    logger.warn(
      { ruleId: String(rule._id), code: error.code },
      "Repeat rule paused: its account or category is no longer usable",
    );
    return "paused";
  }
  try {
    await transactionRepository.insertMany(rule.userId, [buildEntry(rule, date, currencyCode)]);
    return "created";
  } catch (error) {
    if (isDuplicateKeyError(error)) return "skipped";
    throw error;
  }
}

async function processRule(rule, today, currencyCode, counts, budget) {
  let date = rule.nextOccurrenceDate;
  let lastGeneratedFor;
  let pausedAt;
  let handled = 0;

  while (date <= today && (!rule.endsOn || date <= rule.endsOn)) {
    if (handled >= MAX_OCCURRENCES_PER_RULE || counts.created >= budget) break;
    const outcome = await generateOne(rule, date, currencyCode);
    if (outcome === "paused") {
      pausedAt = new Date();
      counts.paused += 1;
      break;
    }
    counts[outcome] += 1;
    lastGeneratedFor = date;
    date = nextOccurrenceDate(date, rule);
    handled += 1;
  }

  await recurrenceRepository.advance(rule.userId, rule._id, {
    nextOccurrenceDate: date,
    lastGeneratedFor,
    pausedAt,
  });
}

// Creates every occurrence due up to today in each rule's own zone. Safe to run repeatedly and from several workers.
export async function generateDueOccurrences({
  now = new Date(),
  limit = 500,
  maxPerRun = MAX_OCCURRENCES_PER_RUN,
} = {}) {
  const coarseToday = localDateOf(now, FURTHEST_AHEAD_ZONE);
  const rules = await recurrenceRepository.findDueRulesAcrossUsers(coarseToday, limit);
  const counts = { rulesProcessed: 0, created: 0, skipped: 0, paused: 0, failed: 0 };
  const currencies = new Map();

  for (const rule of rules) {
    if (counts.created >= maxPerRun) break;
    const today = localDateOf(now, rule.tzid);
    if (rule.nextOccurrenceDate > today) continue;
    try {
      const currencyCode = await currencyOf(rule.userId, currencies);
      if (!currencyCode) continue;
      await processRule(rule, today, currencyCode, counts, maxPerRun);
      counts.rulesProcessed += 1;
    } catch (error) {
      counts.failed += 1;
      logger.error({ err: error, ruleId: String(rule._id) }, "Repeat rule generation failed");
    }
  }
  return counts;
}
