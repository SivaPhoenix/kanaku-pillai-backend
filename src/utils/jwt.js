import jwt from "jsonwebtoken";
import { JWT_AUDIENCE, JWT_ISSUER } from "../constants/auth.js";
import { env } from "../config/env.js";

const ALGORITHM = "HS256";

export function signAccessToken({ userId, sessionId }) {
  return jwt.sign({ sid: sessionId }, env.JWT_ACCESS_SECRET, {
    algorithm: ALGORITHM,
    subject: userId,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  });
}

// Pinning the algorithm, issuer and audience rejects "alg: none" and tokens minted for anything else.
export function verifyAccessToken(token) {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: [ALGORITHM],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
  return { userId: payload.sub, sessionId: payload.sid };
}

export function isTokenExpiredError(error) {
  return error instanceof jwt.TokenExpiredError;
}
