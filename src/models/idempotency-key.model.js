import mongoose from "mongoose";

// Remembers the response to a write sent with an Idempotency-Key, so a retried request returns it instead of writing twice.
const idempotencyKeySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    key: { type: String, required: true },
    route: { type: String, required: true },
    requestHash: { type: String, required: true },
    status: { type: String, enum: ["in_progress", "completed"], required: true },
    responseStatus: { type: Number },
    responseBody: { type: mongoose.Schema.Types.Mixed },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, collection: "idempotency_keys" },
);

idempotencyKeySchema.index({ userId: 1, key: 1 }, { unique: true });
idempotencyKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const IdempotencyKey = mongoose.model("IdempotencyKey", idempotencyKeySchema);
