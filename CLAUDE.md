# Kanaku Pillai — Backend (kanaku-pillai-backend)

REST API for the Kanaku Pillai expense tracker. It owns auth, all money and domain rules, the API contract consumed by the web and mobile apps, and the scheduled jobs.

**Read first:** `docs/PROJECT.md` (product, scope, domain rules, architecture; shared across all three repos) → `docs/api/README.md` (the API contract this repo owns) → `docs/design-spec.md` §1.1 and §9 (domain decisions and data model).

Sibling repos (cloned next to this one): `../kanaku-pillai-web` (React + Vite) and `../kanaku-pillai-app` (Expo). Any change to a request or response shape is a contract change. Update `docs/api/` in the same PR and say in the PR description what each client must change.

## Stack
- Node.js ≥ 22, TypeScript (strict), ES modules. Run with `tsx` in dev and compile with `tsc` to `dist/` for production.
- Express 5, Mongoose 8 on MongoDB 7+ **running as a replica set** (multi-document transactions are required). Locally that means a single-node replica set.
- Zod for env and request validation, pino and pino-http for logs, helmet, cors, express-rate-limit (Mongo-backed store so limits hold across instances), argon2 for passwords, jsonwebtoken, google-auth-library, luxon for time zones.
- Tests: Vitest, supertest, mongodb-memory-server (replica-set mode).

## Commands (once scaffolded)
- `npm run dev`: API with watch (port 4000)
- `npm run worker`: job process (repeat generation, purge, account deletion)
- `npm run build` / `npm start`: compile, then run `dist/server.js`
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:watch`
- `npm run seed`: fixture data from design spec §10 (dev database only)
- Health: `GET /health` (liveness) and `GET /ready` (DB reachable)

## Folder structure (production layout — follow it exactly)

```
src/
  server.ts                 HTTP server start, graceful shutdown (SIGTERM: stop accepting, drain, close DB)
  worker.ts                 job process entry (never started by the API)
  app.ts                    express app: request-id, helmet, cors, json limit, pino-http, routes, not-found, error
  config/
    env.ts                  Zod-validated process.env → typed `env` object; process exits on invalid config
    db.ts                   mongoose connect/disconnect, strictQuery, sanitizeFilter, connection events
    logger.ts               pino instance; redacts authorization, cookies, password, token, code fields
    cors.ts                 allowlist from env (no wildcard with credentials)
  constants/
    http-status.ts  error-codes.ts  enums.ts (TxType, AccountType, …)  limits.ts
  routes/
    index.ts                mounts /health, /ready, /api/v1
    v1/
      index.ts              mounts each resource router
      auth.route.ts  account.route.ts  category.route.ts  transaction.route.ts
      stats.route.ts  favourite.route.ts  recurrence.route.ts  settings.route.ts  user.route.ts
  controllers/              *.controller.ts — thin: read validated req → call service → send response. No DB, no rules.
  services/                 *.service.ts — business rules, orchestration, DB transactions (session passed down)
  repositories/             *.repository.ts — the ONLY layer that touches Mongoose models; every query takes userId
  models/                   *.model.ts — Mongoose schema + indexes + model (the persistence shape)
  schemas/                  *.schema.ts — Zod request schemas (body / query / params) and inferred DTO types
  middleware/
    request-id.ts  auth.ts (verify access JWT → req.user)  validate.ts (Zod → 400)
    idempotency.ts  rate-limit.ts  not-found.ts  error.ts (ApiError → envelope; unknown → 500, no stack leak)
  utils/
    api-error.ts  api-response.ts  async-handler.ts  money.ts  time.ts (localDate from instant+tzid)
    pagination.ts (cursor)  crypto.ts (token gen, sha256)  password.ts
  jobs/
    scheduler.ts            registers jobs with a Mongo lock so each run happens once across workers
    recurrence.job.ts  purge-deleted.job.ts  account-deletion.job.ts
  integrations/
    mail/                   MailTransport interface + console (dev) + provider adapter (TBD)
    google/                 ID-token verification
  types/
    express.d.ts            req.user, req.requestId augmentation
tests/
  unit/                     pure functions (money, time, recurrence math, balance math)
  integration/              supertest against app + in-memory replica set, one file per resource
  helpers/                  app factory, db reset, auth helper (issues tokens directly), fixtures
scripts/                    seed.ts, create-indexes.ts
docs/
  PROJECT.md  design-spec.md  api/README.md  decisions/ (ADR-NNNN-title.md)
```

**Naming:** kebab-case resource, dotted role suffix: `transaction.route.ts`, `transaction.controller.ts`, `transaction.service.ts`, `transaction.repository.ts`, `transaction.model.ts`, `transaction.schema.ts`. "Model" means the Mongoose persistence definition. "Schema" means Zod request validation. Never mix the two.

## Layer rules
1. **route → controller → service → repository → model.** No skipping layers, no upward imports. Routes only wire middleware (`auth`, `validate(schema)`, `rateLimit`) and a controller.
2. **Controllers** never import models or repositories. **Services** never import `express` or touch `req`/`res`. **Repositories** hold no business rules.
3. **Every repository method takes `userId` as its first argument and puts it in the filter.** No `findById` without `userId`. This is the multi-tenant boundary and the top review item.
4. **Multi-document writes** (instalment plan + N entries, archive checks, account deletion, refresh rotation) run in `mongoose.startSession()` / `withTransaction`. The session is passed explicitly to repository calls.
5. **Errors:** throw `ApiError(status, code, message, details?)` from services. Codes live in `constants/error-codes.ts` (for example `VALIDATION_ERROR`, `UNAUTHENTICATED`, `NOT_FOUND`, `CONFLICT`, `ACCOUNT_ARCHIVED`, `TRANSFER_SAME_ACCOUNT`). 404 (not 403) when a record belongs to someone else.
6. **Validation:** Zod schemas are `.strict()` (unknown keys rejected). Ids are validated as ObjectId strings. Query strings are coerced and bounded (`limit` ≤ 100).
7. **Responses:** `{ data }`, lists as `{ data, page: { nextCursor, limit } }`, errors as `{ error: { code, message, details?, requestId } }`. Models are mapped to DTOs in the service (`id` string, never `_id`/`__v`, never `passwordHash`).

## Domain rules (from docs/PROJECT.md §3 — enforced here, not in clients)
- `amountMinor`: positive safe integer (`Number.isSafeInteger`, > 0). No floats in models, schemas, or aggregation output.
- Transactions store `occurredAt` (Date, UTC), `tzid` (validated IANA), and denormalised `localDate` (`YYYY-MM-DD`) and `localMonth` (`YYYY-MM`) computed with luxon at write time. All day, month and period grouping uses these fields.
- Totals and stats use `$match: { type: { $in: ['income','expense'] } }`. Transfers are excluded everywhere except account balances.
- Transfer: `categoryId` must be absent, `toAccountId` is required and ≠ `accountId`, and neither may be a `debit_card`. Income and expense: `categoryId` is required and its `kind` matches `type`.
- Debit-card activity rolls into `linkedAccountId` for balances. Credit-card balance = amount owed.
- Instalments only when the account `type` is `credit_card`. The remainder of `total % months` goes on the first entry, so the parts always sum exactly.
- Recurrence generation is idempotent with a unique index `{ recurrenceId, occurrenceDate }`. Duplicate key errors mean "already generated" and are not failures.
- Soft delete: `deletedAt` set; the undo endpoint restores it within the window. The purge job hard-deletes after 30 days. Archived categories and accounts are excluded from pickers, never from history.
- Delete account: revoke all sessions immediately, then the job hard-deletes every collection's documents for that `userId`.

## Security rules
- argon2id for passwords. Refresh tokens and OTP codes are stored as SHA-256 hashes only. Compare with `crypto.timingSafeEqual`.
- Access JWT is 15 min, carries `sub` plus `sid`, and uses HS256 with a ≥ 32-byte secret from env. Refresh token is opaque and rotated on every use. Reuse of an old token revokes the whole session family.
- Web gets the refresh token in an `httpOnly; Secure; SameSite=Strict; Path=/api/v1/auth` cookie. Native gets it in the response body (selected by the `X-Client-Platform: ios|android` header).
- Forgot password responds identically whether or not the email exists. The OTP lasts 10 minutes, allows 5 attempts and has a resend cooldown. Resetting a password revokes all other sessions.
- Rate limits on login, signup, forgot, verify-code and refresh, keyed by IP plus email.
- Mongoose `sanitizeFilter: true`. Never spread `req.body` or `req.query` into a filter or update. Build them from validated fields.
- Logs never contain passwords, tokens, OTP codes or full emails (pino `redact`). Error responses never contain stack traces.
- `.env` is never read into output, committed or logged. `.env.example` holds every key with an empty value.

## Indexes (define in the model, verify with the review agent)
- users: `{ email: 1 }` unique (lowercased)
- transactions: `{ userId: 1, localDate: -1, occurredAt: -1 }`, `{ userId: 1, accountId: 1, localDate: -1 }`, `{ userId: 1, toAccountId: 1 }` sparse, `{ userId: 1, categoryId: 1, localMonth: 1 }`, `{ userId: 1, deletedAt: 1 }`, `{ recurrenceId: 1, occurrenceDate: 1 }` unique partial
- accounts and categories: `{ userId: 1, archivedAt: 1, sortOrder: 1 }`
- sessions: `{ userId: 1 }`, `{ tokenHash: 1 }` unique, TTL on `expiresAt`
- idempotency keys: `{ userId: 1, key: 1 }` unique, TTL 24 h

## Code style
- Small, single-purpose functions. Named exports. No default exports except the Express app and routers.
- Single-line `//` comments only, and only where the *why* is not obvious. No JSDoc blocks restating types.
- No `console.*`; use `logger` with a request id. No unhandled promise rejections. `async-handler` (or Express 5 native async errors) everywhere.
- Edit files directly; never generate code changes through ad-hoc patch scripts.

## Definition of done (backend)
1. `npm run lint`, `npm run typecheck` and `npm test` are all green.
2. New and changed endpoints have integration tests covering: happy path, validation 400, unauthenticated 401, other-user 404, and every domain rule they touch.
3. `docs/api/README.md` is updated if any route, request or response changed.
4. The `backend-reviewer` agent finds no issues. For auth, session or data-access changes, `security-reviewer` also finds none.

## Agents (`.claude/agents/`)
| Agent | Use it when |
|---|---|
| `backend-feature-builder` | Implementing an endpoint or feature end to end across the layers above |
| `backend-reviewer` | Reviewing a diff before commit: layering, userId scoping, validation, errors, tests |
| `security-reviewer` | Any change to auth, sessions, tokens, rate limits, data access, or before a release |
| `ledger-domain-expert` | Questions or code involving balances, transfers, cards, instalments, recurrence, time zones |
| `api-contract-keeper` | After route changes: sync `docs/api/README.md`, flag breaking changes for web and app |
| `backend-test-writer` | Writing or extending unit and integration tests for a module |

## Working rules
- Plan first for anything larger than a small fix. Build after the product owner approves.
- Never commit secrets, `.env`, real user data or production connection strings.
- Never run destructive DB commands (drop, deleteMany without a userId filter) against anything but a local or test database.
- Keep `docs/PROJECT.md` identical across the three repos. If you edit it here, copy it to the siblings.
