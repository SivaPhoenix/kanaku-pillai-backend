# Kanaku Pillai — Backend

REST API for **Kanaku Pillai** (கணக்குப் பிள்ளை, "the accountant"), a production-grade personal expense tracker: income, expenses and transfers across bank, cash, card and investment accounts, in your currency and time zone.

**Stack:** Node.js 22 · JavaScript (ES modules) · Express 5 · MongoDB Atlas (Mongoose 9) · Zod · pino · Vitest

**Status:** foundation and auth are built: email/password sign-up and sign-in, Google sign-in, rotating refresh tokens, sign-out, rate limits and `GET /api/v1/me`. Accounts, categories and transactions are next.

## Getting started

Requirements: Node.js 22.13 or newer, and a MongoDB Atlas cluster (or any MongoDB replica set).

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and set `MONGODB_URI` to your Atlas connection string, with the database name `kanaku_pillai`. Never commit `.env`.

3. Start the API on port 4000:

   ```bash
   npm run dev
   ```

4. Check it: `GET http://localhost:4000/health` should return 200, and `GET http://localhost:4000/ready` should return 200 once MongoDB is connected.

If the start fails with `querySrv ECONNREFUSED`, Node's DNS cannot resolve the Atlas SRV record. Set `DNS_SERVERS` in `.env` to your network's DNS server IPs (comma-separated).

## Scripts

| Script                                  | What it does                                      |
| --------------------------------------- | ------------------------------------------------- |
| `npm run dev`                           | API with file watching, reads `.env`              |
| `npm start`                             | Production start (env comes from the environment) |
| `npm test`                              | Unit and integration tests (in-memory MongoDB)    |
| `npm run lint` / `npm run format:check` | ESLint and Prettier checks                        |
| `npm run check`                         | Lint, format check and tests, as CI runs them     |

## Docs

- [Project context](docs/PROJECT.md): product idea, scope, domain rules, architecture (shared with the web and app repos)
- [API contract](docs/api/README.md): what the web and mobile clients build against
- [Google sign-in plan](docs/auth/google-sign-in.md)
- [Design spec](docs/design-spec.md): UI and domain spec (§1.1 and §9 matter most here)
- [Decisions](docs/decisions/)
- [CLAUDE.md](CLAUDE.md): engineering rules, folder layout and Claude Code agents for this repo

## Related repos

- [kanaku-pillai-web](https://github.com/SivaPhoenix/kanaku-pillai-web): React + Vite + Tailwind web app
- [kanaku-pillai-app](https://github.com/SivaPhoenix/kanaku-pillai-app): Expo + NativeWind mobile app
