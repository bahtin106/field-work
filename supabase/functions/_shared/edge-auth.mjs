export function extractBearerToken(authorization) {
  const value = String(authorization || '').trim();
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return String(match?.[1] || '').trim();
}

export function hasExactBearerSecret(authorization, expectedSecret) {
  const token = extractBearerToken(authorization);
  const expected = String(expectedSecret || '').trim();
  if (!token || !expected || token.length !== expected.length) return false;

  let difference = 0;
  for (let index = 0; index < token.length; index += 1) {
    difference |= token.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}
