import { REQUEST_ID_HEADER } from "../constants/headers.js";

// Any origin may call the API. Credentials are off, because browsers reject "*" together with cookies,
// and the API authenticates with Bearer tokens that another site cannot read. The web app reaches the
// API on its own origin (Vite proxy in dev, reverse proxy in production), so its refresh cookie never needs CORS.
export const corsOptions = Object.freeze({
  origin: "*",
  credentials: false,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
  allowedHeaders: [
    "Authorization",
    "Content-Type",
    "Idempotency-Key",
    "X-Client-Platform",
    REQUEST_ID_HEADER,
  ],
  exposedHeaders: [REQUEST_ID_HEADER, "Retry-After"],
  maxAge: 600,
});
