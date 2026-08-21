import { APP_RUNTIME_CONFIG } from '../../../config/appRuntime';

export function isProtectedMediaThumbnailUrl(value) {
  const raw = String(value || '').trim();
  const baseUrl = String(APP_RUNTIME_CONFIG.supabaseUrl || '').trim();
  if (!raw || !baseUrl) return false;

  try {
    const target = new URL(raw);
    const base = new URL(baseUrl);
    const basePath = base.pathname.replace(/\/+$/, '');
    const expectedPath = `${basePath}/functions/v1/media-thumbnail`.replace(/\/{2,}/g, '/');
    return target.origin === base.origin && target.pathname.replace(/\/+$/, '') === expectedPath;
  } catch {
    return false;
  }
}
