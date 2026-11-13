import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runPurgeJob } from "../../src/jobs/purge.job.js";
import { runRecurrenceJob } from "../../src/jobs/recurrence.job.js";
import { runLocked } from "../../src/jobs/scheduler.js";
import { Account } from "../../src/models/account.model.js";
import { InstallmentPlan } from "../../src/models/installment-plan.model.js";
import { JobLock } from "../../src/models/job-lock.model.js";
import { RecurrenceRule } from "../../src/models/recurrence-rule.model.js";
import { Transaction } from "../../src/models/transaction.model.js";
import * as recurrenceRepository from "../../src/repositories/recurrence.repository.js";
import * as jobLockRepository from "../../src/repositories/job-lock.repository.js";
import { generateDueOccurrences } from "../../src/services/recurrence-generation.service.js";
import { instantAt } from "../../src/utils/time.js";
import { resetTestDb, startTestDb, stopTestDb } from "../helpers/db.js";
import { createSignedInUser, seedLedger } from "../helpers/ledger.js";

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(resetTestDb);

// 17:30 on 2026-10-20 in Asia/Kolkata.
const NOW = new Date("2026-10-20T12:00:00Z");

async function setup() {
  const me = await createSignedInUser();
  const ledger = await seedLedger(me.userId);
  const makeRule = (overrides = {}) =>
    RecurrenceRule.create({
      userId: me.userId,
      template: {
        type: "expense",
        amountMinor: 1500,
        categoryId: ledger.categories.food._id,
        accountId: ledger.accounts.savings._id,
        note: "Coffee",
      },
      tzid: "Asia/Kolkata",
      localTime: "09:00",
      freq: "daily",
      interval: 1,
      anchorDay: 17,
      anchorMonth: 10,
      startsOn: "2026-10-17",
      nextOccurrenceDate: "2026-10-17",
      ...overrides,
    });
  const entriesOf = (rule) => Transaction.find({ recurrenceId: rule._id }).sort({ localDate: 1 });
  return { ...me, ledger, makeRule, entriesOf };
}

describe("generateDueOccurrences", () => {
  it("creates the missing occurrences exactly once", async () => {
    const { makeRule, entriesOf, userId, ledger } = await setup();
    const rule = await makeRule({ nextOccurrenceDate: "2026-10-18" });
    // The first occurrence already exists (created with the rule).
    await Transaction.create({
      userId,
      type: "expense",
      amountMinor: 1500,
      currencyCode: "INR",
      categoryId: ledger.categories.food._id,
      accountId: ledger.accounts.savings._id,
      occurredAt: instantAt("2026-10-17", "09:00", "Asia/Kolkata"),
      tzid: "Asia/Kolkata",
      localDate: "2026-10-17",
      localMonth: "2026-10",
      recurrenceId: rule._id,
      occurrenceDate: "2026-10-17",
      createdOn: "web",
    });

    const first = await generateDueOccurrences({ now: NOW });
    expect(first).toEqual({ rulesProcessed: 1, created: 3, skipped: 0, paused: 0, failed: 0 });

    const entries = await entriesOf(rule);
    expect(entries.map((e) => e.localDate)).toEqual([
      "2026-10-17",
      "2026-10-18",
      "2026-10-19",
      "2026-10-20",
    ]);
    const generated = entries[3];
    expect(generated).toMatchObject({
      type: "expense",
      amountMinor: 1500,
      currencyCode: "INR",
      localMonth: "2026-10",
      occurrenceDate: "2026-10-20",
      tzid: "Asia/Kolkata",
      note: "Coffee",
      createdOn: "web",
    });
    expect(generated.occurredAt.toISOString()).toBe("2026-10-20T03:30:00.000Z");

    const updated = await RecurrenceRule.findById(rule._id);
    expect(updated.nextOccurrenceDate).toBe("2026-10-21");
    expect(updated.lastGeneratedFor).toBe("2026-10-20");

    const second = await generateDueOccurrences({ now: NOW });
    expect(second).toEqual({ rulesProcessed: 0, created: 0, skipped: 0, paused: 0, failed: 0 });
    expect(await Transaction.countDocuments({ recurrenceId: rule._id })).toBe(4);
  });

  it("treats already-generated dates as skipped", async () => {
    const { makeRule, entriesOf } = await setup();
    const rule = await makeRule();
    await runRecurrenceJob({ now: NOW });
    await RecurrenceRule.updateOne({ _id: rule._id }, { nextOccurrenceDate: "2026-10-18" });

    const result = await generateDueOccurrences({ now: NOW });

    expect(result).toEqual({ rulesProcessed: 1, created: 0, skipped: 3, paused: 0, failed: 0 });
    expect(await entriesOf(rule)).toHaveLength(4);
    expect((await RecurrenceRule.findById(rule._id)).nextOccurrenceDate).toBe("2026-10-21");
  });

  it("keeps the monthly anchor on the 31st", async () => {
    const { makeRule, entriesOf } = await setup();
    const rule = await makeRule({
      freq: "monthly",
      anchorDay: 31,
      anchorMonth: 1,
      startsOn: "2026-01-31",
      nextOccurrenceDate: "2026-01-31",
    });

    const result = await generateDueOccurrences({ now: new Date("2026-04-30T12:00:00Z") });

    expect(result.created).toBe(4);
    expect((await entriesOf(rule)).map((e) => e.localDate)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
    expect((await RecurrenceRule.findById(rule._id)).nextOccurrenceDate).toBe("2026-05-31");
  });

  it("stops at the end date", async () => {
    const { makeRule, entriesOf } = await setup();
    const rule = await makeRule({ endsOn: "2026-10-18" });

    const first = await generateDueOccurrences({ now: NOW });
    expect(first.created).toBe(2);
    expect((await entriesOf(rule)).map((e) => e.localDate)).toEqual(["2026-10-17", "2026-10-18"]);

    const second = await generateDueOccurrences({ now: NOW });
    expect(second).toEqual({ rulesProcessed: 0, created: 0, skipped: 0, paused: 0, failed: 0 });
  });

  it("pauses a rule whose account was archived", async () => {
    const { makeRule, entriesOf, ledger } = await setup();
    const rule = await makeRule();
    await Account.updateOne({ _id: ledger.accounts.savings._id }, { archivedAt: new Date() });

    const result = await generateDueOccurrences({ now: NOW });

    expect(result).toEqual({ rulesProcessed: 1, created: 0, skipped: 0, paused: 1, failed: 0 });
    expect(await entriesOf(rule)).toHaveLength(0);
    const updated = await RecurrenceRule.findById(rule._id);
    expect(updated.pausedAt).toBeInstanceOf(Date);
    expect(updated.nextOccurrenceDate).toBe("2026-10-17");
    expect((await generateDueOccurrences({ now: NOW })).rulesProcessed).toBe(0);
  });

  it("ignores paused, stopped and not-yet-due rules", async () => {
    const { makeRule } = await setup();
    await makeRule({ pausedAt: new Date() });
    await makeRule({ stoppedAt: new Date() });
    await makeRule({ nextOccurrenceDate: "2026-10-21" });

    const result = await generateDueOccurrences({ now: NOW });

    expect(result).toEqual({ rulesProcessed: 0, created: 0, skipped: 0, paused: 0, failed: 0 });
    expect(await Transaction.countDocuments({})).toBe(0);
  });

  it("decides what is due in each rule's own zone", async () => {
    const { makeRule } = await setup();
    await makeRule({
      tzid: "America/Los_Angeles",
      startsOn: "2026-10-20",
      nextOccurrenceDate: "2026-10-20",
    });

    // 03:00 UTC is still 19 October in Los Angeles.
    const early = await generateDueOccurrences({ now: new Date("2026-10-20T03:00:00Z") });
    expect(early.rulesProcessed).toBe(0);

    const later = await generateDueOccurrences({ now: new Date("2026-10-20T08:00:00Z") });
    expect(later.created).toBe(1);
    const entry = await Transaction.findOne({});
    expect(entry.occurredAt.toISOString()).toBe("2026-10-20T16:00:00.000Z");
  });

  it("uses the user's current currency", async () => {
    const { makeRule, userId } = await setup();
    await makeRule({ nextOccurrenceDate: "2026-10-20" });
    const { User } = await import("../../src/models/user.model.js");
    await User.updateOne({ _id: userId }, { "settings.currencyCode": "USD" });

    await generateDueOccurrences({ now: NOW });

    expect((await Transaction.findOne({})).currencyCode).toBe("USD");
  });
});

describe("purge", () => {
  const dayAgo = (days) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

  async function seedEntry(userId, ledger, extra = {}) {
    return Transaction.create({
      userId,
      type: "expense",
      amountMinor: 100,
      currencyCode: "INR",
      categoryId: ledger.categories.food._id,
      accountId: ledger.accounts.savings._id,
      occurredAt: NOW,
      tzid: "Asia/Kolkata",
      localDate: "2026-10-20",
      localMonth: "2026-10",
      createdOn: "web",
      ...extra,
    });
  }

  it("removes only entries soft-deleted more than 30 days ago", async () => {
    const { userId, ledger } = await setup();
    const old = await seedEntry(userId, ledger, { deletedAt: dayAgo(31) });
    const recent = await seedEntry(userId, ledger, { deletedAt: dayAgo(5) });
    const live = await seedEntry(userId, ledger);

    const result = await runPurgeJob({ now: NOW });

    expect(result.transactions).toBe(1);
    expect(await Transaction.exists({ _id: old._id })).toBeNull();
    expect(await Transaction.exists({ _id: recent._id })).not.toBeNull();
    expect(await Transaction.exists({ _id: live._id })).not.toBeNull();
  });

  it("deletes instalment plans left without entries", async () => {
    const { userId, ledger } = await setup();
    const plan = (fields) =>
      InstallmentPlan.create({
        userId,
        accountId: ledger.accounts.card._id,
        totalMinor: 3000,
        months: 3,
        startsOn: "2026-08-01",
        ...fields,
      });
    const emptied = await plan();
    const kept = await plan();
    await seedEntry(userId, ledger, { installmentPlanId: emptied._id, deletedAt: dayAgo(40) });
    await seedEntry(userId, ledger, { installmentPlanId: kept._id, deletedAt: dayAgo(40) });
    await seedEntry(userId, ledger, { installmentPlanId: kept._id });

    const result = await runPurgeJob({ now: NOW });

    expect(result).toEqual({ transactions: 2, installmentPlans: 1 });
    expect(await InstallmentPlan.exists({ _id: emptied._id })).toBeNull();
    expect(await InstallmentPlan.exists({ _id: kept._id })).not.toBeNull();
  });
});

describe("job lock", () => {
  it("refuses a second owner while held and allows it after release", async () => {
    const now = new Date();
    expect(await jobLockRepository.acquire("demo", "a", 60_000, now)).toBe(true);
    expect(await jobLockRepository.acquire("demo", "b", 60_000, now)).toBe(false);
    expect(await jobLockRepository.acquire("demo", "a", 60_000, now)).toBe(false);

    await jobLockRepository.release("demo", "a", { done: true });
    const lock = await JobLock.findById("demo").lean();
    expect(lock.lastResult).toEqual({ done: true });
    expect(await jobLockRepository.acquire("demo", "b", 60_000)).toBe(true);
  });

  it("lets another owner take over after the lock expires", async () => {
    const now = new Date();
    expect(await jobLockRepository.acquire("demo", "a", 1000, now)).toBe(true);
    const later = new Date(now.getTime() + 2000);
    expect(await jobLockRepository.acquire("demo", "b", 1000, later)).toBe(true);
    expect((await JobLock.findById("demo").lean()).owner).toBe("b");
  });

  it("lets exactly one of several concurrent claimants win", async () => {
    const results = await Promise.all(
      ["a", "b", "c", "d", "e"].map((owner) => jobLockRepository.acquire("race", owner, 60_000)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("only releases a lock the caller owns", async () => {
    await jobLockRepository.acquire("demo", "a", 60_000);
    await jobLockRepository.release("demo", "b", {});
    expect(await jobLockRepository.acquire("demo", "c", 60_000)).toBe(false);
  });
});

describe("runLocked", () => {
  it("runs a job once while the lock is held elsewhere and logs failures without throwing", async () => {
    const run = vi.fn().mockResolvedValue({ n: 1 });
    const job = { name: "demo", lockTtlMs: 60_000, run };

    expect(await runLocked(job, "a")).toEqual({ ran: true, result: { n: 1 } });
    expect(run).toHaveBeenCalledTimes(1);

    await jobLockRepository.acquire("held", "other", 60_000);
    expect(await runLocked({ ...job, name: "held" }, "a")).toEqual({ ran: false });
    expect(run).toHaveBeenCalledTimes(1);

    const failing = {
      name: "boom",
      lockTtlMs: 60_000,
      run: vi.fn().mockRejectedValue(new Error("x")),
    };
    expect(await runLocked(failing, "a")).toEqual({ ran: true, result: { error: "x" } });
    expect((await JobLock.findById("boom").lean()).lastResult).toEqual({ error: "x" });
  });
});

describe("generation isolation", () => {
  it("does not pause a rule on a non-rule error and keeps processing other rules", async () => {
    const { makeRule, entriesOf } = await setup();
    const failing = await makeRule({ nextOccurrenceDate: "2026-10-19", startsOn: "2026-10-19" });
    const healthy = await makeRule({ nextOccurrenceDate: "2026-10-20", startsOn: "2026-10-20" });
    const spy = vi.spyOn(Account, "findOne").mockImplementationOnce(() => {
      throw new Error("db blip");
    });

    const result = await generateDueOccurrences({ now: NOW });

    spy.mockRestore();
    expect(result).toMatchObject({ rulesProcessed: 1, created: 1, paused: 0, failed: 1 });
    const stored = await RecurrenceRule.findById(failing._id);
    expect(stored.pausedAt).toBeUndefined();
    expect(stored.nextOccurrenceDate).toBe("2026-10-19");
    expect(await entriesOf(healthy)).toHaveLength(1);

    const retry = await generateDueOccurrences({ now: NOW });
    expect(retry.failed).toBe(0);
    expect(await entriesOf(failing)).toHaveLength(2);
  });

  it("stops a run at the occurrence cap and finishes on the next run", async () => {
    const { makeRule, entriesOf } = await setup();
    const first = await makeRule({ nextOccurrenceDate: "2026-10-17" });
    const second = await makeRule({ nextOccurrenceDate: "2026-10-18" });

    const run = await generateDueOccurrences({ now: NOW, maxPerRun: 2 });

    expect(run.created).toBe(2);
    expect(await entriesOf(first)).toHaveLength(2);
    expect(await entriesOf(second)).toHaveLength(0);

    await generateDueOccurrences({ now: NOW });
    expect(await entriesOf(first)).toHaveLength(4);
    expect(await entriesOf(second)).toHaveLength(3);
  });

  it("does not advance a rule that was stopped meanwhile", async () => {
    const { makeRule } = await setup();
    const rule = await makeRule({ stoppedAt: new Date() });

    await recurrenceRepository.advance(rule.userId, rule._id, { nextOccurrenceDate: "2030-01-01" });

    expect((await RecurrenceRule.findById(rule._id)).nextOccurrenceDate).toBe("2026-10-17");
  });
});

describe("scheduler guards", () => {
  it("returns ran:false instead of throwing when the lock cannot be acquired", async () => {
    const spy = vi.spyOn(JobLock, "findOneAndUpdate").mockImplementationOnce(() => {
      throw new Error("db blip");
    });
    const job = { name: "blip", lockTtlMs: 60_000, run: vi.fn() };

    expect(await runLocked(job, "a")).toEqual({ ran: false });

    spy.mockRestore();
    expect(job.run).not.toHaveBeenCalled();
  });

  it("skips a run when the job finished within the interval minus a minute", async () => {
    const run = vi.fn().mockResolvedValue({});
    const job = { name: "gap", intervalMs: 15 * 60_000, lockTtlMs: 60_000, run };
    const start = new Date();

    expect(await runLocked(job, "a", start)).toMatchObject({ ran: true });
    expect(await runLocked(job, "b", new Date(start.getTime() + 5 * 60_000))).toEqual({
      ran: false,
    });
    expect(await runLocked(job, "b", new Date(start.getTime() + 15 * 60_000))).toMatchObject({
      ran: true,
    });
    expect(run).toHaveBeenCalledTimes(2);
  });
});
