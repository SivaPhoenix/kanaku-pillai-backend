import { createHash, randomBytes } from "node:crypto";

// 256 bits of randomness, URL-safe; used for refresh tokens.
export function generateToken() {
  return randomBytes(32).toString("base64url");
}

// Tokens are stored only as SHA-256 digests, so a database leak exposes no usable token.
export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
