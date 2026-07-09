-- storage.buckets had no uniqueness guarantee in this self-hosted instance,
-- and email-templates existed twice with identical payload. Keep the oldest
-- row per id and prevent future duplicate bucket ids.

with ranked as (
  select
    ctid,
    row_number() over (
      partition by id
      order by created_at nulls last, updated_at nulls last, ctid
    ) as rn
  from storage.buckets
)
delete from storage.buckets b
using ranked r
where b.ctid = r.ctid
  and r.rn > 1;

create unique index if not exists buckets_id_unique_idx
on storage.buckets (id);
