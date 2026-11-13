import mongoose from "mongoose";
import { DEFAULT_USER_SETTINGS, THEMES, TZ_MODES, WEEK_STARTS } from "../constants/enums.js";

const settingsSchema = new mongoose.Schema(
  {
    currencyCode: { type: String, required: true, default: DEFAULT_USER_SETTINGS.currencyCode },
    locale: { type: String, required: true, default: DEFAULT_USER_SETTINGS.locale },
    tzMode: { type: String, enum: TZ_MODES, required: true, default: DEFAULT_USER_SETTINGS.tzMode },
    tzid: { type: String, required: true, default: DEFAULT_USER_SETTINGS.tzid },
    theme: { type: String, enum: THEMES, required: true, default: DEFAULT_USER_SETTINGS.theme },
    weekStart: {
      type: String,
      enum: WEEK_STARTS,
      required: true,
      default: DEFAULT_USER_SETTINGS.weekStart,
    },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    // Absent for accounts that only sign in with Google; never selected unless asked for.
    passwordHash: { type: String, select: false },
    googleSub: { type: String },
    emailVerifiedAt: { type: Date },
    avatarUrl: { type: String, maxlength: 2048 },
    settings: { type: settingsSchema, required: true, default: () => ({}) },
    setupComplete: { type: Boolean, required: true, default: false },
  },
  { timestamps: true, collection: "users" },
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ googleSub: 1 }, { unique: true, sparse: true });

export const User = mongoose.model("User", userSchema);
