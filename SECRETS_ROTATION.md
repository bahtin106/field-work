# Secrets Rotation

Do not paste secret values into tickets, chat, logs, or commits. Rotate by type and path below.

| Secret type | Path | Exposure | Action |
|---|---|---|---|
| Supabase service role key | `supabase/.env.local` | Local ignored file; value was present in workspace. | Rotate Supabase service role key/JWT secret, update Edge Function and server env secrets, restart services. |
| Duplicate service role env alias | `supabase/.env.local` | Same class of secret under alternate variable name. | Remove duplicate alias after rotation; keep one canonical env name in secret manager. |
| Android keystore password metadata | `credentials.json` | Was tracked by git. | Generate new signing credentials; remove from history; store only in EAS/secure secret manager. |
| Android release keystore | `my-release-key.jks` | Was tracked by git. | Replace key, update release pipeline, purge old key from history/backups where feasible. |
| Supabase pooler/database metadata | `supabase/.temp/pooler-url` | Was tracked by git. | Rotate DB password/pooler credentials if URL included credentials; remove all `supabase/.temp/*` from history. |
| JWT secret | `.env.local` | Local ignored root env exports `JWT_SECRET`. | Rotate if this file has ever left the workstation or was used in shared logs/backups. |
| SMTP configuration | `.env.local` / deployment env | Local ignored env contains SMTP fields. | Rotate SMTP credentials if actual usernames/passwords are present in env or provider logs. |
| Firebase/Google mobile config | `google-services.json`, `android/app/google-services.json` | Tracked public mobile config. | Usually public; still restrict keys by app/package/SHA and rotate if unrestricted server APIs are enabled. |

History cleanup checklist:
1. Coordinate freeze with anyone using the repo.
2. Rewrite history for `credentials.json`, `my-release-key.jks`, `supabase/.temp/*`, and any committed env files.
3. Force-push protected branches only after rotation is complete.
4. Ask all collaborators/CI runners to reclone or garbage-collect old objects.
