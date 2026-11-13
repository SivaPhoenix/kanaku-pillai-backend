import { LIMITS } from "../constants/enums.js";
import { ERROR_CODES } from "../constants/error-codes.js";
import { HTTP_STATUS } from "../constants/http-status.js";
import * as categoryRepository from "../repositories/category.repository.js";
import * as transactionRepository from "../repositories/transaction.repository.js";
import * as userRepository from "../repositories/user.repository.js";
import { ApiError } from "../utils/api-error.js";
import { isDuplicateKeyError } from "../utils/transaction.js";
import { currentMonthIn } from "../utils/time.js";

const notFound = () =>
  new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND, "Category not found");
const conflict = (code, message) => new ApiError(HTTP_STATUS.CONFLICT, code, message);

export function toCategoryDto(category, usageThisMonth = 0) {
  return {
    id: String(category._id),
    kind: category.kind,
    name: category.name,
    icon: category.icon,
    color: category.color,
    sortOrder: category.sortOrder,
    archived: Boolean(category.archivedAt),
    usageThisMonth,
    createdAt: category.createdAt.toISOString(),
  };
}

async function presentAll(userId, categories) {
  const user = await userRepository.findById(userId);
  const usage = await categoryRepository.usageByCategory(
    userId,
    currentMonthIn(user.settings.tzid),
  );
  return categories.map((category) =>
    toCategoryDto(category, usage.get(String(category._id)) ?? 0),
  );
}

export async function listCategories(userId, { kind, includeArchived = false } = {}) {
  const categories = await categoryRepository.listByUser(userId, { kind, includeArchived });
  return presentAll(userId, categories);
}

async function presentOne(userId, category) {
  const [dto] = await presentAll(userId, [category]);
  return dto;
}

const nameTaken = () =>
  conflict(ERROR_CODES.NAME_TAKEN, "You already have a category with this name");

async function assertNameFree(userId, kind, name, excludeId) {
  const taken = await categoryRepository.isNameTaken(userId, kind, name.toLowerCase(), {
    excludeId,
  });
  if (taken) throw nameTaken();
}

// The unique index on activeNameKey is the real guard; a lost race surfaces as a duplicate key.
async function guardName(write) {
  try {
    return await write();
  } catch (error) {
    if (isDuplicateKeyError(error)) throw nameTaken();
    throw error;
  }
}

async function assertUnderLimit(userId, kind) {
  if ((await categoryRepository.countActiveByKind(userId, kind)) >= LIMITS.categoriesPerKind) {
    throw conflict(
      ERROR_CODES.LIMIT_REACHED,
      `You can have at most ${LIMITS.categoriesPerKind} active ${kind} categories`,
    );
  }
}

export async function createCategory(userId, body) {
  await assertNameFree(userId, body.kind, body.name);
  await assertUnderLimit(userId, body.kind);
  const maxOrder = await categoryRepository.maxSortOrder(userId, body.kind);
  const nameKey = body.name.toLowerCase();
  const created = await guardName(() =>
    categoryRepository.create(userId, {
      ...body,
      nameKey,
      activeNameKey: nameKey,
      sortOrder: maxOrder + 1,
    }),
  );
  return presentOne(userId, created);
}

export async function updateCategory(userId, categoryId, body) {
  const existing = await categoryRepository.findOwned(userId, categoryId);
  if (!existing) throw notFound();
  if (body.name !== undefined && !existing.archivedAt) {
    await assertNameFree(userId, existing.kind, body.name, existing._id);
  }
  const set = { ...body };
  if (body.name) {
    set.nameKey = body.name.toLowerCase();
    if (!existing.archivedAt) set.activeNameKey = set.nameKey;
  }
  const updated = await guardName(() =>
    categoryRepository.updateOwned(userId, categoryId, { set }),
  );
  return presentOne(userId, updated);
}

export async function archiveCategory(userId, categoryId) {
  const existing = await categoryRepository.findOwned(userId, categoryId);
  if (!existing) throw notFound();
  if (existing.archivedAt) return presentOne(userId, existing);
  const updated = await categoryRepository.updateOwned(userId, categoryId, {
    set: { archivedAt: new Date() },
    unset: { activeNameKey: 1 },
  });
  return presentOne(userId, updated);
}

export async function unarchiveCategory(userId, categoryId) {
  const existing = await categoryRepository.findOwned(userId, categoryId);
  if (!existing) throw notFound();
  if (!existing.archivedAt) return presentOne(userId, existing);
  await assertNameFree(userId, existing.kind, existing.name, existing._id);
  await assertUnderLimit(userId, existing.kind);
  const updated = await guardName(() =>
    categoryRepository.updateOwned(userId, categoryId, {
      set: { activeNameKey: existing.nameKey },
      unset: { archivedAt: 1 },
    }),
  );
  return presentOne(userId, updated);
}

export async function deleteCategory(userId, categoryId) {
  const existing = await categoryRepository.findOwned(userId, categoryId);
  if (!existing) throw notFound();
  const [referenced, templates] = await Promise.all([
    transactionRepository.isCategoryReferenced(userId, categoryId),
    categoryRepository.isUsedByTemplates(userId, categoryId),
  ]);
  if (referenced || templates) {
    throw conflict(ERROR_CODES.IN_USE, "This category is in use; archive it instead");
  }
  await categoryRepository.deleteOwned(userId, categoryId);
}

export async function reorderCategories(userId, { kind, ids }) {
  if (new Set(ids).size !== ids.length) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
      "Request validation failed",
      [{ field: "body.ids", message: "must not contain duplicates" }],
    );
  }
  const owned = await categoryRepository.findOwnedByIds(userId, ids);
  if (owned.length !== ids.length || owned.some((category) => category.kind !== kind)) {
    throw notFound();
  }
  const all = await categoryRepository.listByUser(userId, { kind, includeArchived: true });
  const listed = new Set(ids);
  const rest = all.map((category) => String(category._id)).filter((id) => !listed.has(id));
  await categoryRepository.setSortOrders(userId, [...ids, ...rest]);
  return listCategories(userId, { kind, includeArchived: true });
}
