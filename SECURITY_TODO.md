# Security TODO

Manual actions required:

| Priority | Task | Details |
|---|---|---|
| Critical | Rotate Android release signing material | `credentials.json` and `my-release-key.jks` were tracked. Generate a new upload/release key, update EAS/Play Console as applicable, and invalidate old signing credentials where possible. |
| Critical | Configure release signing outside git | Set `MYAPP_UPLOAD_STORE_FILE`, `MYAPP_UPLOAD_STORE_PASSWORD`, `MYAPP_UPLOAD_KEY_ALIAS`, and `MYAPP_UPLOAD_KEY_PASSWORD` through local Gradle properties or CI/EAS secrets. Never commit those values. |
| Critical | Rotate Supabase service role/JWT secrets | `supabase/.env.local` contains service role material. Rotate service role key and any JWT secret exposed to local files or logs. Redeploy Edge Function secrets. |
| Critical | Purge secrets from git history | Removing files from the index stops future exposure, but previous commits can still contain them. Use `git filter-repo` or BFG, then force-push only with team coordination. |
| High | Set `EMAIL_SERVER_API_TOKEN` in production | The Node email server supports this now. Put the token in server env/secret storage and call it only from trusted backend/Edge Functions, not directly from mobile. |
| High | Verify production RLS state | Run live DB checks for RLS enabled, grants to `anon/authenticated`, policies, storage bucket privacy, and SECURITY DEFINER search paths. Migration files look hardened, but production drift cannot be ruled out offline. |
| High | Review password reset model | Current flow still emails temporary passwords. Safer long-term path is one-time reset links with short TTL, single-use tokens, and no plaintext password delivery. |
| Medium | Add abuse protection to public Supabase functions | Add DB-backed rate limits or CAPTCHA/turnstile equivalent for `public-support-request` and password reset. In-memory cooldown is not enough across edge instances. |
| Medium | Review CORS/origin deployment values | Set `EMAIL_SERVER_ALLOWED_ORIGINS` to exact production origins. Keep mobile/server calls that have no Origin working deliberately. |
| Medium | Firebase restrictions | Restrict Firebase API key by package name/SHA certificates and disable unused Firebase APIs. |
| Medium | Source map policy | Ensure production sourcemaps are private and build artifacts do not publish local `.env`, temp SQL, or generated debug files. |
| Medium | Dependency upgrade plan | Remaining audit issues require breaking changes around Expo/patch-package/expo-module-scripts. Plan SDK-compatible upgrades instead of `npm audit fix --force`. |
| Low | Deno typecheck pipeline | Add Supabase/Deno-specific checks instead of running all functions through plain `tsc`. |
