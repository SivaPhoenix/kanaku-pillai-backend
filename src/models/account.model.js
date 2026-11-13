import mongoose from "mongoose";
import { ACCOUNT_TYPES, COLORS, ICON_NAMES } from "../constants/enums.js";

const { ObjectId } = mongoose.Schema.Types;

const accountSchema = new mongoose.Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true, maxlength: 40 },
    // Lower-cased name for case-insensitive uniqueness checks among a user's active accounts.
    nameKey: { type: String, required: true },
    // Equals nameKey while the account is active and is absent once archived; a partial unique index enforces it.
    activeNameKey: { type: String },
    type: { type: String, enum: ACCOUNT_TYPES, required: true },
    icon: { type: String, enum: ICON_NAMES, required: true },
    color: { type: String, enum: COLORS, required: true },
    last4: { type: String, match: /^\d{4}$/ },
    // Credit card: amount owed at the start. Others: money held at the start (bank/cash/investment may be negative).
    openingBalanceMinor: { type: Number, required: true, default: 0 },
    linkedAccountId: { type: ObjectId, ref: "Account" },
    creditLimitMinor: { type: Number },
    statementDay: { type: Number, min: 1, max: 28 },
    dueDay: { type: Number, min: 1, max: 28 },
    isDefault: { type: Boolean, required: true, default: false },
    sortOrder: { type: Number, required: true, default: 0 },
    archivedAt: { type: Date },
  },
  { timestamps: true, collection: "accounts" },
);

accountSchema.index({ userId: 1, archivedAt: 1, sortOrder: 1 });
accountSchema.index({ userId: 1, nameKey: 1 });
accountSchema.index(
  { userId: 1, activeNameKey: 1 },
  { unique: true, partialFilterExpression: { activeNameKey: { $exists: true } } },
);
accountSchema.index({ userId: 1, linkedAccountId: 1 }, { sparse: true });

export const Account = mongoose.model("Account", accountSchema);
