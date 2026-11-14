import { escapeHtml, renderLayout, renderText } from "./layout.js";

// Every auth email the API sends. Each returns { subject, html, text }; the name is user input and is escaped.

// Mail can go to an address that did not choose this name, so anything that could render as a link is dropped.
function firstName(name) {
  const first = String(name ?? "")
    .trim()
    .split(/\s+/)[0];
  return first && !/[./:@\\]/.test(first) ? first.slice(0, 40) : "there";
}

export function verifyEmailMessage({ name, url, ttlHours }) {
  const hello = `Hi ${firstName(name)},`;
  const body =
    "Confirm this is your email address to finish setting up your Kanaku Pillai account.";
  const expiry = `The link works once and expires in ${ttlHours} hours.`;
  const ignore = "If you did not create a Kanaku Pillai account, you can ignore this email.";
  const action = { label: "Verify email", url };

  return {
    subject: "Verify your email for Kanaku Pillai",
    html: renderLayout({
      preheader: "Confirm your email address to finish setting up your account.",
      heading: "Verify your email",
      paragraphs: [escapeHtml(hello), body],
      action,
      notes: [expiry, ignore],
    }),
    text: renderText({
      heading: "Verify your email",
      lines: [hello, "", body],
      action,
      notes: [expiry, ignore],
    }),
  };
}

export function resetPasswordMessage({ name, url, ttlMinutes }) {
  const hello = `Hi ${firstName(name)},`;
  const body = "We received a request to reset the password for your Kanaku Pillai account.";
  const expiry = `The link works once and expires in ${ttlMinutes} minutes. Resetting signs you out on every device.`;
  const ignore =
    "If you did not ask for this, ignore this email. Your password stays the same and nobody can change it without this link.";
  const action = { label: "Reset password", url };

  return {
    subject: "Reset your Kanaku Pillai password",
    html: renderLayout({
      preheader: "Use this link to choose a new password.",
      heading: "Reset your password",
      paragraphs: [escapeHtml(hello), body],
      action,
      notes: [expiry, ignore],
    }),
    text: renderText({
      heading: "Reset your password",
      lines: [hello, "", body],
      action,
      notes: [expiry, ignore],
    }),
  };
}

// keptDevice: a change from Settings keeps the device that made it signed in; a reset signs out everywhere.
export function passwordChangedMessage({ name, url, keptDevice = false }) {
  const hello = `Hi ${firstName(name)},`;
  const signedOut = keptDevice
    ? "every other device was signed out"
    : "every device was signed out";
  const body = `The password for your Kanaku Pillai account was just changed, and ${signedOut}.`;
  const warn =
    "If this was not you, reset your password now using the link below, then check your signed-in devices in Settings.";
  const action = { label: "Reset password", url };

  return {
    subject: "Your Kanaku Pillai password was changed",
    html: renderLayout({
      preheader: `Your password was changed and ${signedOut}.`,
      heading: "Your password was changed",
      paragraphs: [escapeHtml(hello), body, warn],
      action,
    }),
    text: renderText({
      heading: "Your password was changed",
      lines: [hello, "", body, "", warn],
      action,
    }),
  };
}
