import { useEffect, useMemo, useRef } from 'react';

const SCRIPT_ID = 'cf-turnstile-api-script';
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function loadScriptOnce() {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      if (window.turnstile) return resolve();
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Turnstile script load failed')), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Turnstile script load failed'));
    document.head.appendChild(script);
  });
}

export default function TurnstileWidget({
  siteKey,
  onTokenChange,
  onError,
  theme = 'auto',
  size = 'normal',
}) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const isMountedRef = useRef(true);
  const enabled = useMemo(() => Boolean(String(siteKey || '').trim()), [siteKey]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      try {
        if (window.turnstile && widgetIdRef.current != null) {
          window.turnstile.remove(widgetIdRef.current);
        }
      } catch {}
    };
  }, []);

  useEffect(() => {
    if (!enabled || !containerRef.current) {
      if (typeof onTokenChange === 'function') onTokenChange('');
      return;
    }

    let cancelled = false;
    loadScriptOnce()
      .then(() => {
        if (cancelled || !isMountedRef.current || !window.turnstile || !containerRef.current) return;
        if (widgetIdRef.current != null) {
          try {
            window.turnstile.remove(widgetIdRef.current);
          } catch {}
          widgetIdRef.current = null;
        }
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: String(siteKey).trim(),
          theme,
          size,
          callback(token) {
            if (typeof onTokenChange === 'function') onTokenChange(String(token || ''));
          },
          'expired-callback': () => {
            if (typeof onTokenChange === 'function') onTokenChange('');
          },
          'error-callback': () => {
            if (typeof onTokenChange === 'function') onTokenChange('');
            if (typeof onError === 'function') onError(new Error('TURNSTILE_ERROR'));
          },
        });
      })
      .catch((error) => {
        if (cancelled || !isMountedRef.current) return;
        if (typeof onTokenChange === 'function') onTokenChange('');
        if (typeof onError === 'function') onError(error);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, onError, onTokenChange, siteKey, size, theme]);

  if (!enabled) return null;
  return <div ref={containerRef} />;
}

