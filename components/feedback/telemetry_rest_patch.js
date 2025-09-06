// PATCH: ensure REST fallback uses Authorization: Bearer <anonKey>
// This is a minimal drop-in replacement for the REST insert helper used by telemetry.
export async function __telemetryRestInsert({ url, anonKey, table, row }) {
  const endpoint = `${url}/rest/v1/${encodeURIComponent(table)}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': anonKey,
      'Authorization': `Bearer ${anonKey}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(row || {}),
  });
  const ok = res.ok;
  let body = null;
  try { body = await res.json(); } catch {}
  if (!ok) {
    const msg = `[telemetry] REST insert failed: status=${res.status} body=${JSON.stringify(body)}`;
    globalThis?.console?.error?.(msg);
    throw new Error(msg);
  }
  return body;
}
