import * as statsRepository from "../repositories/stats.repository.js";
import * as userRepository from "../repositories/user.repository.js";
import { percentOf } from "../utils/money.js";
import {
  addMonthsToMonth,
  currentMonthIn,
  daysOfMonth,
  monthRange,
  periodRanges,
  todayIn,
} from "../utils/time.js";

const toCategoryRows = (rows, total) =>
  rows.map((row) => ({
    categoryId: row.id,
    amountMinor: row.amountMinor,
    pct: percentOf(row.amountMinor, total),
  }));

export async function getMonthStats(userId, month) {
  const { settings } = await userRepository.findById(userId);
  const range = monthRange(month);
  const [totals, categories, accounts, daily] = await Promise.all([
    statsRepository.totalsByType(userId, range),
    statsRepository.totalsByCategory(userId, { ...range, type: "expense" }),
    statsRepository.totalsByAccount(userId, { ...range, type: "expense" }),
    statsRepository.totalsByDay(userId, range),
  ]);

  const perDay = new Map(daysOfMonth(month).map((d) => [d, { expenseMinor: 0, incomeMinor: 0 }]));
  for (const row of daily) perDay.get(row.localDate)[`${row.type}Minor`] = row.amountMinor;

  return {
    month,
    currencyCode: settings.currencyCode,
    incomeMinor: totals.incomeMinor,
    expenseMinor: totals.expenseMinor,
    balanceMinor: totals.incomeMinor - totals.expenseMinor,
    byCategory: toCategoryRows(categories, totals.expenseMinor),
    byAccount: accounts.map((row) => ({ accountId: row.id, amountMinor: row.amountMinor })),
    days: [...perDay].map(([localDate, sums]) => ({ localDate, ...sums })),
  };
}

const sum = (rows) => rows.reduce((total, row) => total + row.amountMinor, 0);

export async function getPeriodStats(userId, { period, ref, type }) {
  const { settings } = await userRepository.findById(userId);
  const { current, previous } = periodRanges(
    period,
    ref ?? todayIn(settings.tzid),
    settings.weekStart,
  );
  const [currentRows, previousRows] = await Promise.all([
    statsRepository.totalsByCategory(userId, { ...current, type }),
    statsRepository.totalsByCategory(userId, { ...previous, type }),
  ]);
  const totalMinor = sum(currentRows);
  const previousTotalMinor = sum(previousRows);
  const previousById = new Map(previousRows.map((row) => [row.id, row.amountMinor]));
  const currentIds = new Set(currentRows.map((row) => row.id));

  const byCategory = [
    ...currentRows.map((row) => ({
      categoryId: row.id,
      amountMinor: row.amountMinor,
      pct: percentOf(row.amountMinor, totalMinor),
      previousAmountMinor: previousById.get(row.id) ?? 0,
    })),
    ...previousRows
      .filter((row) => !currentIds.has(row.id))
      .map((row) => ({
        categoryId: row.id,
        amountMinor: 0,
        pct: 0,
        previousAmountMinor: row.amountMinor,
      })),
  ];

  return {
    period,
    type,
    from: current.from,
    to: current.to,
    previousFrom: previous.from,
    previousTo: previous.to,
    totalMinor,
    previousTotalMinor,
    byCategory,
  };
}

export async function getTrend(userId, { months, end, type }) {
  const { settings } = await userRepository.findById(userId);
  const endMonth = end ?? currentMonthIn(settings.tzid);
  const startMonth = addMonthsToMonth(endMonth, -(months - 1));
  const rows = await statsRepository.totalsByMonth(userId, {
    fromMonth: startMonth,
    toMonth: endMonth,
    type,
  });
  const byMonth = new Map(rows.map((row) => [row.month, row.amountMinor]));
  const points = Array.from({ length: months }, (_, index) => {
    const month = addMonthsToMonth(startMonth, index);
    return { month, amountMinor: byMonth.get(month) ?? 0 };
  });
  return { type, points, averageMinor: Math.round(sum(points) / months) };
}
