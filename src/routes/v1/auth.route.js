import { Router } from "express";
import * as authController from "../../controllers/auth.controller.js";
import { authRateLimits } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import { googleBody, loginBody, refreshBody, signupBody } from "../../schemas/auth.schema.js";

export const authRouter = Router();

authRouter.post(
  "/signup",
  authRateLimits.signup,
  validate({ body: signupBody }),
  authController.signup,
);
authRouter.post(
  "/login",
  authRateLimits.login,
  validate({ body: loginBody }),
  authController.login,
);
authRouter.post(
  "/google",
  authRateLimits.google,
  validate({ body: googleBody }),
  authController.google,
);
authRouter.post(
  "/refresh",
  authRateLimits.refresh,
  validate({ body: refreshBody }),
  authController.refresh,
);
authRouter.post("/logout", validate({ body: refreshBody }), authController.logout);
