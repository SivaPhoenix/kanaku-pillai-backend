import { Router } from "express";
import { live, ready } from "../controllers/health.controller.js";
import { noStore } from "../middleware/no-store.js";
import { v1Router } from "./v1/index.js";

export const routes = Router();

routes.get("/health", live);
routes.get("/ready", ready);
routes.use("/api/v1", noStore, v1Router);
