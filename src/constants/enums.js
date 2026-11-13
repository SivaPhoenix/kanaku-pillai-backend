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

export const TX_TYPES = Object.freeze(["income", "expense", "transfer"]);

// Types that count towards income/expense totals; transfers never do.
export const TOTAL_TX_TYPES = Object.freeze(["income", "expense"]);

export const ACCOUNT_TYPES = Object.freeze([
  "bank",
  "cash",
  "credit_card",
  "debit_card",
  "investment",
]);

// Accounts whose balance is money owned (credit cards are liabilities; debit cards roll into their bank).
export const ASSET_ACCOUNT_TYPES = Object.freeze(["bank", "cash", "investment"]);

export const CATEGORY_KINDS = Object.freeze(["expense", "income"]);

export const COLORS = Object.freeze(["c1", "c2", "c3", "c4", "c5", "c6", "c7"]);

// Must match the clients' icon sets (web src/lib/icons.js CATEGORY_ICON_NAMES). Emoji are never accepted.
export const ICON_NAMES = Object.freeze([
  "food",
  "coffee",
  "snacks",
  "fruits",
  "bus",
  "bag",
  "bolt",
  "home",
  "household",
  "medicine",
  "haircut",
  "gadgets",
  "education",
  "film",
  "salary",
  "laptop",
  "gift",
  "refund",
  "interest",
  "other",
  "wallet",
  "bank",
  "cash",
  "card",
  "trend",
]);

export const RECURRENCE_FREQS = Object.freeze(["daily", "weekly", "monthly", "yearly"]);

export const INSTALLMENT_MONTHS = Object.freeze([3, 6, 9, 12]);

// Formatting locale per currency when the client doesn't send one (design spec §9).
export const CURRENCY_LOCALES = Object.freeze({
  INR: "en-IN",
  USD: "en-US",
  EUR: "de-DE",
  GBP: "en-GB",
  AED: "en-AE",
  SGD: "en-SG",
  JPY: "ja-JP",
});
export const FALLBACK_LOCALE = "en-US";

export const STARTER_CATEGORIES = Object.freeze({
  expense: [
    { name: "Food", icon: "food", color: "c1" },
    { name: "Coffee", icon: "coffee", color: "c1" },
    { name: "Snacks", icon: "snacks", color: "c6" },
    { name: "Fruits", icon: "fruits", color: "c5" },
    { name: "Transport", icon: "bus", color: "c2" },
    { name: "Rent", icon: "home", color: "c5" },
    { name: "Electricity", icon: "bolt", color: "c4" },
    { name: "Household", icon: "household", color: "c3" },
    { name: "Medicine", icon: "medicine", color: "c7" },
    { name: "Haircut", icon: "haircut", color: "c6" },
    { name: "Gadgets", icon: "gadgets", color: "c3" },
    { name: "Education", icon: "education", color: "c2" },
  ],
  income: [
    { name: "Salary", icon: "salary", color: "c5" },
    { name: "Freelance", icon: "laptop", color: "c2" },
    { name: "Interest", icon: "interest", color: "c4" },
    { name: "Refund", icon: "refund", color: "c7" },
    { name: "Gift", icon: "gift", color: "c6" },
    { name: "Other", icon: "other", color: "c3" },
  ],
});

// Per-user caps against abuse; creating past one is 409 LIMIT_REACHED.
export const LIMITS = Object.freeze({
  accounts: 50,
  categoriesPerKind: 100,
  favourites: 100,
  activeRecurrences: 100,
});

export const SOFT_DELETE_RETENTION_DAYS = 30;
export const UNDO_WINDOW_SECONDS = 10;
