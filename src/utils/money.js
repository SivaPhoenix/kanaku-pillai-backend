// Money is always an integer count of the currency's minor unit. Nothing here ever produces a float amount.

const digitsCache = new Map();

export function isSupportedCurrency(code) {
  return typeof code === "string" && Intl.supportedValuesOf("currency").includes(code);
}

// INR 2, JPY 0, KWD 3: taken from the runtime's ISO 4217 data.
export function minorDigits(currencyCode) {
  if (!digitsCache.has(currencyCode)) {
    const digits = new Intl.NumberFormat("en", {
      style: "currency",
      currency: currencyCode,
    }).resolvedOptions().maximumFractionDigits;
    digitsCache.set(currencyCode, digits);
  }
  return digitsCache.get(currencyCode);
}

export function isAmountMinor(value) {
  return Number.isSafeInteger(value) && value > 0;
}

// Splits a total into N parts that sum exactly: floor(total / N) each, remainder on the first part.
export function splitInstalments(totalMinor, parts) {
  const base = Math.floor(totalMinor / parts);
  const remainder = totalMinor - base * parts;
  return Array.from({ length: parts }, (_, index) => (index === 0 ? base + remainder : base));
}

// "123456" minor → "1234.56" for CSV export (plain digits, no grouping, no symbol).
export function toDecimalString(minor, currencyCode) {
  const digits = minorDigits(currencyCode);
  const negative = minor < 0;
  const raw = String(Math.abs(minor)).padStart(digits + 1, "0");
  const whole = digits === 0 ? raw : raw.slice(0, -digits);
  const fraction = digits === 0 ? "" : `.${raw.slice(-digits)}`;
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

// Interprets a search query like "240" or "1,240.50" as an exact amount; returns minor units or null.
export function parseQueryAmount(text, currencyCode) {
  const cleaned = String(text).trim().replaceAll(",", "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const digits = minorDigits(currencyCode);
  const [whole, fraction = ""] = cleaned.split(".");
  if (fraction.length > digits) return null;
  const minor = Number(whole + fraction.padEnd(digits, "0"));
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

// Share of a total with one decimal place (0 when the total is 0).
export function percentOf(part, total) {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}
