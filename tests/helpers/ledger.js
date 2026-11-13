import { Account } from "../../src/models/account.model.js";
import { Category } from "../../src/models/category.model.js";
import { Session } from "../../src/models/session.model.js";
import { User } from "../../src/models/user.model.js";
import { generateToken, sha256 } from "../../src/utils/crypto.js";
import { signAccessToken } from "../../src/utils/jwt.js";

let counter = 0;

// A signed-in user created straight in the database (no HTTP round trip). Returns { user, userId, headers }.
export async function createSignedInUser(overrides = {}) {
  counter += 1;
  const user = await User.create({
    name: `Tester ${counter}`,
    email: `tester${counter}-${Date.now()}@example.com`,
    setupComplete: true,
    ...overrides,
  });
  const session = await Session.create({
    userId: user._id,
    tokenHash: sha256(generateToken()),
    platform: "web",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  const token = signAccessToken({ userId: String(user._id), sessionId: String(session._id) });
  return {
    user: user.toObject(),
    userId: String(user._id),
    headers: { Authorization: `Bearer ${token}`, "X-Client-Platform": "web" },
  };
}

// The spec §10 shape: Savings (bank, default) + Wallet (cash) + Credit card + Debit card → Savings, Stocks (investment),
// and a few categories. Returns { accounts: { savings, wallet, card, debit, stocks }, categories: { food, …, salary } } as docs.
export async function seedLedger(userId, { opening = {} } = {}) {
  const make = (fields, index) =>
    Account.create({
      userId,
      nameKey: fields.name.toLowerCase(),
      sortOrder: index,
      openingBalanceMinor: 0,
      ...fields,
    });
  const savings = await make(
    {
      name: "Savings",
      type: "bank",
      icon: "bank",
      color: "c2",
      isDefault: true,
      openingBalanceMinor: opening.savings ?? 0,
    },
    0,
  );
  const wallet = await make(
    {
      name: "Wallet",
      type: "cash",
      icon: "cash",
      color: "c5",
      openingBalanceMinor: opening.wallet ?? 0,
    },
    1,
  );
  const card = await make(
    {
      name: "Credit card",
      type: "credit_card",
      icon: "card",
      color: "c3",
      openingBalanceMinor: opening.card ?? 0,
      creditLimitMinor: 10000000,
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
      linkedAccountId: savings._id,
    },
    3,
  );
  const stocks = await make({ name: "Stocks", type: "investment", icon: "trend", color: "c4" }, 4);

  const cat = (kind, name, icon, color, index) =>
    Category.create({
      userId,
      kind,
      name,
      nameKey: name.toLowerCase(),
      icon,
      color,
      sortOrder: index,
    });
  const food = await cat("expense", "Food", "food", "c1", 0);
  const transport = await cat("expense", "Transport", "bus", "c2", 1);
  const rent = await cat("expense", "Rent", "home", "c5", 2);
  const salary = await cat("income", "Salary", "salary", "c5", 0);
  const freelance = await cat("income", "Freelance", "laptop", "c2", 1);

  const plain = (doc) => doc.toObject();
  return {
    accounts: {
      savings: plain(savings),
      wallet: plain(wallet),
      card: plain(card),
      debit: plain(debit),
      stocks: plain(stocks),
    },
    categories: {
      food: plain(food),
      transport: plain(transport),
      rent: plain(rent),
      salary: plain(salary),
      freelance: plain(freelance),
    },
  };
}
