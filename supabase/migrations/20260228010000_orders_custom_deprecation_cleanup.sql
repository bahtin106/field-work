-- Deprecate legacy orders.custom usage without dropping the column yet.
-- Safe step:
-- 1) replace test/legacy JSON payloads with an empty object
-- 2) mark the column as deprecated for future DB cleanup
--
-- We intentionally keep the column for now because some legacy RPCs may still
-- exist in deployed environments even though the current application runtime
-- no longer reads or writes orders.custom.

update public.orders
set custom = '{}'::jsonb
where custom is not null;

alter table public.orders
  alter column custom set default '{}'::jsonb;

comment on column public.orders.custom is
  'DEPRECATED: legacy JSON payload for custom order fields. App runtime stopped using this column on 2026-02-28. Keep temporarily for backward compatibility only.';
