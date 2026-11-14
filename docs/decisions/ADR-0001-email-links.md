# ADR-0001: Email verification and password reset by link, sent through Gmail SMTP

- Date: 2026-11-14
- Status: Accepted

## Context

v1 needs email verification and forgot password. The design spec (§7.3) described a 6-digit code typed into the app, and the email provider was an open question (PROJECT.md §5). The product owner asked for **links** in the email and a dedicated Gmail account (`no-reply.kanaku.pillai@…`) as the sender.

## Decision

- **Links, not codes.** The API emails single-use links to the web app: `/auth/verify-email#token=…` (24 hours) and `/auth/reset-password#token=…` (30 minutes). Tokens are 256-bit random values; only their SHA-256 digest is stored (`email_tokens`, TTL index on `expiresAt`). Redeeming is an atomic "unused and unexpired → used" update, so a link works once.
- **Token in the URL fragment.** Browsers never send the fragment to a server or in `Referer`, so tokens stay out of access logs, proxies and third-party requests (fonts). The page strips it from the address bar after reading it.
- **No account enumeration.** `POST /auth/forgot-password` answers 202 before doing the lookup or sending mail, so neither the body nor the timing differs for unknown addresses. Per-account cooldown (60 s) and per-IP+email rate limits cap mail volume.
- **Reset effects.** A reset sets the password (a first one for Google-only accounts), marks the email verified (the inbox was proven), revokes every session and emails a "password changed" notice.
- **Verification is soft.** Unverified password accounts can sign in; the clients nudge them to verify. A verified email stops the Google-sign-in takeover guard from removing the password.
- **Transport.** `src/integrations/mail/mail-transport.js` sends through SMTP with nodemailer (Gmail: `smtp.gmail.com:465`, a Google app password). `MAIL_TRANSPORT=console` logs the email instead (development only; refused in production). Templates live in `src/integrations/mail/templates/` and render both HTML (table layout, inline styles) and plain text.

## Consequences

- Native apps open these links in the web app for now. When the app ships, add universal links / app links for the same paths so they can open in the app.
- Gmail limits sending (roughly 500 recipients a day on a free account) and rewrites `From` to the authenticated account unless an alias is verified. Moving to a transactional provider (SES, Resend, Postmark) is a new adapter behind the same `sendMail()` and needs no API change.
- Gmail delivery from a consumer account can land in spam; a custom domain with SPF, DKIM and DMARC is the long-term fix.
- The Gmail app password is a secret: it lives only in the deploy environment (`SMTP_PASS`), never in git.
