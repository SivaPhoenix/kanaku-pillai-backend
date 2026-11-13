# Kanaku Pillai — Backend

REST API for **Kanaku Pillai** (கணக்குப் பிள்ளை, "the accountant"), a production-grade personal expense tracker: income, expenses and transfers across bank, cash, card and investment accounts, in your currency and time zone.

**Stack:** Node.js 22 · TypeScript · Express 5 · MongoDB (Mongoose 8, replica set) · Zod · pino · Vitest

**Status:** project context and API contract defined; code scaffold next.

## Docs
- [Project context](docs/PROJECT.md): product idea, scope, domain rules, architecture (shared with the web and app repos)
- [API contract](docs/api/README.md): what the web and mobile clients build against
- [Design spec](docs/design-spec.md): UI and domain spec (§1.1 and §9 matter most here)
- [Decisions](docs/decisions/)
- [CLAUDE.md](CLAUDE.md): engineering rules, folder layout and Claude Code agents for this repo

## Related repos
- [kanaku-pillai-web](https://github.com/SivaPhoenix/kanaku-pillai-web): React + Vite + Tailwind web app
- [kanaku-pillai-app](https://github.com/SivaPhoenix/kanaku-pillai-app): Expo + NativeWind mobile app
