import mongoose from "mongoose";
import { CATEGORY_KINDS, COLORS, ICON_NAMES } from "../constants/enums.js";

const categorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: CATEGORY_KINDS, required: true },
    name: { type: String, required: true, trim: true, maxlength: 40 },
    nameKey: { type: String, required: true },
    // Equals nameKey while the category is active and is absent once archived; a partial unique index enforces it.
    activeNameKey: { type: String },
    icon: { type: String, enum: ICON_NAMES, required: true },
    color: { type: String, enum: COLORS, required: true },
    sortOrder: { type: Number, required: true, default: 0 },
    archivedAt: { type: Date },
  },
  { timestamps: true, collection: "categories" },
);

categorySchema.index({ userId: 1, kind: 1, archivedAt: 1, sortOrder: 1 });
categorySchema.index({ userId: 1, kind: 1, nameKey: 1 });
categorySchema.index(
  { userId: 1, kind: 1, activeNameKey: 1 },
  { unique: true, partialFilterExpression: { activeNameKey: { $exists: true } } },
);

export const Category = mongoose.model("Category", categorySchema);
