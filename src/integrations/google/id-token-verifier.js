import { OAuth2Client } from "google-auth-library";
import { env } from "../../config/env.js";

const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

const client = new OAuth2Client();

export class GoogleTokenError extends Error {
  constructor(message) {
    super(message);
    this.name = "GoogleTokenError";
  }
}

export function isGoogleSignInConfigured() {
  return env.GOOGLE_CLIENT_IDS.length > 0;
}

// Checks Google's signature (public keys are fetched and cached by the library), the audience (one of our client IDs), issuer and expiry.
export async function verifyGoogleIdToken(idToken) {
  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: [...env.GOOGLE_CLIENT_IDS] });
    payload = ticket.getPayload();
  } catch (error) {
    throw new GoogleTokenError(error.message);
  }

  if (!payload?.sub || !GOOGLE_ISSUERS.has(payload.iss)) {
    throw new GoogleTokenError("Unexpected token issuer or subject");
  }

  return {
    sub: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified === true,
    name: payload.name,
    picture: payload.picture,
  };
}
