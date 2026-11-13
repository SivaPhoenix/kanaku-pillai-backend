import * as transactionRepository from "../repositories/transaction.repository.js";
import { toDecimalString } from "../utils/money.js";
import { localTimeOf } from "../utils/time.js";
import { resolveFilters } from "./transaction.service.js";

const EXPORT_LIMIT = 10000;
const HEADER = [
  "Date",
  "Time",
  "Type",
  "Amount",
  "Currency",
  "Category",
  "Account",
  "To account",
  "Note",
];
const FORMULA_START = /^[=+\-@\t\r]/;

// Spreadsheet apps run cells that start with these characters as formulas, so prefix a quote.
function cell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function uniqueIds(rows, key) {
  return [
    ...new Set(
      rows
        .map((row) => row[key])
        .filter(Boolean)
        .map(String),
    ),
  ];
}

async function nameMaps(userId, rows) {
  const accountIds = [
    ...new Set([...uniqueIds(rows, "accountId"), ...uniqueIds(rows, "toAccountId")]),
  ];
  const [accounts, categories] = await Promise.all([
    transactionRepository.findAccountNamesByIds(userId, accountIds),
    transactionRepository.findCategoryNamesByIds(userId, uniqueIds(rows, "categoryId")),
  ]);
  return {
    accounts: new Map(accounts.map((a) => [String(a._id), a.name])),
    categories: new Map(categories.map((c) => [String(c._id), c.name])),
  };
}

function toRow(tx, names) {
  return [
    tx.localDate,
    localTimeOf(tx.occurredAt, tx.tzid),
    tx.type,
    toDecimalString(tx.amountMinor, tx.currencyCode),
    tx.currencyCode,
    names.categories.get(String(tx.categoryId)),
    names.accounts.get(String(tx.accountId)),
    names.accounts.get(String(tx.toAccountId)),
    tx.note,
  ];
}

// Returns { csv, truncated }; matching more than the cap exports the newest rows only.
export async function exportCsv(userId, query, { limit = EXPORT_LIMIT } = {}) {
  const filters = await resolveFilters(userId, query);
  const fetched = await transactionRepository.findFiltered(userId, filters, { limit: limit + 1 });
  const truncated = fetched.length > limit;
  const rows = truncated ? fetched.slice(0, limit) : fetched;
  const names = await nameMaps(userId, rows);
  const lines = [HEADER, ...rows.map((tx) => toRow(tx, names))];
  return { csv: `${lines.map((line) => line.map(cell).join(",")).join("\r\n")}\r\n`, truncated };
}
