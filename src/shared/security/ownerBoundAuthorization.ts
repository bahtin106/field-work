import { getCachedSupabaseAccessToken } from '../../../lib/supabaseSessionCache';

export type OwnerBoundAuthorization = Readonly<{
  userId: string;
}>;

const authorizationByCarrier = new WeakMap<object, string>();

function normalizeUserId(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function createAuthorizationError(code: string, message: string) {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

export async function captureOwnerBoundAuthorization(
  expectedUserId: unknown,
): Promise<OwnerBoundAuthorization> {
  const userId = normalizeUserId(expectedUserId);
  if (!userId) {
    throw createAuthorizationError(
      'OWNER_AUTH_SCOPE_UNAVAILABLE',
      'An authenticated owner is required for background synchronization',
    );
  }

  const token = String(await getCachedSupabaseAccessToken(userId) || '').trim();
  if (!token) {
    throw createAuthorizationError(
      'OWNER_AUTH_UNAVAILABLE',
      'The authenticated owner session is unavailable',
    );
  }

  // The JWT lives only in a WeakMap. It is neither enumerable nor reachable by
  // JSON.stringify/TanStack dehydration if a carrier is ever passed by mistake.
  const carrier: OwnerBoundAuthorization = Object.freeze({ userId });
  authorizationByCarrier.set(carrier, `Bearer ${token}`);
  return carrier;
}

export function assertOwnerBoundAuthorization(
  carrier: OwnerBoundAuthorization | null | undefined,
  expectedUserId: unknown = null,
) {
  const userId = normalizeUserId(carrier?.userId);
  const expected = normalizeUserId(expectedUserId);
  if (
    !carrier ||
    !userId ||
    (expected && userId !== expected) ||
    !authorizationByCarrier.has(carrier as object)
  ) {
    throw createAuthorizationError(
      'OWNER_AUTH_SCOPE_CHANGED',
      'Background synchronization authorization no longer matches its owner',
    );
  }
  return carrier;
}

export function pinOwnerBoundPostgrestRequest<
  T extends { setHeader?: (name: string, value: string) => T },
>(request: T, carrier: OwnerBoundAuthorization, expectedUserId: unknown = null) {
  const activeCarrier = assertOwnerBoundAuthorization(carrier, expectedUserId);
  if (!request || typeof request.setHeader !== 'function') {
    throw createAuthorizationError(
      'OWNER_AUTH_REQUEST_NOT_PINNABLE',
      'Owner-bound request cannot pin authorization',
    );
  }
  return request.setHeader(
    'Authorization',
    authorizationByCarrier.get(activeCarrier as object) as string,
  );
}

export function buildOwnerBoundFunctionHeaders(
  carrier: OwnerBoundAuthorization,
  expectedUserId: unknown = null,
  headers: Record<string, string> = {},
) {
  const activeCarrier = assertOwnerBoundAuthorization(carrier, expectedUserId);
  return {
    ...headers,
    Authorization: authorizationByCarrier.get(activeCarrier as object) as string,
  };
}

export function isOwnerAuthorizationUnavailableError(error: unknown) {
  const code = String((error as { code?: string })?.code || '');
  return code === 'OWNER_AUTH_UNAVAILABLE' || code === 'OWNER_AUTH_SCOPE_UNAVAILABLE';
}
