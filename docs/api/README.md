# Kanaku Pillai API — Contract (v1)

Owned by `kanaku-pillai-backend`. The web (`kanaku-pillai-web`) and mobile (`kanaku-pillai-app`) clients build against this document. **Status: planned.** Endpoints move to "built" as they ship. Any change to a shape here is a contract change: update this file in the same PR and list the client impact.

## Conventions

- **Base URL:** `/api/v1`, JSON only (`Content-Type: application/json`), UTF-8.
- **Auth:** `Authorization: Bearer <accessToken>` on every route except `/auth/*` (signup, login, google, refresh, forgot-*) and the health checks.
- **Client platform:** clients send `X-Client-Platform: web | ios | android`. The value decides how the refresh token is delivered and is stored as `createdOn` on transactions.
- **Request id:** the server returns `X-Request-Id`, and a client-supplied one is accepted if it is a valid UUID. Error bodies repeat it.
- **Idempotency:** `POST /transactions`, `POST /transfers`-style creates and `POST /favourites/:id/apply` accept `Idempotency-Key: <uuid>`. Repeating the same key within 24 h returns the original response.
- **Ids:** opaque strings (`id`). Never send `_id`.
- **Money:** `amountMinor` is an integer in the user's currency minor unit, always > 0, with sign implied by `type`. Clients format it, and they never send or receive floats.
- **Time:** `occurredAt` is an ISO-8601 UTC instant and `tzid` is an IANA zone. The server derives `localDate` (`YYYY-MM-DD`) and returns it read-only.
- **Success:** `{ "data": … }`. Lists: `{ "data": [ … ], "page": { "nextCursor": "…" | null, "limit": 50 } }`. Pass `?cursor=` to continue, `limit` ≤ 100.
- **Errors:** `{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [{ "field": "amountMinor", "message": "…" }], "requestId": "…" } }`.

| Status | Codes                                                                                                          |
| ------ | -------------------------------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`, `TRANSFER_SAME_ACCOUNT`, `CATEGORY_KIND_MISMATCH`, `INSTALMENT_NOT_CREDIT_CARD`            |
| 401    | `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS`, `GOOGLE_TOKEN_INVALID`, `GOOGLE_EMAIL_NOT_VERIFIED` |
| 413    | `PAYLOAD_TOO_LARGE`                                                                                            |
| 400    | also `INVALID_JSON` (malformed request body)                                                                   |
| 404    | `NOT_FOUND` (also returned for records owned by another user)                                                  |
| 409    | `CONFLICT`, `EMAIL_TAKEN`, `ACCOUNT_ARCHIVED`, `IN_USE` (delete blocked: archive instead)                      |
| 429    | `RATE_LIMITED` (with `Retry-After`)                                                                            |
| 500    | `INTERNAL` (no details, no stack)                                                                              |

## Resources

### Auth — `/auth`

| Method | Path                    | Body → Response                                                                      |
| ------ | ----------------------- | ------------------------------------------------------------------------------------ |
| POST   | `/auth/signup`          | `{ name, email, password }` → `{ user, accessToken, refreshToken? }`                 |
| POST   | `/auth/login`           | `{ email, password, keepSignedIn? }` → same as signup                                |
| POST   | `/auth/google`          | `{ idToken }` → `{ user, accessToken, refreshToken?, isNewUser }` (see below)        |
| POST   | `/auth/refresh`         | web: cookie, native: `{ refreshToken }` → `{ accessToken, refreshToken? }` (rotated) |
| POST   | `/auth/logout`          | → 204 (revokes the current session)                                                  |
| POST   | `/auth/forgot/request`  | `{ email }` → 202 (always, whether or not the email exists)                          |
| POST   | `/auth/forgot/verify`   | `{ email, code }` → `{ resetToken }` (short-lived, single use)                       |
| POST   | `/auth/forgot/reset`    | `{ resetToken, password }` → 204 (revokes every session)                             |
| POST   | `/auth/change-password` | `{ currentPassword, newPassword }` → 204 (revokes the other sessions)                |

`refreshToken` appears in bodies only for native clients. Web receives it as an `httpOnly` cookie.

**Google sign-in:** `idToken` is the Google ID token from Google Identity Services (web) or `@react-native-google-signin` (app). The server verifies it and finds the account by Google id, links it by verified email, or creates it. `isNewUser: true` means the client goes to `/setup`. Errors: 401 `GOOGLE_TOKEN_INVALID`, 401 `GOOGLE_EMAIL_NOT_VERIFIED`. The full design is in `docs/auth/google-sign-in.md`.

### Me and settings — `/me`

| Method | Path               | Notes                                                                                                         |
| ------ | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| GET    | `/me`              | `{ id, name, email, settings, setupComplete, createdAt }`                                                     |
| PATCH  | `/me`              | `{ name? }`                                                                                                   |
| PATCH  | `/me/settings`     | `{ currencyCode?, tzMode?, tzid?, theme?, weekStart? }`. A currency change relabels and never converts        |
| POST   | `/me/setup`        | `{ currencyCode, tzid, startingBalances?, starterCategories? }` → marks setup complete and seeds the defaults |
| GET    | `/me/sessions`     | Signed-in devices `{ id, platform, userAgent, lastUsedAt, current }`                                          |
| DELETE | `/me/sessions/:id` | Sign out one device                                                                                           |
| DELETE | `/me`              | `{ confirm: "DELETE" , password? }` → 202. Sessions are revoked now, and the data is purged by a job          |

### Accounts — `/accounts`

| Method | Path                                     | Notes                                                                                                           |
| ------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| GET    | `/accounts?includeArchived=false`        | Each with computed `balanceMinor` (credit card: `owedMinor`, plus `limitUsedPct`, `statementMinor`, `dueDate`)  |
| GET    | `/accounts/summary`                      | `{ netWorthMinor, assetsMinor, liabilitiesMinor }`                                                              |
| POST   | `/accounts`                              | `{ name, type, icon, color, openingBalanceMinor, linkedAccountId?, creditLimitMinor?, statementDay?, dueDay? }` |
| GET    | `/accounts/:id`                          | `?month=YYYY-MM` adds `{ inMinor, outMinor, recent[] }`                                                         |
| PATCH  | `/accounts/:id`                          | Same fields (type is immutable once transactions exist)                                                         |
| POST   | `/accounts/:id/archive` and `/unarchive` |                                                                                                                 |
| DELETE | `/accounts/:id`                          | 409 `IN_USE` if any transaction references it                                                                   |
| PUT    | `/accounts/order`                        | `{ ids: [] }` → sets `sortOrder`                                                                                |

### Categories — `/categories`

Same pattern as accounts, plus `kind: 'expense' | 'income'` on create (immutable). `GET /categories?kind=expense&includeArchived=false` returns `usageThisMonth` per item. `PUT /categories/order` takes `{ kind, ids }`.

### Transactions — `/transactions`

| Method | Path                           | Notes                                                                                                                                                                    |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/transactions`                | Filters: `from`, `to` (localDate), `type`, `accountId`, `categoryId`, `q` (note/category/account, numeric matches amount), `min`, `max`, `cursor`, `limit`. Newest first |
| GET    | `/transactions/day/:localDate` | `{ inMinor, outMinor, count, items[] }`                                                                                                                                  |
| POST   | `/transactions`                | `{ type, amountMinor, categoryId?, accountId, toAccountId?, occurredAt, tzid, note?, repeat?, instalments? }`                                                            |
| GET    | `/transactions/:id`            | Includes `createdAt`, `updatedAt`, `createdOn`                                                                                                                           |
| PATCH  | `/transactions/:id`            | Partial. Domain rules re-validated on the merged result                                                                                                                  |
| DELETE | `/transactions/:id`            | Soft delete → `{ undoUntil }`                                                                                                                                            |
| POST   | `/transactions/:id/restore`    | Undo within the window                                                                                                                                                   |
| POST   | `/transactions/:id/duplicate`  | New entry dated now                                                                                                                                                      |
| GET    | `/transactions/export.csv`     | Same filters as the list (web desktop)                                                                                                                                   |

`repeat`: `{ freq: 'daily'|'weekly'|'monthly'|'yearly'|'custom', interval, byDay?, endsOn? }` creates a recurrence rule. `instalments`: `{ months: 3|6|9|12 }` is allowed only when `accountId` is a credit card, and creates a plan plus N monthly entries.

### Stats — `/stats`

| Method | Path                       | Notes                                                                                                                                       |
| ------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/stats/month/:yyyy-mm`    | `{ incomeMinor, expenseMinor, balanceMinor, byCategory[], byAccount[], dailySpend[] }`, transfers excluded                                  |
| GET    | `/stats/period`            | `?period=week\|month\|year&ref=…&type=income\|expense` → `{ totalMinor, byCategory[{ categoryId, amountMinor, pct }], previousTotalMinor }` |
| GET    | `/stats/trend`             | `?months=6\|12&type=expense\|income` → `[{ month, amountMinor }]`, plus `averageMinor`                                                      |
| GET    | `/stats/calendar/:yyyy-mm` | Per day `{ localDate, expenseMinor, incomeMinor }` (heatmap)                                                                                |

### Favourites — `/favourites`

CRUD plus `PUT /favourites/order`. Shape: `{ title, icon, type, amountMinor, categoryId?, accountId?, toAccountId?, note? }`.

### Recurrences — `/recurrences`

`GET` (with `nextOccurrence`), `PATCH /:id`, `DELETE /:id` (stops future generation and keeps past entries).

### Health

`GET /health` → `{ status: "ok" }` (process up). `GET /ready` → 200 when MongoDB is reachable, 503 otherwise.
