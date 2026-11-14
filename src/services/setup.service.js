import { CURRENCY_LOCALES, FALLBACK_LOCALE, STARTER_CATEGORIES } from "../constants/enums.js";
import { ERROR_CODES } from "../constants/error-codes.js";
import { HTTP_STATUS } from "../constants/http-status.js";
import * as accountRepository from "../repositories/account.repository.js";
import * as categoryRepository from "../repositories/category.repository.js";
import * as setupRepository from "../repositories/setup.repository.js";
import * as userRepository from "../repositories/user.repository.js";
import { ApiError } from "../utils/api-error.js";
import { withTransaction } from "../utils/transaction.js";
import { listAccounts } from "./account.service.js";
import { listCategories } from "./category.service.js";
import { toUserDto } from "./user.service.js";

const alreadyDone = () =>
  new ApiError(HTTP_STATUS.CONFLICT, ERROR_CODES.SETUP_ALREADY_DONE, "Setup is already complete");

const savingsAccount = (openingBalanceMinor) => ({
  name: "Savings",
  type: "bank",
  icon: "bank",
  color: "c2",
  isDefault: true,
  openingBalanceMinor,
  sortOrder: 0,
});

const otherAccounts = (balances, savingsId) => [
  {
    name: "Wallet",
    type: "cash",
    icon: "wallet",
    color: "c5",
    openingBalanceMinor: balances.walletMinor ?? 0,
    sortOrder: 1,
  },
  {
    name: "Credit card",
    type: "credit_card",
    icon: "card",
    color: "c3",
    openingBalanceMinor: balances.creditCardOwedMinor ?? 0,
    sortOrder: 2,
  },
  {
    name: "Debit card",
    type: "debit_card",
    icon: "card",
    color: "c2",
    linkedAccountId: savingsId,
    openingBalanceMinor: 0,
    sortOrder: 3,
  },
  {
    name: "SIP & Stocks",
    type: "investment",
    icon: "trend",
    color: "c4",
    openingBalanceMinor: balances.investmentsMinor ?? 0,
    sortOrder: 4,
  },
];

function starterCategoryDocs() {
  return Object.entries(STARTER_CATEGORIES).flatMap(([kind, list]) =>
    list.map((category, index) => ({
      ...category,
      kind,
      nameKey: category.name.toLowerCase(),
      activeNameKey: category.name.toLowerCase(),
      sortOrder: index,
    })),
  );
}

export async function completeSetup(userId, body) {
  const user = await userRepository.findById(userId);
  if (!user) throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND, "Account not found");
  if (user.setupComplete) throw alreadyDone();

  const balances = body.startingBalances ?? {};
  const locale = CURRENCY_LOCALES[body.currencyCode] ?? FALLBACK_LOCALE;

  const updatedUser = await withTransaction(async (session) => {
    const updated = await setupRepository.markSetupComplete(
      userId,
      { currencyCode: body.currencyCode, locale, tzid: body.tzid },
      { session },
    );
    if (!updated) throw alreadyDone();

    const savings = await accountRepository.create(
      userId,
      {
        ...savingsAccount(balances.savingsMinor ?? 0),
        nameKey: "savings",
        activeNameKey: "savings",
      },
      { session },
    );
    const others = otherAccounts(balances, savings._id).map((doc) => ({
      ...doc,
      nameKey: doc.name.toLowerCase(),
      activeNameKey: doc.name.toLowerCase(),
    }));
    await accountRepository.createMany(userId, others, { session });
    if (body.starterCategories) {
      await categoryRepository.createMany(userId, starterCategoryDocs(), { session });
    }
    return updated;
  });

  const [accounts, categories, hasPassword] = await Promise.all([
    listAccounts(userId, { includeArchived: true }),
    listCategories(userId, { includeArchived: true }),
    userRepository.hasPassword(userId),
  ]);
  return {
    user: toUserDto(updatedUser, { hasPassword: Boolean(hasPassword) }),
    accounts,
    categories,
  };
}
