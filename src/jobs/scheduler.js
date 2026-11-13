import crypto from "node:crypto";
import os from "node:os";
import { logger } from "../config/logger.js";
import * as jobLockRepository from "../repositories/job-lock.repository.js";
import { runPurgeJob } from "./purge.job.js";
import { runRecurrenceJob } from "./recurrence.job.js";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

export const JOBS = Object.freeze([
  {
    name: "recurrence",
    intervalMs: 15 * MINUTE_MS,
    lockTtlMs: 10 * MINUTE_MS,
    run: runRecurrenceJob,
  },
  { name: "purge", intervalMs: 24 * HOUR_MS, lockTtlMs: 30 * MINUTE_MS, run: runPurgeJob },
]);

export function makeOwnerId() {
  return `${os.hostname()}-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
}

// Runs the job only if this owner wins the lock; errors are logged, never thrown.
export async function runLocked(job, owner, now = new Date()) {
  try {
    // Skips a run another worker (or a restart) already did within the last interval.
    const minGapMs = job.intervalMs ? Math.max(0, job.intervalMs - MINUTE_MS) : 0;
    if (!(await jobLockRepository.acquire(job.name, owner, job.lockTtlMs, now, { minGapMs }))) {
      return { ran: false };
    }
  } catch (error) {
    logger.error({ err: error, job: job.name }, "Could not acquire job lock");
    return { ran: false };
  }
  let result;
  try {
    result = await job.run();
  } catch (error) {
    logger.error({ err: error, job: job.name }, "Job failed");
    result = { error: error.message };
  }
  try {
    await jobLockRepository.release(job.name, owner, result);
  } catch (error) {
    logger.error({ err: error, job: job.name }, "Could not release job lock");
  }
  return { ran: true, result };
}

export function startScheduler({ jobs = JOBS } = {}) {
  const owner = makeOwnerId();
  const running = new Set();
  const trigger = (job) => {
    const promise = runLocked(job, owner).finally(() => running.delete(promise));
    running.add(promise);
  };

  const timers = jobs.map((job) => {
    trigger(job);
    return setInterval(() => trigger(job), job.intervalMs);
  });
  logger.info({ owner, jobs: jobs.map((job) => job.name) }, "Scheduler started");

  // Stops new runs and resolves once any running job has finished.
  return {
    async stop() {
      for (const timer of timers) clearInterval(timer);
      await Promise.allSettled([...running]);
    },
  };
}
