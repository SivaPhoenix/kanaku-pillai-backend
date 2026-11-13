# Kanaku Pillai — Backend (kanaku-pillai-backend)

REST API for the Kanaku Pillai expense tracker. It owns auth, all money and domain rules, the API contract consumed by the web and mobile apps, and the scheduled jobs.

**Read first:** `docs/PROJECT.md` (product, scope, domain rules, architecture; shared across all three repos) → `docs/api/README.md` (the API contract this repo owns) → `docs/design-spec.md` §1.1 and §9 (domain decisions and data model) → `docs/auth/google-sign-in.md` (sign-in design).

Sibling repos (cloned next to this one): `../kanaku-pillai-web` (React + Vite) and `../kanaku-pillai-app` (Expo). Any change to a request or response shape is a contract change. Update `docs/api/` in the same PR and say in the PR description what each client must change.

## Stack

- **JavaScript (no TypeScript)**, ES modules (`"type": "module"`, `import`/`export`, `.js` extensions in relative imports). Node.js ≥ 22.13.
- Express 5, Mongoose 9 on MongoDB **running as a replica set** (multi-document transactions are required). Dev and prod use MongoDB Atlas (a replica set by default). Tests use an in-memory replica set, so no local MongoDB install is needed.
- Zod 4 for env and request validation, pino and pino-http for logs, helmet, cors, compression.
- Auth: @node-rs/argon2 (argon2id passwords), jsonwebtoken (HS256 access tokens), google-auth-library (Google ID-token verification), cookie-parser (web refresh cookie), express-rate-limit with a MongoDB store (`middleware/rate-limit.js`) so limits hold across instances. Later: luxon (time zones).
- Tests: Vitest, supertest, mongodb-memory-server (replica-set mode). Lint: ESLint 10 (flat config) plus Prettier.
- Env loading: Node's built-in `--env-file-if-exists=.env` (no dotenv).

## Commands

- `npm run dev`: API with watch on port 4000 (reads `.env`)
- `npm start`: production start (env comes from the platform, not a file)
- `npm run lint` / `lint:fix`, `npm run format` / `format:check`, `npm test`, `npm run test:watch`
- `npm run check`: lint, format check and tests (what CI runs)
- Health: `GET /health` (liveness, always 200 while the process runs) and `GET /ready` (200 only while MongoDB is connected, otherwise 503)
- `npm run db:indexes`: builds every index on the configured database (the production deploy step)
- Planned: `npm run worker` (job process), `npm run seed` (design spec §10 fixtures, dev DB only)

## Folder structure (production layout — follow it exactly)

```
src/
  server.js                 start: optional DNS override, connect DB, listen; graceful shutdown on SIGTERM/SIGINT
  app.js                    createApp(): request-id, pino-http, helmet, cors, compression, json limit, routes, not-found, error
  config/
    env.js                  Zod-validated process.env → frozen `env`; exits with a readable list on bad config
    db.js                   mongoose connect/disconnect/isDbConnected, strictQuery, sanitizeFilter, connection logs
    logger.js               pino instance; redacts authorization, cookies, passwords, tokens, codes, emails
    cors.js                 CORS options (all origins, no credentials — see Security rules)
  constants/                http-status.js  error-codes.js  headers.js  (later: enums.js, limits.js)
  routes/
    index.js                /health, /ready, and /api/v1 (with Cache-Control: no-store)
    v1/index.js             mounts each resource router: auth, me, accounts, categories, transactions, stats, favourites, recurrences
    v1/<resource>.route.js
  controllers/              <resource>.controller.js — thin: read req.validated → call service → ok(res, status, data)
  services/                 <resource>.service.js — business rules, orchestration, DB transactions (session passed down)
  repositories/             <resource>.repository.js — the ONLY layer that touches Mongoose models; every query takes userId
  models/                   <resource>.model.js — Mongoose schema + indexes + model (the persistence shape)
  schemas/                  <resource>.schema.js — Zod request schemas for params / query / body
  middleware/
    request-id.js  http-logger.js  validate.js  no-store.js  not-found.js  error.js
    (later: auth.js, idempotency.js, rate-limit.js)
  utils/                    api-error.js  api-response.js  (later: money.js, time.js, pagination.js, crypto.js, password.js)
  jobs/                     scheduler, recurrence, purge-deleted, account-deletion (run by a separate worker process)
  integrations/             google/ (ID-token verifier), mail/ (MailTransport: console in dev + provider adapter)
tests/
  setup-env.js              fixed test env, loaded before any src import
  unit/                     pure functions and middleware
  integration/              supertest against createApp() (+ in-memory replica set when the DB is needed)
  helpers/                  db.js (startTestDb / stopTestDb / resetTestDb), later auth and fixture builders
docs/                       PROJECT.md  design-spec.md  api/README.md  auth/google-sign-in.md  decisions/
```

**Naming:** kebab-case resource with a dotted role suffix: `transaction.route.js`, `transaction.controller.js`, `transaction.service.js`, `transaction.repository.js`, `transaction.model.js`, `transaction.schema.js`. "Model" means the Mongoose persistence definition. "Schema" means Zod request validation. Never mix the two.

## Layer rules

1. **route → controller → service → repository → model.** No skipping layers, no upward imports. Routes only wire middleware (`auth`, `validate({ params, query, body })`, rate limit) and a controller.
2. **Controllers** never import models or repositories. **Services** never import `express` or touch `req`/`res`. **Repositories** hold no business rules.
3. **Every repository function takes `userId` as its first argument and puts it in the filter.** No `findById` without `userId`. This is the multi-tenant boundary and the top review item. The one exception is `user.repository.js`, because users are the tenant root and are looked up by their own id, email or Google id.
4. **Multi-document writes** (instalment plan + N entries, archive checks, account deletion, Google account linking, signup) run through `withTransaction(fn)` from `utils/transaction.js`. The session is passed explicitly to repository calls (`{ session }`).
5. **Server-built query operators must be wrapped in `mongoose.trusted()`**, for example `expiresAt: mongoose.trusted({ $gt: now })`. `sanitizeFilter` is on, so an unwrapped `{ $gt: … }` is neutralised and the query fails with a cast error (500). Never wrap anything that came from a request. Use `returnDocument: "after"` (not the deprecated `new: true`) in `findOneAndUpdate`.
6. **Errors:** throw `new ApiError(status, code, message, details?)` from services. Codes live in `constants/error-codes.js` and are never renamed (clients branch on them). 404, not 403, when a record belongs to someone else. Express 5 forwards rejected async handlers to the error middleware, so no try/catch wrappers are needed in controllers.
7. **Validation:** `validate({ params, query, body })` with Zod `.strict()` objects (unknown keys rejected). The parsed values are on **`req.validated.params|query|body`** (Express 5 makes `req.query` read-only). Never read raw `req.body` or `req.query` after validation. Ids are validated as ObjectId strings, and query numbers are coerced and bounded (`limit` ≤ 100).
8. **Responses:** `ok(res, status, data, page?)` → `{ data }` or `{ data, page: { nextCursor, limit } }`. Errors → `{ error: { code, message, details?, requestId } }` from `middleware/error.js`. Models are mapped to plain DTOs in the service (`id` string, never `_id`/`__v`, never `passwordHash`).

## Domain rules (from docs/PROJECT.md §3 — enforced here, not in clients)

- `amountMinor`: positive safe integer (`Number.isSafeInteger`, > 0). No floats in models, schemas, or aggregation output.
- Transactions store `occurredAt` (Date, UTC), `tzid` (validated IANA), and denormalised `localDate` (`YYYY-MM-DD`) and `localMonth` (`YYYY-MM`) computed with luxon at write time. All day, month and period grouping uses these fields.
- Totals and stats use `$match: { type: { $in: ["income", "expense"] } }`. Transfers are excluded everywhere except account balances.
- Transfer: `categoryId` must be absent, `toAccountId` is required and ≠ `accountId`, and neither may be a `debit_card`. Income and expense: `categoryId` is required and its `kind` matches `type`.
- Debit-card activity rolls into `linkedAccountId` for balances. Credit-card balance = amount owed.
- Instalments only when the account `type` is `credit_card`. The remainder of `total % months` goes on the first entry, so the parts always sum exactly.
- Recurrence generation is idempotent with a unique index `{ recurrenceId, occurrenceDate }`. Duplicate key errors mean "already generated" and are not failures.
- Soft delete: `deletedAt` set; the undo endpoint restores it within the window. The purge job hard-deletes after 30 days. Archived categories and accounts are excluded from pickers, never from history.
- Delete account: revoke all sessions immediately, then the job hard-deletes every collection's documents for that `userId`.
- Category and account `icon` values are icon names from the clients' fixed icon list (validate against an allowlist), never emoji — the UI never shows emoji (product decision 13 Nov 2026).

## Security rules

- **CORS allows every origin (`*`) with credentials off** (product owner's decision). The API authenticates with `Authorization: Bearer` tokens, which other sites cannot read, so open CORS does not expose user data. Browsers never send cookies cross-origin under this policy. **Never switch to reflecting the request origin with `credentials: true`**: that would let any website use a signed-in user's refresh cookie.
- **Web refresh cookie:** `httpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`. It works only while the web app calls the API on its **own origin**: the Vite dev proxy (`/api` → `localhost:4000`) and a reverse proxy in production. Native apps get the refresh token in the response body (selected by `X-Client-Platform: ios|android`).
- argon2id for passwords. Refresh tokens and OTP codes are stored as SHA-256 hashes only, compared with `crypto.timingSafeEqual`.
- Access JWT is 15 min, carries `sub` plus `sid`, and uses HS256 with a ≥ 32-byte secret from env (pin the algorithm on verify). Refresh token is opaque and rotated on every use, and reuse of an old one revokes the whole session family.
- Google sign-in: verify the ID token's signature, `iss`, `aud` (all our client IDs) and `exp`; require `email_verified`; identify by `sub`, never by email. Linking rules are in `docs/auth/google-sign-in.md`.
- Forgot password responds identically whether or not the email exists. The OTP lasts 10 minutes, allows 5 attempts and has a resend cooldown. A reset revokes all sessions.
- Rate limits on login, signup, google, forgot, verify-code and refresh, keyed by IP plus email.
- Mongoose `sanitizeFilter` and `strictQuery` are on (`config/db.js`), and Express uses the "simple" query parser. Never spread request data into a filter or update; build them from `req.validated` fields.
- Logs never contain passwords, tokens, OTP codes or emails (pino `redact` in `config/logger.js`). Error responses never contain stack traces.
- `.env` is never committed, printed or logged. `.env.example` lists every key with a safe or empty value. The Atlas URI holds a password, so treat it like one.

## Indexes (define in the model, verify with the review agent)

- users: `{ email: 1 }` unique (lowercased), `{ googleSub: 1 }` unique sparse
- transactions: `{ userId: 1, localDate: -1, occurredAt: -1 }`, `{ userId: 1, accountId: 1, localDate: -1 }`, `{ userId: 1, toAccountId: 1 }` sparse, `{ userId: 1, categoryId: 1, localMonth: 1 }`, `{ userId: 1, deletedAt: 1 }`, `{ recurrenceId: 1, occurrenceDate: 1 }` unique partial
- accounts and categories: `{ userId: 1, archivedAt: 1, sortOrder: 1 }`
- sessions: `{ userId: 1 }`, `{ tokenHash: 1 }` unique, TTL on `expiresAt`
- idempotency keys: `{ userId: 1, key: 1 }` unique, TTL 24 h
- `autoIndex` is on outside production. In production, indexes are built by the deploy step `npm run db:indexes` (`scripts/sync-indexes.js`; add every new model to it), never at app start.

## Code style

- Small, single-purpose functions. Named exports only (no default exports).
- Prettier formats everything (100 columns, double quotes, trailing commas). ESLint forbids `console`, `var`, loose equality and unused variables (prefix intentionally unused args with `_`).
- Single-line `//` comments only, and only where the _why_ is not obvious. No JSDoc blocks.
- No `console.*`; use `logger` or `req.log` (carries the request id).
- Edit files directly; never generate code changes through ad-hoc patch scripts.

## Definition of done (backend)

1. `npm run check` is green (lint, format, tests).
2. New and changed endpoints have integration tests covering: happy path, validation 400, unauthenticated 401, other-user 404, and every domain rule they touch.
3. `docs/api/README.md` is updated if any route, request or response changed.
4. The `backend-reviewer` agent finds no issues. For auth, session or data-access changes, `security-reviewer` also finds none.

## Agents (`.claude/agents/`)

| Agent                     | Use it when                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `backend-feature-builder` | Implementing an endpoint or feature end to end across the layers above                      |
| `backend-reviewer`        | Reviewing a diff before commit: layering, userId scoping, validation, errors, tests         |
| `security-reviewer`       | Any change to auth, sessions, tokens, rate limits, data access, or before a release         |
| `ledger-domain-expert`    | Questions or code involving balances, transfers, cards, instalments, recurrence, time zones |
| `api-contract-keeper`     | After route changes: sync `docs/api/README.md`, flag breaking changes for web and app       |
| `backend-test-writer`     | Writing or extending unit and integration tests for a module                                |

## Working rules

- **Use subagents on cheaper models for scoped work.** Do not run every task on Opus. Delegate well-specified work to a subagent with `model: "sonnet"` (implementation from a clear brief, reviews, tests) or `model: "haiku"` (mechanical edits, searches, doc syncs). Keep Opus for architecture, design decisions and integrating results. Give parallel subagents separate files, and verify what each one returns before reporting it done. The agents in `.claude/agents/` already run on Sonnet.
- Plan first for anything larger than a small fix. Build after the product owner approves.
- Work on `feat/…`, `fix/…` or `chore/…` branches, then open a PR to `main`. Conventional Commit messages.
- Never commit secrets, `.env`, real user data or connection strings.
- Never run destructive DB commands (drop, deleteMany without a userId filter) against anything but the in-memory test database. The Atlas database is shared dev data.
- Keep `docs/PROJECT.md` identical across the three repos. If you edit it here, copy it to the siblings.
