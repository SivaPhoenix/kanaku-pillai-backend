import mongoose from "mongoose";
import { CLIENT_PLATFORMS, TX_TYPES } from "../constants/enums.js";

const { ObjectId } = mongoose.Schema.Types;

// One ledger entry. amountMinor is always positive; the sign comes from type. Transfers carry toAccountId and no category.
const transactionSchema = new mongoose.Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    type: { type: String, enum: TX_TYPES, required: true },
    amountMinor: {
      type: Number,
      required: true,
      validate: { validator: (v) => Number.isSafeInteger(v) && v > 0, message: "invalid amount" },
    },
    currencyCode: { type: String, required: true },
    categoryId: { type: ObjectId, ref: "Category" },
    accountId: { type: ObjectId, ref: "Account", required: true },
    toAccountId: { type: ObjectId, ref: "Account" },
    occurredAt: { type: Date, required: true },
    // Zone the entry was recorded in; localDate/localMonth derive from occurredAt in this zone and drive all grouping.
    tzid: { type: String, required: true },
    localDate: { type: String, required: true },
    localMonth: { type: String, required: true },
    note: { type: String, trim: true, maxlength: 140 },
    recurrenceId: { type: ObjectId, ref: "RecurrenceRule" },
    occurrenceDate: { type: String },
    installmentPlanId: { type: ObjectId, ref: "InstallmentPlan" },
    installmentIndex: { type: Number },
    installmentCount: { type: Number },
    createdOn: { type: String, enum: CLIENT_PLATFORMS, required: true },
    deletedAt: { type: Date },
  },
  { timestamps: true, collection: "transactions" },
);

transactionSchema.index({ userId: 1, deletedAt: 1, occurredAt: -1, _id: -1 });
transactionSchema.index({ userId: 1, localDate: -1 });
transactionSchema.index({ userId: 1, accountId: 1, localDate: -1 });
transactionSchema.index({ userId: 1, toAccountId: 1 }, { sparse: true });
transactionSchema.index({ userId: 1, categoryId: 1, localMonth: 1 });
transactionSchema.index({ userId: 1, localMonth: 1, type: 1 });
// Repeat generation is idempotent: one entry per rule per occurrence date.
transactionSchema.index(
  { recurrenceId: 1, occurrenceDate: 1 },
  { unique: true, partialFilterExpression: { recurrenceId: { $exists: true } } },
);
transactionSchema.index({ installmentPlanId: 1 }, { sparse: true });
transactionSchema.index({ deletedAt: 1 }, { sparse: true });

export const Transaction = mongoose.model("Transaction", transactionSchema);
