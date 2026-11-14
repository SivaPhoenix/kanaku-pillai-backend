# Kanaku Pillai API — Contract (v1)

Owned by `kanaku-pillai-backend`. The web (`kanaku-pillai-web`) and mobile (`kanaku-pillai-app`) clients build against this document. **Status:** every endpoint in this document is built and tested (v1). The background worker (`npm run worker`) runs repeat generation and purge. Any change to a shape here is a contract change: update this file in the same PR and list the client impact.

## Conventions

- **Base URL:** `/api/v1`, JSON only (`Content-Type: application/json`), UTF-8.
- **Auth:** `Authorization: Bearer <accessToken>` on every route except `/auth/*` (signup, login, google, refresh, verify-email, forgot-password, reset-password) and the health checks.
- **Client platform:** clients send `X-Client-Platform: web | ios | android`. The value decides how the refresh token is delivered and is stored as `createdOn` on transactions.
- **Request id:** the server returns `X-Request-Id`, and a client-supplied one is accepted if it is a valid UUID. Error bodies repeat it.
- **Idempotency:** `POST /transactions` and `POST /transactions/:id/duplicate` accept `Idempotency-Key: <uuid>`. Repeating the same key and body within 24 h returns the original response.
- **Ids:** opaque strings (`id`). Never send `_id`.
- **Money:** `amountMinor` is an integer in the user's currency minor unit, always > 0, with sign implied by `type`. Clients format it, and they never send or receive floats.
- **Time:** `occurredAt` is an ISO-8601 UTC instant and `tzid` is an IANA zone. The server derives `localDate` (`YYYY-MM-DD`) and returns it read-only.
- **Success:** `{ "data": … }`. Lists: `{ "data": [ … ], "page": { "nextCursor": "…" | null, "limit": 50 } }`. Pass `?cursor=` to continue, `limit` ≤ 100.
- **Date bounds:** every `localDate` and month (request fields, filters, paths) must fall in the years 1970–2100. `occurredAt` (create, edit, duplicate) must be within the last 10 years and at most one year ahead (400). An entry created with `repeat` or `instalments` may be dated at most one year in the past (400 on `body.occurredAt`).
- **Limits:** each user can have at most 50 active accounts, 100 active categories per kind, 100 favourites and 100 active repeat rules. Creating (or unarchiving) past a cap returns 409 `LIMIT_REACHED`. Rate limits (429 `RATE_LIMITED`): `DELETE /me` 5 per 15 minutes per user, `GET /transactions/export.csv` 10 per 15 minutes per user, and every non-GET request outside `/auth` 300 per 5 minutes per user. The auth limits are listed under Auth.
- **Errors:** `{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [{ "field": "amountMinor", "message": "…" }], "requestId": "…" } }`.

| Status | Codes                                                                                                                                                                                                                                                                 |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`, `INVALID_LINK`, transaction rule codes (see Shared shapes), `INSTALMENTS_NOT_ALLOWED`, `REPEAT_WITH_INSTALMENTS`                                                                                                                                  |
| 401    | `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS`, `GOOGLE_TOKEN_INVALID`, `GOOGLE_EMAIL_NOT_VERIFIED`                                                                                                                                                        |
| 503    | `GOOGLE_SIGN_IN_UNAVAILABLE`                                                                                                                                                                                                                                          |
| 413    | `PAYLOAD_TOO_LARGE`                                                                                                                                                                                                                                                   |
| 400    | also `INVALID_JSON` (malformed request body)                                                                                                                                                                                                                          |
| 404    | `NOT_FOUND` (also returned for records owned by another user)                                                                                                                                                                                                         |
| 409    | `CONFLICT`, `EMAIL_TAKEN`, `NAME_TAKEN`, `LIMIT_REACHED`, `ACCOUNT_ARCHIVED`, `CATEGORY_ARCHIVED`, `IN_USE` (archive instead), `TYPE_LOCKED`, `SETUP_ALREADY_DONE`, `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_IN_PROGRESS`, `EMAIL_ALREADY_VERIFIED`, `PASSWORD_NOT_SET` |
| 429    | `RATE_LIMITED` (with `Retry-After`)                                                                                                                                                                                                                                   |
| 500    | `INTERNAL` (no details, no stack)                                                                                                                                                                                                                                     |

## Resources

### Auth — `/auth`

| Method | Path                         | Body → Response                                                                                                                          | Status                         |
| ------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| POST   | `/auth/signup`               | `{ name, email, password }` → session response, `isNewUser: true`                                                                        | 201 · built                    |
| POST   | `/auth/login`                | `{ email, password, keepSignedIn? = true }` → session response                                                                           | 200 · built                    |
| POST   | `/auth/google`               | `{ idToken }` → session response + `isNewUser`                                                                                           | 201 new, 200 returning · built |
| POST   | `/auth/refresh`              | web: cookie only · native: `{ refreshToken }` → `{ accessToken, accessTokenExpiresIn, refreshToken?, refreshTokenExpiresAt? }` (rotated) | 200 · built                    |
| POST   | `/auth/logout`               | web: cookie only · native: `{ refreshToken }` → no body (ends that session)                                                              | 204 · built                    |
| POST   | `/auth/verify-email`         | `{ token }` → `{ emailVerified: true }`                                                                                                  | 200 · built                    |
| POST   | `/auth/forgot-password`      | `{ email }` → no body (always, whether or not the email has an account)                                                                  | 202 · built                    |
| POST   | `/auth/reset-password/check` | `{ token }` → no body if the reset link is still usable (does not use it up)                                                             | 204 · built                    |
| POST   | `/auth/reset-password`       | `{ token, password }` → no body (sets the password, verifies the email, revokes every session)                                           | 204 · built                    |
| POST   | `/auth/change-password`      | **Bearer required.** `{ currentPassword, newPassword }` → no body (keeps this session, revokes the others)                               | 204 · built                    |

**Session response** (signup, login, google):

```json
{
  "data": {
    "user": {
      "id": "6650f1c2a1b2c3d4e5f60718",
      "name": "Siva",
      "email": "siva@example.com",
      "avatarUrl": null,
      "emailVerified": false,
      "authMethods": ["password"],
      "settings": {
        "currencyCode": "INR",
        "locale": "en-IN",
        "tzMode": "device",
        "tzid": "Asia/Kolkata",
        "theme": "system",
        "weekStart": "mon"
      },
      "setupComplete": false,
      "createdAt": "2026-11-13T06:00:00.000Z"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIs…",
    "accessTokenExpiresIn": 900,
    "refreshToken": "(native clients only)",
    "refreshTokenExpiresAt": "(native clients only, ISO instant)",
    "isNewUser": true
  }
}
```

- **Password rules** (signup): 8–128 characters with at least one number and one symbol. Email is trimmed and lowercased. Name is 1–80 characters.
- **Access token:** a JWT sent as `Authorization: Bearer …`, valid for `accessTokenExpiresIn` seconds (15 minutes). On 401 `TOKEN_EXPIRED`, call `/auth/refresh` once and retry. Signing out ends the session immediately, even for unexpired access tokens.
- **Refresh token:** rotates on every `/auth/refresh`, so always store the new one. Presenting an old (already rotated) token is treated as theft and **ends the whole session** (401). Clients must therefore serialise refreshes: one in flight at a time, and on the web one across all tabs (for example with `navigator.locks`).
- **Web:** the refresh token lives in the `kp_refresh` cookie (`httpOnly`, `SameSite=Strict`, `Path=/api/v1/auth`). Call the API on the web app's own origin (`/api/v1/…` via the Vite proxy or a reverse proxy), otherwise the cookie is not sent. With `keepSignedIn: false` it is a browser-session cookie and the session ends after 1 day without use. Otherwise it lasts 30 days, renewed on each refresh.
- **Native:** send `X-Client-Platform: ios` or `android`, and the refresh token comes back in the body. Keep it in secure storage. Sessions last 30 days, renewed on each refresh.
- **Errors:** signup 409 `EMAIL_TAKEN`. Login 401 `INVALID_CREDENTIALS`, the same for an unknown email, a wrong password or a Google-only account. Refresh and logout 401 `UNAUTHENTICATED`. Rate limits return 429 `RATE_LIMITED`: signup 10 per hour per IP, login 10 per 15 minutes per IP and email, google 20 per 15 minutes, refresh 60 per 15 minutes.
- **Google sign-in:** `idToken` is the Google ID token from Google Identity Services (web) or `@react-native-google-signin` (app). The server verifies it, then finds the account by Google id, links it by email, or creates it. `isNewUser: true` means the client goes to `/setup`. Errors: 401 `GOOGLE_TOKEN_INVALID`, 401 `GOOGLE_EMAIL_NOT_VERIFIED`, and 503 `GOOGLE_SIGN_IN_UNAVAILABLE` when the server has no Google client IDs configured. Linking rules are in `docs/auth/google-sign-in.md` §4.
- **Email verification:** email sign-up sends a verification link; the account is usable before it is verified (`emailVerified: false`). `POST /me/verify-email` resends it. An unverified password account is replaced by a later Google sign-in with the same email (password removed, sessions ended), which blocks someone pre-registering your email; once verified, Google links to it instead.
- **Email links:** the web app opens `{APP_WEB_URL}/auth/verify-email#token=…` and `{APP_WEB_URL}/auth/reset-password#token=…`. The token sits in the URL **fragment**, so it never reaches a server log or a `Referer` header; the page reads it and posts it as `token`. Links are single use: verification lasts 24 hours, reset 30 minutes. A new link of the same kind replaces the previous unused one, and at most one email of each kind is sent per account per 60 seconds (extra requests still answer normally). Opening an already-used verification link of a verified account still returns 200.
- **Forgot password:** the 202 is sent before the account lookup and the email, so neither the body nor the timing reveals whether the address has an account. Resetting works for Google-only accounts too, which gives them a first password. After a reset the user must sign in again everywhere, and a "password changed" notice is emailed.
- **Link errors:** an unknown, used or expired token returns 400 `INVALID_LINK` (the clients show "This link has expired" with a way to request a new one). A malformed body is 400 `VALIDATION_ERROR`; `password` follows the signup rules.
- **Change password** (signed in, the only `/auth` route that needs `Authorization: Bearer`): `newPassword` follows the signup rules and must differ from `currentPassword` (400 on `body.newPassword`). A wrong `currentPassword` is 401 `INVALID_CREDENTIALS` (clients must not treat it as an expired session). The device that made the change stays signed in, every other session ends, and a "password changed" email is sent. It does not mark the email verified. Google-only accounts get 409 `PASSWORD_NOT_SET`: they set a first password with `POST /auth/forgot-password`, which emails a reset link. Limited to 5 per 15 minutes per user.
- **Email rate limits** (429 `RATE_LIMITED`): forgot-password 5 per 15 minutes per IP and email, reset-password (and its check) 20 per 15 minutes per IP, verify-email 20 per 15 minutes per IP, `POST /me/verify-email` 5 per 15 minutes per user.

### Shared shapes and rules

These apply to every resource below.

- **Ids** are 24-character hex strings. Any id in a path or body that is malformed returns 400. An id that is well-formed but not one of **your** records returns 404 `NOT_FOUND`, never 403.
- **`localDate`** is `YYYY-MM-DD` and **`month`** is `YYYY-MM`, always in the user's calendar (the zone the entry was recorded in).
- **`icon`** is one of the icon names below. Emoji are rejected (product rule: the UI never shows emoji):
  `food coffee snacks fruits bus bag bolt home household medicine haircut gadgets education film salary laptop gift refund interest other wallet bank cash card trend`
- **`color`** is one of `c1` … `c7` (design spec §2.1 palette).
- **Money** fields end in `Minor`: integers in the user's currency minor unit, as safe integers. `amountMinor` is always > 0. Opening balances may be 0, and only bank, cash and investment balances may be negative.
- **Archived** accounts and categories still appear in history and lists (`includeArchived=true`), but cannot be used for new or edited entries (409 `ACCOUNT_ARCHIVED` / `CATEGORY_ARCHIVED`).
- **Transfers** never count in income, expense or stats totals.

#### Transaction rules (create, edit, favourites, repeat templates)

| Type       | `categoryId`                                | `accountId`                 | `toAccountId`                             |
| ---------- | ------------------------------------------- | --------------------------- | ----------------------------------------- |
| `expense`  | required, a category with `kind: "expense"` | required (any account type) | must be absent                            |
| `income`   | required, a category with `kind: "income"`  | required (any account type) | must be absent                            |
| `transfer` | must be absent                              | required, not a debit card  | required, not a debit card, ≠ `accountId` |

Rule errors (400): `CATEGORY_REQUIRED`, `CATEGORY_NOT_ALLOWED`, `CATEGORY_KIND_MISMATCH`, `TRANSFER_TARGET_REQUIRED`, `TRANSFER_TARGET_NOT_ALLOWED`, `TRANSFER_SAME_ACCOUNT`, `DEBIT_CARD_TRANSFER`.

### Me and settings — `/me`

| Method | Path               | Body → Response                                                                                          | Status |
| ------ | ------------------ | -------------------------------------------------------------------------------------------------------- | ------ |
| GET    | `/me`              | → `user` (as in the session response)                                                                    | built  |
| PATCH  | `/me`              | `{ name }` (1–80) → `user`                                                                               |        |
| PATCH  | `/me/settings`     | `{ currencyCode?, locale?, tzMode?, tzid?, theme?, weekStart? }` → `{ user, relabeledCount }`            |        |
| POST   | `/me/setup`        | see below → `{ user, accounts, categories }`                                                             | 201    |
| GET    | `/me/sessions`     | → `[{ id, platform, userAgent, ipAddress, createdAt, lastUsedAt, current }]` (active only, newest first) |        |
| DELETE | `/me/sessions/:id` | → 204. Signs that device out (works for the current one too)                                             |        |
| POST   | `/me/verify-email` | no body → 202. Emails a fresh verification link. 409 `EMAIL_ALREADY_VERIFIED` once verified              |        |
| DELETE | `/me`              | `{ confirm: "DELETE", password? }` → 204                                                                 |        |

- **Settings:** `currencyCode` must be an ISO 4217 code the runtime knows (`Intl.supportedValuesOf("currency")`). Changing it **relabels** every existing entry to the new code and **never converts** amounts. `relabeledCount` says how many. `locale` defaults from the currency (INR→en-IN, USD→en-US, EUR→de-DE, GBP→en-GB, AED→en-AE, SGD→en-SG, JPY→ja-JP, otherwise en-US) unless sent explicitly. `tzid` must be a valid IANA zone, `tzMode` is `device` or `manual`, `theme` is `system`, `light` or `dark`, and `weekStart` is `mon` or `sun`.
- **Setup** (once, after first sign-in; 409 `SETUP_ALREADY_DONE` afterwards):

  ```json
  {
    "currencyCode": "INR",
    "tzid": "Asia/Kolkata",
    "startingBalances": {
      "savingsMinor": 15260000,
      "walletMinor": 630000,
      "creditCardOwedMinor": 1245000,
      "investmentsMinor": 5000000
    },
    "starterCategories": true
  }
  ```

  It creates the default accounts **Savings** (bank, default), **Wallet** (cash), **Credit card**, **Debit card** (linked to Savings) and **SIP & Stocks** (investment), with the optional opening balances (`investmentsMinor` is the SIP & Stocks balance). With `starterCategories` (default `true`) it also creates the expense categories Food, Coffee, Snacks, Fruits, Transport, Rent, Electricity, Household, Medicine, Haircut, Gadgets, Education and Others, and the income categories Salary, Freelance, Interest, Refund, Gift and Others. Then it sets `setupComplete: true`.

- **Delete account:** `password` is required when the account has one. Google-only accounts confirm with `confirm` alone. All the user's data (transactions, accounts, categories, favourites, repeat rules, instalment plans, sessions) is deleted at once and permanently. 401 `INVALID_CREDENTIALS` if the password is wrong.

### Accounts — `/accounts`

```json
{
  "id": "…",
  "name": "Savings",
  "type": "bank",
  "icon": "bank",
  "color": "c2",
  "last4": "4821",
  "openingBalanceMinor": 0,
  "linkedAccountId": null,
  "creditLimitMinor": null,
  "statementDay": null,
  "dueDay": null,
  "isDefault": true,
  "sortOrder": 0,
  "archived": false,
  "balanceMinor": 15260000,
  "createdAt": "…"
}
```

- `type` is `bank`, `cash`, `credit_card`, `debit_card` or `investment`. `last4` (optional, 4 digits) is for display ("••4821").
- **`balanceMinor`** (computed): for bank, cash and investment = opening + income − expense + transfers in − transfers out. A debit card's income and expense count towards its **linked bank account**, and the debit card itself reports `balanceMinor: null`.
- **Credit cards** report `owedMinor` instead of `balanceMinor`: opening owed + expenses − income (refunds) − transfers in (bill payments) + transfers out. They also include `limitUsedPct` (one decimal, null without a limit), `statementMinor` (amount owed at the close of the last statement day), `lastStatementDate` and `dueDate` (both `localDate`, null when the days aren't set).
- `debit_card` requires `linkedAccountId` (a bank account of yours). `creditLimitMinor`, `statementDay` and `dueDay` (1–28) apply only to `credit_card`. `name` is 1–40 characters and unique among your non-archived accounts (409 `NAME_TAKEN`).

| Method | Path                                   | Body → Response                                                                                                                      | Notes                                                                                     |
| ------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| GET    | `/accounts?includeArchived=false`      | → `[account]`                                                                                                                        | sorted by `sortOrder`                                                                     |
| GET    | `/accounts/summary`                    | → `{ netWorthMinor, assetsMinor, liabilitiesMinor }`                                                                                 | net worth = assets − credit-card owed                                                     |
| POST   | `/accounts`                            | `{ name, type, icon, color, last4?, openingBalanceMinor?, linkedAccountId?, creditLimitMinor?, statementDay?, dueDay? }` → `account` | 201                                                                                       |
| GET    | `/accounts/:id?month=YYYY-MM`          | → `account` + `activity: { month, inMinor, outMinor, recent: [transaction ×10] }`                                                    | `month` defaults to the current one                                                       |
| PATCH  | `/accounts/:id`                        | any create field → `account`                                                                                                         | `type` can't change once entries exist (409 `TYPE_LOCKED`)                                |
| POST   | `/accounts/:id/archive` · `/unarchive` | → `account`                                                                                                                          | archiving the default account clears `isDefault`                                          |
| POST   | `/accounts/:id/default`                | → `account`                                                                                                                          | makes it the default; the previous default is cleared                                     |
| DELETE | `/accounts/:id`                        | → 204                                                                                                                                | 409 `IN_USE` if any entry, favourite, repeat rule or debit card uses it (archive instead) |
| PUT    | `/accounts/order`                      | `{ ids: [id…] }` → `[account]`                                                                                                       | `sortOrder` follows the array order                                                       |

### Categories — `/categories`

```json
{
  "id": "…",
  "kind": "expense",
  "name": "Food",
  "icon": "food",
  "color": "c1",
  "sortOrder": 0,
  "archived": false,
  "usageThisMonth": 42,
  "createdAt": "…"
}
```

| Method | Path                                             | Body → Response                            | Notes                                                             |
| ------ | ------------------------------------------------ | ------------------------------------------ | ----------------------------------------------------------------- |
| GET    | `/categories?kind=expense&includeArchived=false` | → `[category]`                             | `kind` optional; `usageThisMonth` = entries in the current month  |
| POST   | `/categories`                                    | `{ kind, name, icon, color }` → `category` | 201; `kind` is immutable; name unique per kind (409 `NAME_TAKEN`) |
| PATCH  | `/categories/:id`                                | `{ name?, icon?, color? }` → `category`    |                                                                   |
| POST   | `/categories/:id/archive` · `/unarchive`         | → `category`                               |                                                                   |
| DELETE | `/categories/:id`                                | → 204                                      | 409 `IN_USE` if any entry, favourite or repeat rule uses it       |
| PUT    | `/categories/order`                              | `{ kind, ids: [id…] }` → `[category]`      |                                                                   |

### Transactions — `/transactions`

```json
{
  "id": "…",
  "type": "expense",
  "amountMinor": 24000,
  "currencyCode": "INR",
  "categoryId": "…",
  "accountId": "…",
  "toAccountId": null,
  "occurredAt": "2026-10-22T07:50:00.000Z",
  "tzid": "Asia/Kolkata",
  "localDate": "2026-10-22",
  "note": "Lunch",
  "recurrenceId": null,
  "installmentPlanId": null,
  "installmentIndex": null,
  "installmentCount": null,
  "createdOn": "web",
  "createdAt": "…",
  "updatedAt": "…"
}
```

Clients show category and account names by joining with the (small, cached) `/categories` and `/accounts` lists.

| Method | Path                           | Body → Response                                                                                             | Notes                                                                                                                                                                            |
| ------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/transactions`                | filters below → list, newest first (`occurredAt` desc)                                                      | cursor paging, `limit` ≤ 100 (default 50)                                                                                                                                        |
| GET    | `/transactions/summary`        | same filters → `{ count, incomeMinor, expenseMinor, netMinor }`                                             | net = income − expense (transfers excluded)                                                                                                                                      |
| GET    | `/transactions/day/:localDate` | → `{ localDate, inMinor, outMinor, count, items: [transaction] }`                                           | up to 500 items                                                                                                                                                                  |
| GET    | `/transactions/export.csv`     | same filters → `text/csv`                                                                                   | columns: Date, Time, Type, Amount, Currency, Category, Account, To account, Note. At most 10 000 rows (the newest); when more match, the response has `X-Export-Truncated: true` |
| POST   | `/transactions`                | see below → `transaction`                                                                                   | 201; accepts `Idempotency-Key`                                                                                                                                                   |
| GET    | `/transactions/:id`            | → `transaction`                                                                                             |                                                                                                                                                                                  |
| PATCH  | `/transactions/:id`            | `{ type?, amountMinor?, categoryId?, accountId?, toAccountId?, occurredAt?, tzid?, note? }` → `transaction` | rules re-checked on the merged result; set `categoryId`/`toAccountId` to `null` to clear                                                                                         |
| DELETE | `/transactions/:id`            | → `{ id, deletedAt, undoUntil }`                                                                            | soft delete; `undoUntil` = 10 s later (for the Undo toast)                                                                                                                       |
| POST   | `/transactions/:id/restore`    | → `transaction`                                                                                             | works until the entry is purged (30 days)                                                                                                                                        |
| POST   | `/transactions/:id/duplicate`  | `{ occurredAt?, tzid? }` → `transaction`                                                                    | 201; defaults to now in the original zone; accepts `Idempotency-Key`                                                                                                             |

**List filters** (all optional): `from` and `to` (`localDate`, inclusive), `type` (`income`, `expense` or `transfer`), `accountId` (matches the from or the to side), `categoryId`, `q` (case-insensitive match on note, category name or account name; a number also matches that exact amount, so "240" finds ₹240.00), `min` and `max` (`amountMinor`), `cursor` and `limit`.

**Create body:**

```json
{
  "type": "expense",
  "amountMinor": 24000,
  "categoryId": "…",
  "accountId": "…",
  "toAccountId": null,
  "occurredAt": "2026-10-22T07:50:00.000Z",
  "tzid": "Asia/Kolkata",
  "note": "Lunch",
  "repeat": { "freq": "monthly", "interval": 1, "endsOn": null },
  "instalments": { "months": 6 }
}
```

- `note` is up to 140 characters. `occurredAt` must be within the last 10 years and at most one year ahead. With `repeat` or `instalments` it can be at most one year in the past.
- **`repeat`** (optional; `freq` is `daily`, `weekly`, `monthly` or `yearly`, `interval` is 1–365, `endsOn` an optional `localDate`) creates a repeat rule from this entry. This entry is the first occurrence. Later ones are generated by the server on their dates, exactly once each, even when no device is online. The client's "Custom" option is any `interval` above 1.
- **`instalments`** (optional; `months` is 3, 6, 9 or 12) applies only to an `expense` on a `credit_card` account (400 `INSTALMENTS_NOT_ALLOWED`). It creates an instalment plan and N monthly expense entries on the same day of the month (clamped to the month's end) at the same local time. The amounts are `floor(amount / N)`, with the remainder on the first entry, so they sum exactly. The response is the first entry. `amountMinor` must be at least `months` (400 on `body.instalments.months`: "Amount is too small to split into that many instalments").
- `repeat` and `instalments` cannot be combined (400 `REPEAT_WITH_INSTALMENTS`).
- **`Idempotency-Key`** (UUID): sending the same key and the same body again within 24 hours returns the original response with the original status. The same key with a different body returns 409 `IDEMPOTENCY_KEY_REUSED`. While the first request is still running, a repeat returns 409 `IDEMPOTENCY_IN_PROGRESS`, unless that attempt is older than 60 seconds (it is presumed dead and the retry takes the key over).

### Stats — `/stats`

Every stat sums `income` and `expense` only. Transfers are always excluded, and so are deleted entries. Percentages have one decimal.

| Method | Path                                                                         | Response                                                                                                                                                                                                                                                          |
| ------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/stats/month/:month`                                                        | `{ month, currencyCode, incomeMinor, expenseMinor, balanceMinor, investedMinor, withdrawnMinor, afterInvestingMinor, byCategory: [{ categoryId, amountMinor, pct }], byAccount: [{ accountId, amountMinor }], days: [{ localDate, expenseMinor, incomeMinor }] }` |
| GET    | `/stats/period?period=week\|month\|year&ref=YYYY-MM-DD&type=expense\|income` | `{ period, type, from, to, previousFrom, previousTo, totalMinor, previousTotalMinor, byCategory: [{ categoryId, amountMinor, pct, previousAmountMinor }] }`                                                                                                       |
| GET    | `/stats/trend?months=6\|12&end=YYYY-MM&type=expense\|income`                 | `{ type, points: [{ month, amountMinor }], averageMinor }`                                                                                                                                                                                                        |

- **Investing** (month view): moving money into an investment account is a transfer, so it never changes `incomeMinor`, `expenseMinor` or `balanceMinor`, and net worth is unchanged. `investedMinor` is the sum of transfers this month **into** investment accounts from any non-investment account, `withdrawnMinor` the sum **out of** investment accounts to non-investment accounts (moves between two investment accounts count as neither; archived investment accounts still count). `afterInvestingMinor = balanceMinor − investedMinor + withdrawnMinor` and may be negative. Clients display these as given.
- `byCategory` (expense categories in the month view) is sorted by amount descending. `byAccount` is what each account spent (expenses, debit cards listed as themselves). `days` has one entry per day of the month (zeros included), which feeds both the daily bar chart and the calendar heatmap.
- Weeks start on the user's `weekStart`. `ref` defaults to today in the user's zone, and `end` defaults to the current month.

### Favourites — `/favourites`

```json
{
  "id": "…",
  "title": "Lunch",
  "icon": "food",
  "type": "expense",
  "amountMinor": 24000,
  "categoryId": "…",
  "accountId": "…",
  "toAccountId": null,
  "note": "Lunch",
  "sortOrder": 0,
  "createdAt": "…"
}
```

| Method | Path                | Body → Response                                                                                                                       |
| ------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/favourites`       | → `[favourite]` (sorted)                                                                                                              |
| POST   | `/favourites`       | `{ title (1–40), icon, type, amountMinor, categoryId?, accountId, toAccountId?, note? }` → `favourite` (201, transaction rules apply) |
| PATCH  | `/favourites/:id`   | any field → `favourite`                                                                                                               |
| DELETE | `/favourites/:id`   | → 204                                                                                                                                 |
| PUT    | `/favourites/order` | `{ ids }` → `[favourite]`                                                                                                             |

Applying a favourite is done by the client: it fills the Add form, and then a normal `POST /transactions` happens.

### Repeat rules — `/recurrences`

```json
{
  "id": "…",
  "type": "expense",
  "amountMinor": 600000,
  "categoryId": null,
  "accountId": "…",
  "toAccountId": "…",
  "note": "Monthly SIP",
  "tzid": "Asia/Kolkata",
  "localTime": "09:00",
  "freq": "monthly",
  "interval": 1,
  "startsOn": "2026-10-05",
  "endsOn": null,
  "nextOccurrence": "2026-11-05",
  "paused": false,
  "createdAt": "…"
}
```

| Method | Path               | Body → Response                                                                           |
| ------ | ------------------ | ----------------------------------------------------------------------------------------- |
| GET    | `/recurrences`     | → `[rule]` (active first, then by `nextOccurrence`)                                       |
| PATCH  | `/recurrences/:id` | `{ amountMinor?, note?, endsOn?, paused? }` → `rule` (applies to future occurrences only) |
| DELETE | `/recurrences/:id` | → 204. Stops future occurrences; past entries stay                                        |

Resuming (`paused: false`) does not backfill: `nextOccurrence` moves to the first occurrence on or after today in the rule's zone, so occurrences that fell due while the rule was paused are never created. Creating a rule past 100 active ones returns 409 `LIMIT_REACHED`.

### Health

`GET /health` → `{ status: "ok" }` (process up). `GET /ready` → 200 when MongoDB is reachable, 503 otherwise.

### Background jobs (worker process, `npm run worker`)

- **Repeat generation** runs every 15 minutes. It creates every occurrence due up to today in each rule's zone, including any missed while the worker was down, then moves `nextOccurrence` forward. A unique `(recurrenceId, occurrenceDate)` index makes generation idempotent.
- **Purge** runs daily and permanently deletes entries soft-deleted more than 30 days ago.
- A MongoDB lock makes each job run on one worker at a time, even with several workers.
