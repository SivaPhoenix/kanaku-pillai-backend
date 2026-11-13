import mongoose from "mongoose";
import { INSTALLMENT_MONTHS } from "../constants/enums.js";

const { ObjectId } = mongoose.Schema.Types;

// A credit-card purchase split into monthly expense entries (each entry points back here).
const installmentPlanSchema = new mongoose.Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    accountId: { type: ObjectId, ref: "Account", required: true },
    totalMinor: { type: Number, required: true },
    months: { type: Number, enum: INSTALLMENT_MONTHS, required: true },
    startsOn: { type: String, required: true },
  },
  { timestamps: true, collection: "installment_plans" },
);

installmentPlanSchema.index({ userId: 1, accountId: 1 });

export const InstallmentPlan = mongoose.model("InstallmentPlan", installmentPlanSchema);
