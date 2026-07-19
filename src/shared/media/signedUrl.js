const DEFAULT_EXPIRY_SKEW_MS = 2 * 60 * 1000;

function getQueryParamCaseInsensitive(searchParams, name) {
  const expected = String(name || '').toLowerCase();
  for (const [key, value] of searchParams.entries()) {
    if (String(key).toLowerCase() === expected) return String(value || '');
  }
  return '';
}

function parseAmzDate(value) {
  const match = String(value || '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function getSignedMediaUrlExpiresAt(value) {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const parsed = new URL(raw);
    const amzDate = parseAmzDate(getQueryParamCaseInsensitive(parsed.searchParams, 'x-amz-date'));
    const amzExpiresSeconds = Number(
      getQueryParamCaseInsensitive(parsed.searchParams, 'x-amz-expires'),
    );
    if (amzDate != null && Number.isFinite(amzExpiresSeconds) && amzExpiresSeconds >= 0) {
      return amzDate + amzExpiresSeconds * 1000;
    }

    const epochSeconds = Number(getQueryParamCaseInsensitive(parsed.searchParams, 'expires'));
    if (Number.isFinite(epochSeconds) && epochSeconds > 1_000_000_000) {
      return epochSeconds * 1000;
    }
  } catch {}
  return null;
}

export function isSignedMediaUrlStale(value, now = Date.now(), skewMs = DEFAULT_EXPIRY_SKEW_MS) {
  const expiresAt = getSignedMediaUrlExpiresAt(value);
  return expiresAt != null && now + Math.max(0, Number(skewMs) || 0) >= expiresAt;
}
