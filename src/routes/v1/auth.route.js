import { Router } from "express";
import * as authController from "../../controllers/auth.controller.js";
import { requireAuth } from "../../middleware/auth.js";
import { authRateLimits, changePasswordRateLimit } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import {
  changePasswordBody,
  forgotPasswordBody,
  googleBody,
  linkTokenBody,
  loginBody,
  refreshBody,
  resetPasswordBody,
  signupBody,
} from "../../schemas/auth.schema.js";

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
authRouter.post(
  "/verify-email",
  authRateLimits.verifyEmail,
  validate({ body: linkTokenBody }),
  authController.verifyEmail,
);
authRouter.post(
  "/forgot-password",
  authRateLimits.forgotPasswordPerIp,
  authRateLimits.forgotPassword,
  validate({ body: forgotPasswordBody }),
  authController.forgotPassword,
);
authRouter.post(
  "/reset-password/check",
  authRateLimits.resetPassword,
  validate({ body: linkTokenBody }),
  authController.checkResetToken,
);
authRouter.post(
  "/reset-password",
  authRateLimits.resetPassword,
  validate({ body: resetPasswordBody }),
  authController.resetPassword,
);
// The one /auth route that needs a signed-in user: it keeps the caller's session and ends the others.
authRouter.post(
  "/change-password",
  requireAuth,
  changePasswordRateLimit,
  validate({ body: changePasswordBody }),
  authController.changePassword,
);
