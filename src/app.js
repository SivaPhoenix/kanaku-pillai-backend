import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { corsOptions } from "./config/cors.js";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error.js";
import { httpLogger } from "./middleware/http-logger.js";
import { notFound } from "./middleware/not-found.js";
import { requestId } from "./middleware/request-id.js";
import { routes } from "./routes/index.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", env.TRUST_PROXY);
  // Express 5's default "simple" query parser keeps query values flat (no nested objects), so keep it explicit.
  app.set("query parser", "simple");
  app.disable("x-powered-by");

  app.use(requestId);
  app.use(httpLogger);
  app.use(helmet());
  app.use(cors(corsOptions));
  app.use(compression());
  app.use(express.json({ limit: env.JSON_BODY_LIMIT }));

  app.use(routes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
