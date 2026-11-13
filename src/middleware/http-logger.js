import { pinoHttp } from "pino-http";
import { logger } from "../config/logger.js";

const PROBE_PATHS = new Set(["/health", "/ready"]);

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => req.requestId,
  autoLogging: { ignore: (req) => PROBE_PATHS.has(req.url) },
  customLogLevel: (_req, res, error) => {
    if (error || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});
