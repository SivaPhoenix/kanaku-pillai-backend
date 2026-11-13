import { ERROR_CODES } from "../constants/error-codes.js";
import { HTTP_STATUS } from "../constants/http-status.js";
import * as accountRepository from "../repositories/account.repository.js";
import * as categoryRepository from "../repositories/category.repository.js";
import { ApiError } from "../utils/api-error.js";

// The transaction rules (docs/api/README.md → Transaction rules), shared by transactions, favourites and repeat rules.

const badRequest = (code, message) => new ApiError(HTTP_STATUS.BAD_REQUEST, code, message);
const notFound = (what) =>
  new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND, `${what} not found`);

function checkShape({ type, categoryId, accountId, toAccountId }) {
  if (type === "transfer") {
    if (categoryId)
      throw badRequest(ERROR_CODES.CATEGORY_NOT_ALLOWED, "Transfers don't have a category");
    if (!toAccountId) {
      throw badRequest(ERROR_CODES.TRANSFER_TARGET_REQUIRED, "Choose the account to transfer to");
    }
    if (String(toAccountId) === String(accountId)) {
      throw badRequest(ERROR_CODES.TRANSFER_SAME_ACCOUNT, "From and To must be different accounts");
    }
    return;
  }
  if (!categoryId) throw badRequest(ERROR_CODES.CATEGORY_REQUIRED, "Choose a category");
  if (toAccountId) {
    throw badRequest(ERROR_CODES.TRANSFER_TARGET_NOT_ALLOWED, "Only transfers have a To account");
  }
}

// Validates an entry's shape and references for this user. `allowArchivedIds` lets an edit keep a reference it already had.
// Returns { account, toAccount, category } as stored documents.
export async function resolveEntryReferences(
  userId,
  { type, categoryId = null, accountId, toAccountId = null },
  { session, allowArchivedIds = [] } = {},
) {
  checkShape({ type, categoryId, accountId, toAccountId });

  const keepArchived = new Set(allowArchivedIds.filter(Boolean).map(String));
  const [account, toAccount, category] = await Promise.all([
    accountRepository.findOwned(userId, accountId, { session }),
    toAccountId ? accountRepository.findOwned(userId, toAccountId, { session }) : null,
    categoryId ? categoryRepository.findOwned(userId, categoryId, { session }) : null,
  ]);

  if (!account) throw notFound("Account");
  if (toAccountId && !toAccount) throw notFound("Transfer account");
  if (categoryId && !category) throw notFound("Category");

  for (const ref of [account, toAccount]) {
    if (ref?.archivedAt && !keepArchived.has(String(ref._id))) {
      throw new ApiError(
        HTTP_STATUS.CONFLICT,
        ERROR_CODES.ACCOUNT_ARCHIVED,
        `${ref.name} is archived`,
      );
    }
  }
  if (category?.archivedAt && !keepArchived.has(String(category._id))) {
    throw new ApiError(
      HTTP_STATUS.CONFLICT,
      ERROR_CODES.CATEGORY_ARCHIVED,
      `${category.name} is archived`,
    );
  }

  if (type === "transfer" && (account.type === "debit_card" || toAccount.type === "debit_card")) {
    throw badRequest(
      ERROR_CODES.DEBIT_CARD_TRANSFER,
      "A debit card spends from its bank account; transfer with the bank account instead",
    );
  }
  if (category && category.kind !== type) {
    throw badRequest(ERROR_CODES.CATEGORY_KIND_MISMATCH, `Choose an ${type} category`);
  }

  return { account, toAccount, category };
}
