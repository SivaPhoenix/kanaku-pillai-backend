import { Router } from "express";
import { accountRouter } from "./account.route.js";
import { authRouter } from "./auth.route.js";
import { categoryRouter } from "./category.route.js";
import { favouriteRouter } from "./favourite.route.js";
import { meRouter } from "./me.route.js";
import { recurrenceRouter } from "./recurrence.route.js";
import { setupRouter } from "./setup.route.js";
import { statsRouter } from "./stats.route.js";
import { transactionRouter } from "./transaction.route.js";

export const v1Router = Router();

v1Router.use("/auth", authRouter);
// /me/setup is mounted before /me so the more specific router answers first.
v1Router.use("/me/setup", setupRouter);
v1Router.use("/me", meRouter);
v1Router.use("/accounts", accountRouter);
v1Router.use("/categories", categoryRouter);
v1Router.use("/transactions", transactionRouter);
v1Router.use("/stats", statsRouter);
v1Router.use("/favourites", favouriteRouter);
v1Router.use("/recurrences", recurrenceRouter);
