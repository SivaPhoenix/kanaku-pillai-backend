import { Router } from "express";
import { authRouter } from "./auth.route.js";
import { meRouter } from "./me.route.js";

export const v1Router = Router();

v1Router.use("/auth", authRouter);
v1Router.use("/me", meRouter);
