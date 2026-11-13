import { AUTH_METHODS } from "../constants/enums.js";
import { ERROR_CODES } from "../constants/error-codes.js";
import { HTTP_STATUS } from "../constants/http-status.js";
import * as userRepository from "../repositories/user.repository.js";
import { ApiError } from "../utils/api-error.js";

// The only user shape that leaves the API: no _id, __v, password hash or Google subject id.
export function toUserDto(user, { hasPassword }) {
  const authMethods = [];
  if (hasPassword) authMethods.push(AUTH_METHODS.PASSWORD);
  if (user.googleSub) authMethods.push(AUTH_METHODS.GOOGLE);

  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl ?? null,
    emailVerified: Boolean(user.emailVerifiedAt),
    authMethods,
    settings: { ...user.settings },
    setupComplete: user.setupComplete,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function getMe(userId) {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND, "Account not found");
  }
  const hasPassword = Boolean(await userRepository.hasPassword(userId));
  return toUserDto(user, { hasPassword });
}
