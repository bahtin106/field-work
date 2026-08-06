# Supabase credential incident — 2026-08-05

## What happened

A historical `app.json` revision in the public Git repository contained a Supabase
`service_role` JWT. This is a privileged server credential and must never be
included in Expo configuration, OTA manifests, bundles, logs, or commits.

The production Expo configuration no longer contains a service-role credential.
A public Supabase anon key is intentionally provided to the mobile client; its
permissions are constrained by RLS and it is not an administrator credential.

## Remediation performed

1. Rotated `JWT_SECRET`, `ANON_KEY`, and `SERVICE_ROLE_KEY` together in both
   production environment files, then recreated the Supabase services.
2. Published the matching EAS Update for runtime `1.0.3` before the server
   switch, so installed Android and iOS clients receive the new public anon key.
3. Verified the new anon and service keys authenticate successfully, while the
   historical anon and service-role keys return HTTP 401.
4. Refreshed the ignored local development environment with the new credentials.
5. Added a repository/CI guard that rejects privileged Expo configuration and
   committed Supabase/JWT secret values.

Rotating `SERVICE_ROLE_KEY` alone is insufficient when a signed JWT leaked:
the old JWT remains valid until its expiry while `JWT_SECRET` stays unchanged.

## Required repository follow-up

Rewrite and force-push every reachable Git ref to remove the historical secret.
After the push, collaborators and CI runners must discard old clones and reclone.
Forks, cached views, local clones, backups, and third-party scanners may still
retain it; invalidate those copies and contact GitHub Support if cached secret
material remains visible after the rewrite.

## Permanent operating rules

- Store privileged Supabase credentials only in the server secret store or EAS
  variables with the appropriate non-public visibility.
- Expo `extra` is public app configuration. It may contain the public anon key,
  never a service role key, JWT secret, SMTP credential, or private key.
- Run `npm run security:secrets` locally and require the GitHub Action to pass on
  every pull request.
- For any suspected JWT/key exposure, rotate the whole Supabase JWT bundle and
  verify the exposed token receives HTTP 401 before closing the incident.
