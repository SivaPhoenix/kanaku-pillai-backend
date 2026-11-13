import mongoose from "mongoose";
import { InstallmentPlan } from "../models/installment-plan.model.js";
import { Transaction } from "../models/transaction.model.js";

// Maintenance deletes run across all users on purpose: they only touch data that is already expired or orphaned.

export async function deleteTransactionsSoftDeletedBefore(cutoff) {
  const result = await Transaction.deleteMany({ deletedAt: mongoose.trusted({ $lt: cutoff }) });
  return result.deletedCount;
}

export async function deleteOrphanInstallmentPlans() {
  const orphans = await InstallmentPlan.aggregate([
    {
      $lookup: {
        from: Transaction.collection.name,
        localField: "_id",
        foreignField: "installmentPlanId",
        pipeline: [{ $limit: 1 }, { $project: { _id: 1 } }],
        as: "entries",
      },
    },
    { $match: { entries: { $size: 0 } } },
    { $project: { _id: 1 } },
  ]);
  if (orphans.length === 0) return 0;
  const result = await InstallmentPlan.deleteMany({
    _id: mongoose.trusted({ $in: orphans.map((plan) => plan._id) }),
  });
  return result.deletedCount;
}
