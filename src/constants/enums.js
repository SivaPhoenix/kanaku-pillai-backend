export const CLIENT_PLATFORMS = Object.freeze(["web", "ios", "android"]);

export const AUTH_METHODS = Object.freeze({ PASSWORD: "password", GOOGLE: "google" });

export const THEMES = Object.freeze(["system", "light", "dark"]);

export const WEEK_STARTS = Object.freeze(["mon", "sun"]);

export const TZ_MODES = Object.freeze(["device", "manual"]);

// Design spec §9 defaults; the setup flow replaces currency and zone with the user's choice.
export const DEFAULT_USER_SETTINGS = Object.freeze({
  currencyCode: "INR",
  locale: "en-IN",
  tzMode: "device",
  tzid: "Asia/Kolkata",
  theme: "system",
  weekStart: "mon",
});
