-- Add soft-disable support for work types without destructive deletion.
-- This keeps existing data and allows temporary hiding in UI.

alter table if exists public.work_types
  add column if not exists is_enabled boolean not null default true;

update public.work_types
set is_enabled = true
where is_enabled is null;

create index if not exists work_types_company_enabled_position_idx
  on public.work_types (company_id, is_enabled, position);
