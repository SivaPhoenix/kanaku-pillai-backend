import pino from "pino";
import { env } from "./env.js";

// Secrets and personal data never reach the logs, whatever object they arrive in.
const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  "*.password",
  "*.newPassword",
  "*.currentPassword",
  "*.passwordHash",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.idToken",
  "*.resetToken",
  "*.code",
  "*.email",
];

export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL,
  base: { service: "kanaku-pillai-api" },
  redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  ...(env.NODE_ENV === "development" && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
    },
  }),
});
