import mongoose from "mongoose";
import { RECURRENCE_FREQS, TX_TYPES } from "../constants/enums.js";

const { ObjectId } = mongoose.Schema.Types;

// A repeat rule: the worker creates one transaction per occurrence from this template, in the rule's zone and local time.
const recurrenceRuleSchema = new mongoose.Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    template: {
      type: { type: String, enum: TX_TYPES, required: true },
      amountMinor: { type: Number, required: true },
      categoryId: { type: ObjectId, ref: "Category" },
      accountId: { type: ObjectId, ref: "Account", required: true },
      toAccountId: { type: ObjectId, ref: "Account" },
      note: { type: String, maxlength: 140 },
    },
    tzid: { type: String, required: true },
    localTime: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
    freq: { type: String, enum: RECURRENCE_FREQS, required: true },
    interval: { type: Number, required: true, min: 1, max: 365 },
    // Day-of-month (and month for yearly) the rule was created on, so short months clamp without drifting.
    anchorDay: { type: Number, required: true, min: 1, max: 31 },
    anchorMonth: { type: Number, required: true, min: 1, max: 12 },
    startsOn: { type: String, required: true },
    endsOn: { type: String },
    nextOccurrenceDate: { type: String, required: true },
    lastGeneratedFor: { type: String },
    pausedAt: { type: Date },
    stoppedAt: { type: Date },
  },
  { timestamps: true, collection: "recurrence_rules" },
);

recurrenceRuleSchema.index({ userId: 1, stoppedAt: 1, nextOccurrenceDate: 1 });
// The worker scans active rules whose next date has arrived.
recurrenceRuleSchema.index({ stoppedAt: 1, pausedAt: 1, nextOccurrenceDate: 1 });

export const RecurrenceRule = mongoose.model("RecurrenceRule", recurrenceRuleSchema);
