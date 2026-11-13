import { randomUUID } from "node:crypto";
import { REQUEST_ID_HEADER } from "../constants/headers.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// A caller's id is kept only when it is a UUID, so arbitrary header text never lands in logs.
export function requestId(req, res, next) {
  const incoming = req.get(REQUEST_ID_HEADER);
  req.requestId = incoming && UUID_PATTERN.test(incoming) ? incoming.toLowerCase() : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, req.requestId);
  next();
}
