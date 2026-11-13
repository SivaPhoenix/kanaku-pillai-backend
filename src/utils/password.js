import { Algorithm, hash, verify } from "@node-rs/argon2";

// OWASP argon2id baseline: 19 MiB memory, 2 iterations, 1 lane.
const ARGON2_OPTIONS = Object.freeze({
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});

let dummyHashPromise;

export function hashPassword(password) {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash, password) {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Verifying against a throwaway hash when the account is missing keeps sign-in timing the same, so it doesn't reveal which emails exist.
export async function verifyAgainstDummy(password) {
  dummyHashPromise ??= hash("kanaku-pillai-dummy-password", ARGON2_OPTIONS);
  await verifyPassword(await dummyHashPromise, password);
  return false;
}
