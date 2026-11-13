import mongoose from "mongoose";
import { CLIENT_PLATFORMS } from "../constants/enums.js";

// One document per signed-in device. The refresh token rotates on every use, and only its SHA-256 digest is stored.
const sessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    tokenHash: { type: String, required: true },
    // The token this one replaced; seeing it again means a stolen token is being replayed.
    previousTokenHash: { type: String },
    platform: { type: String, enum: CLIENT_PLATFORMS, required: true },
    userAgent: { type: String, maxlength: 512 },
    ipAddress: { type: String, maxlength: 64 },
    keepSignedIn: { type: Boolean, required: true, default: true },
    lastUsedAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    revokedReason: { type: String, enum: ["logout", "reuse_detected", "account_takeover_guard"] },
  },
  { timestamps: true, collection: "sessions" },
);

sessionSchema.index({ tokenHash: 1 }, { unique: true });
sessionSchema.index({ previousTokenHash: 1 }, { sparse: true });
sessionSchema.index({ userId: 1, revokedAt: 1 });
// MongoDB removes a session document once it has expired.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = mongoose.model("Session", sessionSchema);
