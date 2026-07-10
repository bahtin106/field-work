import { useEffect, useMemo } from 'react';

export function useClearResolvedFieldErrors({
  isResolved,
  fieldKeys,
  setFieldErrors,
}) {
  const keys = useMemo(
    () => [...new Set((Array.isArray(fieldKeys) ? fieldKeys : []).map(String).filter(Boolean))],
    [fieldKeys],
  );
  const keysFingerprint = keys.join('\u0000');

  useEffect(() => {
    if (!isResolved || !keysFingerprint || typeof setFieldErrors !== 'function') return;
    const resolvedKeys = keysFingerprint.split('\u0000');
    setFieldErrors((previous) => {
      if (!previous || typeof previous !== 'object') return previous;
      if (!resolvedKeys.some((key) => previous[key] != null)) return previous;
      const next = { ...previous };
      resolvedKeys.forEach((key) => delete next[key]);
      return next;
    });
  }, [isResolved, keysFingerprint, setFieldErrors]);
}

export default useClearResolvedFieldErrors;
