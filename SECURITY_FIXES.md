# Security Fixes

Applied fixes:

| Area | Files | Change | Why safer |
|---|---|---|---|
| Native session storage | `lib/supabase.js`, `package.json`, `package-lock.json` | Added `expo-secure-store` and switched Supabase auth storage to SecureStore on native. | Refresh/access tokens are no longer stored in plain AsyncStorage on iOS/Android. |
| Telemetry redaction | `lib/errorLogsClient.js` | Added recursive redaction for sensitive keys plus JWT/Bearer patterns. | Prevents accidental token/password leakage into client error logs. |
| Edge Function authorization | `supabase/functions/update_user/index.ts` | Added JWT verification and actor/target authorization checks before service-role updates. | Prevents IDOR/BOLA through service-role-backed user updates. |
| Password reset entropy/enumeration | `supabase/functions/request-password-reset/index.ts` | Replaced low-entropy temp passwords with crypto-random passwords and made unknown-email response generic. | Reduces brute-force and account enumeration risk. |
| Email server hardening | `email-server.cjs` | Removed request-body service key override, added CORS allowlist, optional `EMAIL_SERVER_API_TOKEN`, and rate limits. | Reduces admin credential misuse and endpoint abuse risk. |
| Android hardening | `android/app/src/main/AndroidManifest.xml`, `app.json` | Disabled Android backup/cleartext traffic and removed unnecessary permissions. | Reduces local data exposure and permission attack surface. |
| Android release signing | `android/app/build.gradle`, `android/gradle.properties` | Removed debug signing from release builds, moved release signing to env/Gradle properties, disabled dev network inspector by default. | Prevents shipping Play builds with debug credentials and keeps signing secrets out of git. |
| Secret hygiene | `.gitignore`, git index | Ignored `credentials.json`, `*.jks`, `supabase/.temp/`; removed tracked secret/temp files from git index. | Stops future commits of signing credentials and Supabase temp metadata. |
| Supply chain | `package-lock.json`, `package.json` | Ran non-breaking `npm audit fix` and restored Expo SDK-compatible versions via `expo install --check`. | Removed several high findings without knowingly forcing breaking upgrades. |

Notes:
- `EMAIL_SERVER_API_TOKEN` is optional to avoid breaking current deployments, but production should set it and callers should send it only from trusted server-side code.
- `app.json` still contains the Supabase anon key by design; anon keys are public and must be constrained by RLS.
