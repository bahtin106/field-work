# Supabase migrations policy

## Why this exists

This project contains historical migrations named only by date (for example, `20260220_*`).
Supabase uses the numeric prefix before `_` as the migration version, so multiple files with the
same date collide and break migration history consistency.

## Rules from now on

1. Always create migrations via CLI:
   - `npx supabase migration new <name>`
2. Never create migration files manually with date-only prefixes.
3. Every migration version must be unique (timestamp format like `YYYYMMDDHHMMSS`).
4. Do not run `db push --include-all` on this repository unless you intentionally reconcile old legacy files.

## Safe workflow

1. Create:
   - `npx supabase migration new add_feature_x`
2. Edit generated file in `supabase/migrations/`.
3. Apply to linked project:
   - `npx supabase db push --linked`
4. Check history:
   - `npx supabase migration list --linked`

## Legacy note

Older date-only migrations remain in history for compatibility. The project now uses unique
timestamped versions for new migrations to prevent future conflicts.
