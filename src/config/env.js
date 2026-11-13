import { z } from "zod";

const csvList = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().min(1).default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    MONGODB_URI: z
      .string()
      .regex(/^mongodb(\+srv)?:\/\/.+/, "must be a mongodb:// or mongodb+srv:// connection string"),
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
    JSON_BODY_LIMIT: z
      .string()
      .regex(/^\d+(b|kb|mb)$/, "use a size like 100kb")
      .default("100kb"),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
    DNS_SERVERS: csvList.pipe(
      z.array(z.union([z.ipv4(), z.ipv6()], { error: "each DNS server must be an IP address" })),
    ),
    JWT_ACCESS_SECRET: z.string().min(32, "must be at least 32 characters (use a random value)"),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    GOOGLE_CLIENT_IDS: csvList.pipe(
      z.array(
        z
          .string()
          .regex(
            /^[\w-]+\.apps\.googleusercontent\.com$/,
            "each Google client ID must end in .apps.googleusercontent.com",
          ),
      ),
    ),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && env.GOOGLE_CLIENT_IDS.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["GOOGLE_CLIENT_IDS"],
        message: "is required in production",
      });
    }
  });

export class EnvError extends Error {
  constructor(issues) {
    super(
      `Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`,
    );
    this.name = "EnvError";
    this.issues = issues;
  }
}

export function loadEnv(source) {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`),
    );
  }
  return Object.freeze(result.data);
}

function loadEnvOrExit() {
  try {
    return loadEnv(process.env);
  } catch (error) {
    // The logger depends on this config, so a bad config can only be reported on stderr.
    // eslint-disable-next-line no-console
    console.error(error.message);
    process.exit(1);
  }
}

export const env = loadEnvOrExit();
