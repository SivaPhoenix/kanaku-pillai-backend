import { LIMITS } from "../constants/enums.js";
import { ERROR_CODES } from "../constants/error-codes.js";
import { HTTP_STATUS } from "../constants/http-status.js";
import * as favouriteRepository from "../repositories/favourite.repository.js";
import { ApiError } from "../utils/api-error.js";
import { resolveEntryReferences } from "./ledger-rules.service.js";

const idOrNull = (value) => (value ? String(value) : null);

function toFavouriteDto(favourite) {
  return {
    id: String(favourite._id),
    title: favourite.title,
    icon: favourite.icon,
    type: favourite.type,
    amountMinor: favourite.amountMinor,
    categoryId: idOrNull(favourite.categoryId),
    accountId: String(favourite.accountId),
    toAccountId: idOrNull(favourite.toAccountId),
    note: favourite.note ?? null,
    sortOrder: favourite.sortOrder,
    createdAt: favourite.createdAt.toISOString(),
  };
}

const notFound = () =>
  new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND, "Favourite not found");

export async function listFavourites(userId) {
  return (await favouriteRepository.listSorted(userId)).map(toFavouriteDto);
}

export async function createFavourite(userId, body) {
  if ((await favouriteRepository.countByUser(userId)) >= LIMITS.favourites) {
    throw new ApiError(
      HTTP_STATUS.CONFLICT,
      ERROR_CODES.LIMIT_REACHED,
      `You can have at most ${LIMITS.favourites} favourites`,
    );
  }
  const { categoryId, toAccountId, note, ...rest } = body;
  await resolveEntryReferences(userId, {
    type: body.type,
    categoryId: categoryId ?? null,
    accountId: body.accountId,
    toAccountId: toAccountId ?? null,
  });
  const sortOrder = (await favouriteRepository.maxSortOrder(userId)) + 1;
  const fields = { ...rest, sortOrder };
  if (categoryId) fields.categoryId = categoryId;
  if (toAccountId) fields.toAccountId = toAccountId;
  if (note) fields.note = note;
  return toFavouriteDto(await favouriteRepository.create(userId, fields));
}

export async function updateFavourite(userId, favouriteId, body) {
  const existing = await favouriteRepository.findOwned(userId, favouriteId);
  if (!existing) throw notFound();

  const pick = (key) => (key in body ? body[key] : existing[key]);
  await resolveEntryReferences(
    userId,
    {
      type: pick("type"),
      categoryId: pick("categoryId") ?? null,
      accountId: pick("accountId"),
      toAccountId: pick("toAccountId") ?? null,
    },
    { allowArchivedIds: [existing.accountId, existing.toAccountId, existing.categoryId] },
  );

  const set = {};
  const unset = [];
  for (const [key, value] of Object.entries(body)) {
    if (value === null) unset.push(key);
    else set[key] = value;
  }
  const updated = await favouriteRepository.update(userId, favouriteId, { set, unset });
  if (!updated) throw notFound();
  return toFavouriteDto(updated);
}

export async function deleteFavourite(userId, favouriteId) {
  if (!(await favouriteRepository.deleteOwned(userId, favouriteId))) throw notFound();
}

export async function reorderFavourites(userId, ids) {
  if (new Set(ids).size !== ids.length) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
      "Request validation failed",
      [{ field: "body.ids", message: "must not contain duplicates" }],
    );
  }
  if ((await favouriteRepository.countOwnedByIds(userId, ids)) !== ids.length) throw notFound();

  // Favourites missing from the list keep their relative order after the listed ones.
  const listed = new Set(ids);
  const rest = (await favouriteRepository.listSorted(userId))
    .map((favourite) => String(favourite._id))
    .filter((id) => !listed.has(id));
  await favouriteRepository.setOrder(userId, [...ids, ...rest]);
  return listFavourites(userId);
}
