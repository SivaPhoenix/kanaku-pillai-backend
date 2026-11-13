import { InstallmentPlan } from "../models/installment-plan.model.js";

// Every function is scoped by userId.

export async function create(userId, fields, { session } = {}) {
  const [plan] = await InstallmentPlan.create([{ ...fields, userId }], { session });
  return plan.toObject();
}
