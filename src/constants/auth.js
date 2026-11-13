export const REFRESH_COOKIE_NAME = "kp_refresh";

// The cookie is only ever sent to the auth routes, never with ordinary API calls.
export const REFRESH_COOKIE_PATH = "/api/v1/auth";

export const CLIENT_PLATFORM_HEADER = "X-Client-Platform";

// A web sign-in without "keep me signed in" ends after a day of inactivity instead of the full refresh lifetime.
export const SHORT_SESSION_DAYS = 1;

export const JWT_ISSUER = "kanaku-pillai";
export const JWT_AUDIENCE = "kanaku-pillai-api";
