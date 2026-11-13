// Financial data must never sit in a browser or proxy cache.
export function noStore(_req, res, next) {
  res.setHeader("Cache-Control", "no-store");
  next();
}
