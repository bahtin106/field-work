-- Ensure storage upload/read/delete works for authenticated app users.
-- Applies to the buckets used by the mobile app:
--   - orders-photos (order attachments)
--   - avatars (profile photos)

-- Orders photos
DROP POLICY IF EXISTS orders_photos_select_authenticated ON storage.objects;
CREATE POLICY orders_photos_select_authenticated
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'orders-photos'
  AND (storage.foldername(name))[1] = 'orders'
);

DROP POLICY IF EXISTS orders_photos_insert_authenticated ON storage.objects;
CREATE POLICY orders_photos_insert_authenticated
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'orders-photos'
  AND (storage.foldername(name))[1] = 'orders'
);

DROP POLICY IF EXISTS orders_photos_update_authenticated ON storage.objects;
CREATE POLICY orders_photos_update_authenticated
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'orders-photos'
  AND (storage.foldername(name))[1] = 'orders'
)
WITH CHECK (
  bucket_id = 'orders-photos'
  AND (storage.foldername(name))[1] = 'orders'
);

DROP POLICY IF EXISTS orders_photos_delete_authenticated ON storage.objects;
CREATE POLICY orders_photos_delete_authenticated
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'orders-photos'
  AND (storage.foldername(name))[1] = 'orders'
);

-- Avatars
DROP POLICY IF EXISTS avatars_select_authenticated ON storage.objects;
CREATE POLICY avatars_select_authenticated
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = 'profiles'
);

DROP POLICY IF EXISTS avatars_insert_authenticated ON storage.objects;
CREATE POLICY avatars_insert_authenticated
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = 'profiles'
);

DROP POLICY IF EXISTS avatars_update_authenticated ON storage.objects;
CREATE POLICY avatars_update_authenticated
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = 'profiles'
)
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = 'profiles'
);

DROP POLICY IF EXISTS avatars_delete_authenticated ON storage.objects;
CREATE POLICY avatars_delete_authenticated
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = 'profiles'
);
