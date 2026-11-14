import nodemailer from "nodemailer";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

let smtpTransporter;

function getSmtpTransporter() {
  // Gmail: host smtp.gmail.com, port 465 (secure), user = the sending address, pass = a Google app password.
  smtpTransporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    pool: true,
    maxConnections: 2,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return smtpTransporter;
}

// Development only (env.js refuses "console" in production): prints the message so links can be clicked from the terminal.
function logToConsole({ to, subject, text }) {
  // Not through the redacted logger fields on purpose: the whole point is to show the link to the developer.
  logger.info(
    { mail: { subject, body: `\n${text}` } },
    `Email (console transport) to ${maskEmail(to)}`,
  );
}

export function maskEmail(email) {
  const [local = "", domain = ""] = String(email).split("@");
  return `${local.slice(0, 1)}•••@${domain}`;
}

export async function sendMail({ to, subject, html, text }) {
  if (env.MAIL_TRANSPORT === "console") {
    logToConsole({ to, subject, text });
    return;
  }
  await getSmtpTransporter().sendMail({ from: env.MAIL_FROM, to, subject, html, text });
}

export function closeMailTransport() {
  smtpTransporter?.close();
  smtpTransporter = undefined;
}
