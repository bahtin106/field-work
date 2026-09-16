import { APP_RUNTIME_CONFIG } from '../../../config/appRuntime';

export function isProtectedProfileMediaRenderUrl(value) {
  const raw = String(value || '').trim();
  const baseUrl = String(APP_RUNTIME_CONFIG.supabaseUrl || '').trim();
  if (!raw || !baseUrl) return false;

  try {
    const target = new URL(raw);
    const base = new URL(baseUrl);
    const basePath = base.pathname.replace(/\/+$/, '');
    const expectedPath = `${basePath}/functions/v1/profile-media-storage`.replace(/\/{2,}/g, '/');
    const mode = String(target.searchParams.get('mode') || '').trim();
    return (
      target.origin === base.origin &&
      target.pathname.replace(/\/+$/, '') === expectedPath &&
      (mode === 'render' || mode === 'redirect') &&
      Boolean(target.searchParams.get('exp')) &&
      Boolean(target.searchParams.get('sig'))
    );
  } catch {
    return false;
  }
}
