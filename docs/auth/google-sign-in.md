# Google sign-in — plan

**Status:** backend built (`POST /api/v1/auth/google`, tested with a stubbed verifier). It goes live once `GOOGLE_CLIENT_IDS` is set (section 3). Not built yet: the web and app buttons, unlink, and Google re-auth for account deletion. Endpoint shapes are in `docs/api/README.md` → Auth.

## 1. Goal

Users can sign up and sign in with their Google account on the web app, iOS and Android, alongside email and password (design spec §1, §7.1). One Kanaku Pillai account per person, whichever method they use.

## 2. How it works (ID-token flow)

```
Client (web / iOS / Android)                 Backend                          Google
  1. "Continue with Google"
  2. Google SDK signs the user in  ───────────────────────────────────────▶  (consent)
  3. receives a Google ID token (JWT) ◀──────────────────────────────────────
  4. POST /api/v1/auth/google { idToken } ─▶
                                             5. verify token signature, iss, aud, exp
                                                (google-auth-library, Google's public keys)
                                             6. find or create the user (section 4)
                                             7. issue our own access + refresh tokens
  8. { user, accessToken, refreshToken?, isNewUser } ◀─
```

- The backend only **verifies** Google's ID token. It never receives a Google password, and it needs no Google client secret (there is no server-side code exchange and no Google API calls on the user's behalf).
- After step 7 the session is an ordinary Kanaku Pillai session: same tokens, refresh rotation, sign-out and device list as an email/password sign-in.

## 3. Google Cloud setup (product owner, one time)

Do these at [console.cloud.google.com](https://console.cloud.google.com), signed in with the Google account that should own the app. The console menu names below are the current "Google Auth Platform" ones.

### 3.1 Now (needed to test web sign-in)

1. **Create the project.** Use the project picker (top bar), then **New project**. Name it `Kanaku Pillai`, then **Create**, and make sure it is the selected project.
2. **Start Google Auth Platform.** From the menu, open **APIs & Services → OAuth consent screen** (this opens **Google Auth Platform**), then **Get started**:
   - **App information:** app name `Kanaku Pillai`, user support email (your Gmail).
   - **Audience:** **External** (anyone with a Google account).
   - **Contact information:** your email.
   - Agree to the user data policy, then **Create**.
3. **Data access (scopes).** Nothing to add. Google Sign-In uses only `openid`, `email` and `profile`, which are non-sensitive, so no verification review is needed.
4. **Audience → Test users.** While the app is in **Testing**, only listed test users can sign in. Add your own Gmail (and anyone else who will test), up to 100.
5. **Clients → Create client** (OAuth client ID):
   - **Application type:** Web application. **Name:** `Kanaku Pillai Web`.
   - **Authorized JavaScript origins:** add both `http://localhost` and `http://localhost:5173`. Google's sign-in button needs both for local development. Add the production web origin later.
   - **Authorized redirect URIs:** leave empty. The ID-token button flow does not redirect.
   - **Create.** Copy the **Client ID** (`…apps.googleusercontent.com`).
6. **Hand over the Client ID.** Put it in the backend `.env` as `GOOGLE_CLIENT_IDS=<client id>` (or send it to the developer). The client ID is public and not secret.
   - **Do not share the client secret**, and do not put it anywhere in this project. The backend does not use it.

### 3.2 Later (when the mobile app exists)

7. **Android client:** **Clients → Create client → Android**. Enter the package name (for example `com.kanakupillai.app`) and the **SHA-1 certificate fingerprint**.
   - Get the SHA-1 from `eas credentials` (or the Play Console → App signing).
   - Create one client for the development keystore and one for the release/Play signing key.
8. **iOS client:** **Clients → Create client → iOS**, with the bundle ID (for example `com.kanakupillai.app`).
9. Add the Android and iOS client IDs to `GOOGLE_CLIENT_IDS` (comma-separated). The app also needs the **Web** client ID as its `webClientId`, so that Google issues ID tokens the backend accepts.

### 3.3 Before public launch

10. **Branding:** add the app logo (once chosen), home page, privacy policy and terms of service URLs, and the authorised domain of the production site. Adding a logo triggers Google's brand verification, which takes a few days.
11. **Audience → Publish app**, moving it from Testing to In production, so any Google user can sign in. Basic scopes need no further review.

## 4. Account resolution rules (backend)

On a valid token with claims `sub`, `email`, `email_verified`, `name`, `picture`:

1. **Reject** if `email_verified` is not `true` → 401 `GOOGLE_EMAIL_NOT_VERIFIED`.
2. **Find by `googleSub`** (Google's stable user id; never key on email, because emails can change). If found → sign in.
3. **Else find by email** (lowercased):
   - existing account **with a verified email** → link: set `googleSub` and sign in.
   - existing account **with an unverified email** (someone signed up with this email and never verified it) → treat Google as proof of ownership: set `googleSub`, mark the email verified, **remove the unverified password and revoke all of that account's sessions**, then sign in. This blocks "pre-registration" account takeover, where an attacker signs up with a victim's email first.
4. **Else create** the user: `name`, `email`, `emailVerifiedAt = now`, `googleSub`, `avatarUrl`, no password, `setupComplete = false`. Respond with `isNewUser: true`, and the client goes to `/setup`.

Every outcome is written to the auth audit log (user id, method `google`, outcome, IP, user agent), never the token itself.

## 5. Data model changes (`users`)

| Field             | Type             | Notes                                          |
| ----------------- | ---------------- | ---------------------------------------------- |
| `googleSub`       | string, optional | Unique sparse index                            |
| `passwordHash`    | string, optional | Absent for Google-only users                   |
| `emailVerifiedAt` | Date, optional   | Set by Google sign-in or by email verification |
| `avatarUrl`       | string, optional | From the `picture` claim; display only         |

Derived for the API: `authMethods: ['password' | 'google']`.

## 6. Effects on other flows

| Flow                   | Google-only user (no password)                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Email + password login | 401 `INVALID_CREDENTIALS` (same message as a wrong password, so it reveals nothing)                                        |
| Forgot password        | Works and sets a first password (the emailed reset link proves ownership). This is how a Google user adds password sign-in |
| Change password        | Shown as "Set password" (reset-link flow) because there is no current password                                             |
| Unlink Google          | Allowed only when a password exists, so the user can never lock themselves out                                             |
| Delete account         | Re-confirm with a fresh Google sign-in (token issued in the last 5 minutes) instead of a password, plus typed `DELETE`     |
| Settings → profile     | Shows "Signed in with Google" and the Google email                                                                         |

## 7. Backend implementation outline

- **Env:** `GOOGLE_CLIENT_IDS` (required in production, comma-separated, validated as non-empty strings).
- `src/integrations/google/id-token-verifier.js`: wraps `google-auth-library` `OAuth2Client.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_IDS })`. It checks the signature, `iss` (`accounts.google.com` / `https://accounts.google.com`), `aud` and `exp`, and returns the claims or throws `GOOGLE_TOKEN_INVALID`. It is injected into the auth service, so tests stub it and never call Google.
- `src/schemas/auth.schema.js`: `googleSignInBody = z.object({ idToken: z.string().min(100).max(4096) }).strict()`.
- `src/services/auth.service.js` → `signInWithGoogle({ idToken, platform, meta })`: verify, resolve the account (section 4) inside a MongoDB transaction, then create the session.
- `src/routes/v1/auth.route.js`: `POST /auth/google` → rate limit (10 per minute per IP) → validate → controller.
- **Error codes:** `GOOGLE_TOKEN_INVALID` (401), `GOOGLE_EMAIL_NOT_VERIFIED` (401).
- **Response:** `{ data: { user, accessToken, refreshToken?, isNewUser } }`. `refreshToken` is in the body for native clients and in an httpOnly cookie for web.

## 8. Client libraries

| Client | Library                                                                                 | Notes                                                                                                                                                    |
| ------ | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web    | Google Identity Services ("Sign in with Google" button), via `@react-oauth/google`      | Returns the ID token as `credential`. Use the official button styling (spec §7.1 says use the official Google mark)                                      |
| App    | `@react-native-google-signin/google-signin` with `webClientId` set to the Web client ID | Needs an Expo **dev client / EAS build**, so it will not run in Expo Go. Do not use `expo-auth-session` for Google, which is deprecated for this purpose |

## 9. Tests (backend)

Stub the verifier, then cover: new user created with `isNewUser: true` and setup pending · returning user found by `googleSub` · linking an existing verified-email account · the unverified-email takeover case (password removed, old sessions revoked) · `email_verified: false` → 401 · invalid, expired or wrong-audience token → 401 `GOOGLE_TOKEN_INVALID` · rate limit → 429 · the response never contains token hashes or `passwordHash` · a Google-only user's password login → 401.

## 10. Decisions needed from the product owner

1. ~~Keep email and password, or Google only?~~ **Decided (13 Nov 2026):** Google sign-in plus email/password sign-up and sign-in for now. Forgot password and email verification were added on 14 Nov 2026 as emailed links (ADR-0001); change password is still to come.
2. **Sign in with Apple:** App Store Review Guideline 4.8 requires an iOS app that offers a third-party login such as Google to also offer an equivalent privacy-focused option, which in practice means Sign in with Apple. Plan to add it to the iOS app (and the backend, same ID-token pattern) before the first App Store submission, unless the app is Google-free on iOS.
3. **Google Cloud project ownership:** create it under the product owner's account, and confirm the bundle ID and package name for the app.
