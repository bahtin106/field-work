import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MEDIA_UPLOAD_MAX_BYTES,
  assertBase64MediaUploadSize,
  assertCommittedMediaUpload,
  assertMediaUploadSize,
  assertOwnedMediaUploadPath,
  getMediaFileExtension,
  normalizeMediaUploadMime,
} from '../supabase/functions/_shared/media-upload-policy.mjs';

const folder = 'companies/acme/12345678/orders/2026-08/order_abcdef12/Media_1';
const key = `${folder}/media_1787316000000_0123456789abcdef.jpg`;

assert.equal(normalizeMediaUploadMime(' IMAGE/JPG; charset=binary '), 'image/jpeg');
assert.equal(normalizeMediaUploadMime('image/heif-sequence'), 'image/heif');
assert.equal(getMediaFileExtension('image/heif'), 'heic');
assert.throws(() => normalizeMediaUploadMime('image/svg+xml'), /Invalid media MIME/);
assert.throws(() => normalizeMediaUploadMime('text/html'), /Invalid media MIME/);

assert.equal(assertMediaUploadSize(1), 1);
assert.equal(assertMediaUploadSize(MEDIA_UPLOAD_MAX_BYTES), MEDIA_UPLOAD_MAX_BYTES);
assert.throws(() => assertMediaUploadSize(0), /Invalid media upload size/);
assert.throws(() => assertMediaUploadSize(MEDIA_UPLOAD_MAX_BYTES + 1), /too large/);
assert.equal(assertBase64MediaUploadSize('YQ=='), 'YQ==');
assert.throws(
  () => assertBase64MediaUploadSize('A'.repeat(Math.ceil((MEDIA_UPLOAD_MAX_BYTES * 4) / 3) + 8)),
  /too large/,
);

assert.equal(assertOwnedMediaUploadPath(key, { expectedFolder: folder }), key);
assert.throws(
  () => assertOwnedMediaUploadPath(key.replace('/orders/', '/foreign/'), { expectedFolder: folder }),
  /scope/,
);
assert.throws(
  () => assertOwnedMediaUploadPath(`${folder}/../media_1787316000000_0123456789abcdef.jpg`, { expectedFolder: folder }),
  /object key/,
);
assert.throws(
  () => assertOwnedMediaUploadPath(`${folder}/media_1787316000000_0123456789abcdef.svg`, { expectedFolder: folder }),
  /filename/,
);

assert.deepEqual(
  assertCommittedMediaUpload(
    { path: key, contentLength: 1024, contentType: 'image/jpeg' },
    { expectedFolder: folder },
  ),
  { path: key, mime: 'image/jpeg', size: 1024 },
);
assert.throws(
  () =>
    assertCommittedMediaUpload(
      { path: key, contentLength: 1024, contentType: 'image/png' },
      { expectedFolder: folder },
    ),
  /MIME and extension/,
);
assert.throws(
  () =>
    assertCommittedMediaUpload(
      { path: key, contentLength: MEDIA_UPLOAD_MAX_BYTES + 1, contentType: 'image/jpeg' },
      { expectedFolder: folder },
    ),
  /too large/,
);

const yandexFolder = '/monitor/company/Объекты/object_abcdef12/Media_1';
const yandexPath = `${yandexFolder}/медиа_1787316000000_0123456789abcdef.webp`;
assert.equal(
  assertOwnedMediaUploadPath(yandexPath, {
    expectedFolder: yandexFolder,
    filenamePrefixes: ['медиа'],
  }),
  yandexPath,
);

for (const path of [
  'supabase/functions/order-media-storage/index.ts',
  'supabase/functions/object-media-storage/index.ts',
  'supabase/functions/finance-entry-media-storage/index.ts',
  'supabase/functions/profile-media-storage/index.ts',
]) {
  const source = readFileSync(path, 'utf8');
  assert.match(source, /normalizeMediaUploadMime\(body\.mime\)/, `${path} must enforce the MIME allowlist`);
  assert.match(source, /assertBase64MediaUploadSize\(b64\)/, `${path} must cap fallback uploads before decode`);
  assert.match(source, /assertCommittedMediaUpload\(/, `${path} must validate committed object metadata`);
  assert.match(source, /assertOwnedMediaUploadPath\(/, `${path} must bind object keys to the authenticated entity scope`);
  assert.match(source, /max_size_bytes: MEDIA_UPLOAD_MAX_BYTES/, `${path} must advertise the server limit`);
  assert.match(source, /SUPABASE_ANON_KEY/, `${path} must create a caller-scoped RLS client`);
  assert.match(source, /callerDb/, `${path} must query the target through the caller JWT`);
  assert.doesNotMatch(source, /String\(body\.public_url/, `${path} must not trust a client-supplied public URL`);
}

console.log('Media upload policy tests passed.');
