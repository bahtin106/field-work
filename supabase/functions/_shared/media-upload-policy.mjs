export const MEDIA_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

const MIME_TO_EXTENSION = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heic',
  'image/gif': 'gif',
});

const MIME_ALIASES = Object.freeze({
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png',
  'image/heic-sequence': 'image/heic',
  'image/heif-sequence': 'image/heif',
});

const ALLOWED_EXTENSIONS = new Set(Object.values(MIME_TO_EXTENSION));

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeMediaUploadMime(value) {
  const raw = String(value || 'image/jpeg')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  const normalized = MIME_ALIASES[raw] || raw;
  if (!Object.hasOwn(MIME_TO_EXTENSION, normalized)) {
    throw new Error('Invalid media MIME type');
  }
  return normalized;
}

export function getMediaFileExtension(value) {
  return MIME_TO_EXTENSION[normalizeMediaUploadMime(value)];
}

export function assertMediaUploadSize(value, maxBytes = MEDIA_UPLOAD_MAX_BYTES) {
  const size = Number(value);
  const limit = Number(maxBytes);
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error('Invalid media upload size');
  }
  if (!Number.isSafeInteger(limit) || limit <= 0 || size > limit) {
    throw new Error('Invalid media upload size: file is too large');
  }
  return size;
}

export function assertBase64MediaUploadSize(base64, maxBytes = MEDIA_UPLOAD_MAX_BYTES) {
  const compact = String(base64 || '').replace(/\s+/g, '');
  if (!compact || compact.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new Error('Invalid media upload payload');
  }
  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
  const estimatedBytes = Math.floor((compact.length * 3) / 4) - padding;
  assertMediaUploadSize(estimatedBytes, maxBytes);
  return compact;
}

function normalizeOwnedFolder(folder) {
  const raw = String(folder || '').trim().replace(/\/+$/, '');
  if (!raw || raw.includes('\\') || raw.includes('\0') || raw.includes('?') || raw.includes('#')) {
    throw new Error('Invalid media object folder');
  }
  const segments = raw.split('/').filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Invalid media object folder');
  }
  return raw;
}

/**
 * @param {unknown} value
 * @param {{ expectedFolder: string, filenamePrefixes?: string[] }} options
 */
export function assertOwnedMediaUploadPath(
  value,
  { expectedFolder, filenamePrefixes = ['media'] },
) {
  const path = String(value || '').trim();
  const folder = normalizeOwnedFolder(expectedFolder);
  if (
    !path ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.includes('?') ||
    path.includes('#') ||
    path.includes('//')
  ) {
    throw new Error('Invalid media object key');
  }

  const expectedPrefix = `${folder}/`;
  if (!path.startsWith(expectedPrefix)) throw new Error('Invalid media object key scope');
  const filename = path.slice(expectedPrefix.length);
  if (!filename || filename.includes('/')) throw new Error('Invalid media object key');

  const prefixes = Array.isArray(filenamePrefixes)
    ? filenamePrefixes.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (!prefixes.length) throw new Error('Invalid media object filename policy');
  const prefixPattern = prefixes.map(escapeRegExp).join('|');
  const match = new RegExp(
    `^(?:${prefixPattern})_[0-9]{10,16}_[a-f0-9]{16}\\.([a-z0-9]+)$`,
    'iu',
  ).exec(filename);
  if (!match || !ALLOWED_EXTENSIONS.has(String(match[1] || '').toLowerCase())) {
    throw new Error('Invalid media object filename');
  }
  return path;
}

/**
 * @param {{ path: unknown, contentLength: unknown, contentType: unknown }} upload
 * @param {{ expectedFolder: string, filenamePrefixes?: string[], maxBytes?: number }} options
 */
export function assertCommittedMediaUpload(
  { path, contentLength, contentType },
  { expectedFolder, filenamePrefixes = ['media'], maxBytes = MEDIA_UPLOAD_MAX_BYTES },
) {
  const ownedPath = assertOwnedMediaUploadPath(path, { expectedFolder, filenamePrefixes });
  if (!String(contentType || '').trim()) throw new Error('Invalid media MIME type');
  const mime = normalizeMediaUploadMime(contentType);
  const size = assertMediaUploadSize(contentLength, maxBytes);
  const extension = String(ownedPath.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  if (extension !== getMediaFileExtension(mime)) {
    throw new Error('Invalid media MIME and extension combination');
  }
  return { path: ownedPath, mime, size };
}
