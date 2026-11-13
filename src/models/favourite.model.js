import mongoose from "mongoose";
import { ICON_NAMES, TX_TYPES } from "../constants/enums.js";

const { ObjectId } = mongoose.Schema.Types;

// A one-tap template for the Add screen; applying it is a normal transaction create on the client.
const favouriteSchema = new mongoose.Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    title: { type: String, required: true, trim: true, maxlength: 40 },
    icon: { type: String, enum: ICON_NAMES, required: true },
    type: { type: String, enum: TX_TYPES, required: true },
    amountMinor: { type: Number, required: true },
    categoryId: { type: ObjectId, ref: "Category" },
    accountId: { type: ObjectId, ref: "Account", required: true },
    toAccountId: { type: ObjectId, ref: "Account" },
    note: { type: String, trim: true, maxlength: 140 },
    sortOrder: { type: Number, required: true, default: 0 },
  },
  { timestamps: true, collection: "favourites" },
);

favouriteSchema.index({ userId: 1, sortOrder: 1 });

export const Favourite = mongoose.model("Favourite", favouriteSchema);
