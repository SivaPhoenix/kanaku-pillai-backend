// Creates (or recreates) a demo account with realistic data for manual testing. Usage: npm run seed:demo
// Only the demo user's own data is replaced; it refuses to run with NODE_ENV=production.
import dns from "node:dns";
import { connectDb, disconnectDb } from "../src/config/db.js";
import { env } from "../src/config/env.js";
import { logger } from "../src/config/logger.js";
import { STARTER_CATEGORIES } from "../src/constants/enums.js";
import { Account } from "../src/models/account.model.js";
import { Category } from "../src/models/category.model.js";
import { Favourite } from "../src/models/favourite.model.js";
import { RecurrenceRule } from "../src/models/recurrence-rule.model.js";
import { Transaction } from "../src/models/transaction.model.js";
import { User } from "../src/models/user.model.js";
import { deleteAllForUser } from "../src/repositories/user-data.repository.js";
import { hashPassword } from "../src/utils/password.js";
import {
  addDays,
  addMonthsClamped,
  instantAt,
  localDateOf,
  localMonthOf,
  nextOccurrenceDate,
  todayIn,
} from "../src/utils/time.js";

// Test-only credentials for the local/dev demo account. Never reuse them anywhere real.
export const DEMO_EMAIL = "demo@kanakupillai.test";
export const DEMO_PASSWORD = "Demo#Ledger2026";

const TZ = "Asia/Kolkata";
const CURRENCY = "INR";
const rupees = (value) => Math.round(value * 100);

// Daily spend pattern from design spec §10 (first value is rent day).
const DAILY_SPEND = [
  640, 1820, 2350, 420, 980, 1340, 260, 3120, 760, 2480, 540, 1150, 890, 1950, 620, 1980, 2240, 360,
  780, 1460, 1240,
];
// Spec §10 six-month expense trend (oldest first), used for the five months before this one.
const PAST_EXPENSE_TOTALS = [38200, 41050, 39800, 44600, 40900];

async function createAccounts(userId) {
  const make = (fields, sortOrder) =>
    Account.create({
      userId,
      sortOrder,
      nameKey: fields.name.toLowerCase(),
      activeNameKey: fields.name.toLowerCase(),
      ...fields,
    });
  const savings = await make(
    {
      name: "Savings",
      type: "bank",
      icon: "bank",
      color: "c2",
      isDefault: true,
      openingBalanceMinor: rupees(40000),
    },
    0,
  );
  const wallet = await make(
    {
      name: "Wallet",
      type: "cash",
      icon: "wallet",
      color: "c5",
      openingBalanceMinor: rupees(6300),
    },
    1,
  );
  const card = await make(
    {
      name: "Credit card",
      type: "credit_card",
      icon: "card",
      color: "c3",
      last4: "9310",
      openingBalanceMinor: 0,
      creditLimitMinor: rupees(100000),
      statementDay: 20,
      dueDay: 5,
    },
    2,
  );
  const debit = await make(
    {
      name: "Debit card",
      type: "debit_card",
      icon: "card",
      color: "c2",
      last4: "4821",
      linkedAccountId: savings._id,
      openingBalanceMinor: 0,
    },
    3,
  );
  const stocks = await make(
    {
      name: "Stocks & SIP",
      type: "investment",
      icon: "trend",
      color: "c4",
      openingBalanceMinor: rupees(19450),
    },
    4,
  );
  return { savings, wallet, card, debit, stocks };
}

async function createCategories(userId) {
  const byName = {};
  for (const kind of ["expense", "income"]) {
    for (const [index, item] of STARTER_CATEGORIES[kind].entries()) {
      const key = item.name.toLowerCase();
      byName[item.name] = await Category.create({
        userId,
        kind,
        sortOrder: index,
        nameKey: key,
        activeNameKey: key,
        ...item,
      });
    }
  }
  return byName;
}

function entry(userId, { type, amount, category, account, toAccount, date, time, note }) {
  const occurredAt = instantAt(date, time, TZ);
  return {
    userId,
    type,
    amountMinor: rupees(amount),
    currencyCode: CURRENCY,
    categoryId: category?._id,
    accountId: account._id,
    toAccountId: toAccount?._id,
    occurredAt,
    tzid: TZ,
    localDate: localDateOf(occurredAt, TZ),
    localMonth: localMonthOf(occurredAt, TZ),
    note,
    createdOn: "web",
  };
}

function currentMonthEntries(userId, a, c, today) {
  const firstOfMonth = `${today.slice(0, 7)}-01`;
  const dayCount = Number(today.slice(8, 10));
  const day = (n) => addDays(firstOfMonth, n - 1);
  const rows = [
    {
      type: "income",
      amount: 79000,
      category: c.Salary,
      account: a.savings,
      date: day(1),
      time: "09:00",
      note: "Salary",
    },
    {
      type: "expense",
      amount: 15000,
      category: c.Rent,
      account: a.savings,
      date: day(1),
      time: "10:00",
      note: "Rent",
    },
    {
      type: "transfer",
      amount: 6000,
      account: a.savings,
      toAccount: a.stocks,
      date: day(Math.min(5, dayCount)),
      time: "09:00",
      note: "Monthly SIP",
    },
  ];
  // ATM top-ups keep the wallet positive; this month's card spending stays unpaid until the bill.
  for (const topUpDay of [1, 8, 15, 22]) {
    if (topUpDay <= dayCount) {
      rows.push({
        type: "transfer",
        amount: 5000,
        account: a.savings,
        toAccount: a.wallet,
        date: day(topUpDay),
        time: "11:00",
        note: "ATM withdrawal",
      });
    }
  }
  // Spread the spec's daily spending over the days so far, rotating through realistic categories and accounts.
  const pattern = [
    ["Food", "wallet", "Lunch"],
    ["Transport", "wallet", "Auto to office"],
    ["Food", "debit", "Groceries"],
    ["Gadgets", "card", "Phone case"],
    ["Electricity", "savings", "Electricity bill"],
    ["Coffee", "wallet", "Coffee"],
    ["Household", "card", "Cleaning supplies"],
    ["Medicine", "debit", "Pharmacy"],
  ];
  for (let n = 2; n <= dayCount; n += 1) {
    const [category, account, note] = pattern[(n - 2) % pattern.length];
    const amount = DAILY_SPEND[(n - 2) % DAILY_SPEND.length];
    rows.push({
      type: "expense",
      amount,
      category: c[category],
      account: a[account],
      date: day(n),
      time: "13:20",
      note,
    });
  }
  if (dayCount >= 3) {
    rows.push({
      type: "income",
      amount: 6000,
      category: c.Freelance,
      account: a.savings,
      date: day(dayCount - 1),
      time: "17:30",
      note: "Website project",
    });
  }
  return rows.map((row) => entry(userId, row));
}

function pastMonthEntries(userId, a, c, today) {
  const rows = [];
  PAST_EXPENSE_TOTALS.forEach((total, index) => {
    const monthsBack = PAST_EXPENSE_TOTALS.length - index;
    const first = addMonthsClamped(`${today.slice(0, 7)}-01`, -monthsBack);
    const at = (n) => addDays(first, n - 1);
    const variable = total - 15000;
    const cardSpend = variable - Math.round(variable * 0.45) - Math.round(variable * 0.2);
    // Cash comes from an ATM top-up and the card bill is paid in full each month, as a real person would.
    rows.push(
      {
        type: "transfer",
        amount: 6000,
        account: a.savings,
        toAccount: a.wallet,
        date: at(2),
        time: "11:00",
        note: "ATM withdrawal",
      },
      {
        type: "transfer",
        amount: cardSpend,
        account: a.savings,
        toAccount: a.card,
        date: at(25),
        time: "10:00",
        note: "Card bill",
      },
    );
    rows.push(
      {
        type: "income",
        amount: 79000,
        category: c.Salary,
        account: a.savings,
        date: at(1),
        time: "09:00",
        note: "Salary",
      },
      {
        type: "expense",
        amount: 15000,
        category: c.Rent,
        account: a.savings,
        date: at(1),
        time: "10:00",
        note: "Rent",
      },
      {
        type: "expense",
        amount: Math.round((total - 15000) * 0.45),
        category: c.Food,
        account: a.debit,
        date: at(10),
        time: "19:00",
        note: "Groceries and meals",
      },
      {
        type: "expense",
        amount: Math.round((total - 15000) * 0.2),
        category: c.Transport,
        account: a.wallet,
        date: at(14),
        time: "09:05",
        note: "Commute",
      },
      {
        type: "expense",
        amount:
          total - 15000 - Math.round((total - 15000) * 0.45) - Math.round((total - 15000) * 0.2),
        category: c.Gadgets,
        account: a.card,
        date: at(18),
        time: "20:00",
        note: "Shopping",
      },
      {
        type: "transfer",
        amount: 6000,
        account: a.savings,
        toAccount: a.stocks,
        date: at(5),
        time: "09:00",
        note: "Monthly SIP",
      },
    );
  });
  return rows.map((row) => entry(userId, row));
}

async function main() {
  if (env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production");
  if (env.DNS_SERVERS.length > 0) dns.setServers(env.DNS_SERVERS);
  await connectDb(env.MONGODB_URI);

  const existing = await User.findOne({ email: DEMO_EMAIL }).lean();
  if (existing) await deleteAllForUser(existing._id);

  const user = await User.create({
    name: "Siva Demo",
    email: DEMO_EMAIL,
    passwordHash: await hashPassword(DEMO_PASSWORD),
    setupComplete: true,
    settings: {
      currencyCode: CURRENCY,
      locale: "en-IN",
      tzMode: "device",
      tzid: TZ,
      theme: "system",
      weekStart: "mon",
    },
  });
  const userId = user._id;
  const accounts = await createAccounts(userId);
  const categories = await createCategories(userId);
  const today = todayIn(TZ);

  const docs = [
    ...pastMonthEntries(userId, accounts, categories, today),
    ...currentMonthEntries(userId, accounts, categories, today),
  ];
  await Transaction.insertMany(docs);

  // Monthly SIP repeats on the 5th; the next occurrence is next month's 5th.
  const sipDay = `${today.slice(0, 7)}-05`;
  await RecurrenceRule.create({
    userId,
    template: {
      type: "transfer",
      amountMinor: rupees(6000),
      accountId: accounts.savings._id,
      toAccountId: accounts.stocks._id,
      note: "Monthly SIP",
    },
    tzid: TZ,
    localTime: "09:00",
    freq: "monthly",
    interval: 1,
    anchorDay: 5,
    anchorMonth: Number(today.slice(5, 7)),
    startsOn: sipDay,
    nextOccurrenceDate: nextOccurrenceDate(sipDay, {
      freq: "monthly",
      interval: 1,
      anchorDay: 5,
      anchorMonth: 1,
    }),
    lastGeneratedFor: sipDay,
  });

  await Favourite.insertMany([
    {
      userId,
      title: "Lunch",
      icon: "food",
      type: "expense",
      amountMinor: rupees(240),
      categoryId: categories.Food._id,
      accountId: accounts.wallet._id,
      note: "Lunch",
      sortOrder: 0,
    },
    {
      userId,
      title: "Auto to office",
      icon: "bus",
      type: "expense",
      amountMinor: rupees(120),
      categoryId: categories.Transport._id,
      accountId: accounts.wallet._id,
      note: "Auto to office",
      sortOrder: 1,
    },
    {
      userId,
      title: "Monthly SIP",
      icon: "trend",
      type: "transfer",
      amountMinor: rupees(6000),
      accountId: accounts.savings._id,
      toAccountId: accounts.stocks._id,
      note: "Monthly SIP",
      sortOrder: 2,
    },
    {
      userId,
      title: "Card bill",
      icon: "card",
      type: "transfer",
      amountMinor: rupees(9870),
      accountId: accounts.savings._id,
      toAccountId: accounts.card._id,
      note: "Card bill",
      sortOrder: 3,
    },
  ]);

  logger.info({ email: "[demo]", transactions: docs.length }, "Demo account seeded");
  await disconnectDb();
}

main().catch(async (error) => {
  logger.fatal({ err: error }, "Demo seed failed");
  await disconnectDb().catch(() => {});
  process.exit(1);
});
