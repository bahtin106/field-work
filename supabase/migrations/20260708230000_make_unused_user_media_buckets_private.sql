-- User/order media is stored through the external media pipeline now. The
-- legacy Supabase buckets are empty and have no stored public references, so
-- keep them private to avoid accidental public exposure if they are reused.

update storage.buckets
set public = false,
    updated_at = now()
where id in ('avatars', 'orders-photos')
  and public is distinct from false;
