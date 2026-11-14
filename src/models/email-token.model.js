import mongoose from "mongoose";
import { EMAIL_TOKEN_PURPOSES } from "../constants/enums.js";

// Single-use links sent by email (verify email, reset password). Only the SHA-256 digest of the token is stored.
const emailTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    purpose: { type: String, enum: EMAIL_TOKEN_PURPOSES, required: true },
    tokenHash: { type: String, required: true },
    // The address the link was sent to; a verify link stops working if the account email changes.
    email: { type: String, required: true, lowercase: true, maxlength: 254 },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date },
  },
  { timestamps: true, collection: "email_tokens" },
);

emailTokenSchema.index({ tokenHash: 1 }, { unique: true });
emailTokenSchema.index({ userId: 1, purpose: 1, createdAt: -1 });
// MongoDB removes a token document once it has expired, used or not.
emailTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const EmailToken = mongoose.model("EmailToken", emailTokenSchema);
