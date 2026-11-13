import mongoose from "mongoose";

// One document per job name; a worker owns the job while lockedUntil is in the future.
const jobLockSchema = new mongoose.Schema(
  {
    _id: { type: String },
    owner: { type: String, required: true },
    lockedUntil: { type: Date, required: true },
    lastRunAt: { type: Date },
    lastResult: { type: mongoose.Schema.Types.Mixed },
  },
  { collection: "job_locks", versionKey: false },
);

export const JobLock = mongoose.model("JobLock", jobLockSchema);
