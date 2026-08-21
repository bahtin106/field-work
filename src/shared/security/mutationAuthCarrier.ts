import { supabase } from '../../../lib/supabase';
import {
  getActiveOfflineOwnerContext,
  isActiveOfflineOwnerContext,
  type OfflineOwnerContext,
} from '../offline/offlineStatus';
import {
  assertActiveQueryCacheOwnerContext,
  captureActiveQueryCacheOwnerContext,
  isActiveQueryCacheOwnerContext,
  type QueryCacheOwnerContext,
} from '../query/queryClient';

const MUTATION_AUTH_CARRIER = Symbol('field-work-mutation-auth-carrier');
const SESSION_CAPTURE_TIMEOUT_MS = 2_500;

type MutationVariables = Record<PropertyKey, unknown>;

export type MutationAuthCarrier = Readonly<{
  query: QueryCacheOwnerContext;
  offline: OfflineOwnerContext | null;
  userId: string;
  authorization: string;
}>;

function createCarrierError(code: string, message: string) {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

function normalizeId(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

async function readCurrentSessionWithinDeadline() {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      supabase.auth.getSession(),
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            createCarrierError(
              'MUTATION_AUTH_SESSION_TIMEOUT',
              'Timed out while securing the current mutation session',
            ),
          );
        }, SESSION_CAPTURE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function isActiveMutationAuthCarrier(
  carrier: MutationAuthCarrier | null | undefined,
  { requireOfflineOwner = false } = {},
) {
  if (!carrier || !isActiveQueryCacheOwnerContext(carrier.query)) return false;
  if (carrier.offline && !isActiveOfflineOwnerContext(carrier.offline)) return false;
  if (requireOfflineOwner && !isActiveOfflineOwnerContext(carrier.offline)) return false;
  return true;
}

export function assertMutationAuthCarrier(
  carrier: MutationAuthCarrier | null | undefined,
  options: { requireOfflineOwner?: boolean } = {},
) {
  assertActiveQueryCacheOwnerContext(carrier?.query);
  if (carrier?.offline && !isActiveOfflineOwnerContext(carrier.offline)) {
    throw createCarrierError(
      'OFFLINE_OWNER_CONTEXT_CHANGED',
      'Offline owner changed during mutation',
    );
  }
  if (options.requireOfflineOwner && !isActiveOfflineOwnerContext(carrier?.offline)) {
    throw createCarrierError(
      'OFFLINE_OWNER_CONTEXT_CHANGED',
      'Offline owner changed during mutation',
    );
  }
  if (!carrier?.authorization || !carrier.userId) {
    throw createCarrierError(
      'MUTATION_AUTH_CARRIER_INVALID',
      'Mutation authorization context is unavailable',
    );
  }
  return carrier;
}

export function assertMutationPayloadCompany(
  carrier: MutationAuthCarrier | null | undefined,
  companyId: unknown,
  options: { requireOfflineOwner?: boolean } = {},
) {
  const activeCarrier = assertMutationAuthCarrier(carrier, options);
  const payloadCompanyId = normalizeId(companyId);
  const queryCompanyId = normalizeId(activeCarrier.query.owner.companyId);
  const offlineCompanyId = activeCarrier.offline
    ? normalizeId(activeCarrier.offline.owner.companyId)
    : null;

  if (!payloadCompanyId || !queryCompanyId) {
    throw createCarrierError(
      'MUTATION_COMPANY_SCOPE_REQUIRED',
      'A company-scoped session is required for this mutation',
    );
  }
  if (
    payloadCompanyId !== queryCompanyId ||
    (activeCarrier.offline && payloadCompanyId !== offlineCompanyId)
  ) {
    throw createCarrierError(
      'MUTATION_COMPANY_SCOPE_MISMATCH',
      'Mutation company does not match the active account',
    );
  }
  return payloadCompanyId;
}

export async function attachMutationAuthCarrier(
  variables: MutationVariables,
  { requireOfflineOwner = false } = {},
) {
  if (!variables || typeof variables !== 'object') {
    throw createCarrierError(
      'MUTATION_VARIABLES_INVALID',
      'Mutation variables must be an object',
    );
  }

  const query = captureActiveQueryCacheOwnerContext();
  assertActiveQueryCacheOwnerContext(query);
  // Capture the offline owner whenever it is available, even for online-only
  // mutations. This gives every carrier the strongest available owner epoch
  // without making account bootstrap depend on the offline subsystem.
  const offline = getActiveOfflineOwnerContext();
  if (requireOfflineOwner && !isActiveOfflineOwnerContext(offline)) {
    throw createCarrierError(
      'OFFLINE_OWNER_CONTEXT_UNAVAILABLE',
      'Company-scoped session is required for this mutation',
    );
  }
  if (
    offline &&
    (normalizeId(offline.owner.userId) !== normalizeId(query?.owner.userId) ||
      normalizeId(offline.owner.companyId) !== normalizeId(query?.owner.companyId))
  ) {
    throw createCarrierError(
      'MUTATION_OWNER_SCOPE_MISMATCH',
      'Mutation owner contexts do not match',
    );
  }

  const ownerUserId = normalizeId(query?.owner.userId);
  // Install an owner-only guard before the SDK session read. If that local
  // read times out, UI callbacks can still report the failure to the same
  // account, while account-switch callbacks remain suppressed. The empty
  // authorization value can never pass assertMutationAuthCarrier.
  Object.defineProperty(variables, MUTATION_AUTH_CARRIER, {
    value: Object.freeze({
      query: query as QueryCacheOwnerContext,
      offline,
      userId: ownerUserId,
      authorization: '',
    }) as MutationAuthCarrier,
    configurable: true,
    enumerable: false,
    writable: false,
  });

  const { data, error } = await readCurrentSessionWithinDeadline();
  assertActiveQueryCacheOwnerContext(query);
  if ((offline || requireOfflineOwner) && !isActiveOfflineOwnerContext(offline)) {
    throw createCarrierError(
      'OFFLINE_OWNER_CONTEXT_CHANGED',
      'Offline owner changed while securing mutation authorization',
    );
  }
  if (error) throw error;

  const session = data?.session;
  const sessionUserId = normalizeId(session?.user?.id);
  const accessToken = String(session?.access_token || '').trim();
  if (!sessionUserId || sessionUserId !== ownerUserId || !accessToken) {
    throw createCarrierError(
      'MUTATION_AUTH_SCOPE_CHANGED',
      'Authenticated account changed before mutation started',
    );
  }

  const carrier: MutationAuthCarrier = Object.freeze({
    query: query as QueryCacheOwnerContext,
    offline,
    userId: ownerUserId,
    authorization: `Bearer ${accessToken}`,
  });
  Object.defineProperty(variables, MUTATION_AUTH_CARRIER, {
    value: carrier,
    configurable: true,
    enumerable: false,
    writable: false,
  });
  return carrier;
}

export function requireMutationAuthCarrier(
  variables: MutationVariables | null | undefined,
  options: { requireOfflineOwner?: boolean } = {},
) {
  const carrier = getMutationAuthCarrier(variables);
  return assertMutationAuthCarrier(carrier, options);
}

export function getMutationAuthCarrier(
  variables: MutationVariables | null | undefined,
) {
  return variables?.[MUTATION_AUTH_CARRIER] as MutationAuthCarrier | undefined;
}

export function clearMutationAuthCarrier(variables: MutationVariables | null | undefined) {
  if (!variables || typeof variables !== 'object') return;
  try {
    delete variables[MUTATION_AUTH_CARRIER];
  } catch {}
}

export function pinMutationAuthorization<T extends { setHeader?: (name: string, value: string) => T }>(
  request: T,
  carrier: MutationAuthCarrier,
  options: { requireOfflineOwner?: boolean } = {},
) {
  const activeCarrier = assertMutationAuthCarrier(carrier, options);
  if (!request || typeof request.setHeader !== 'function') {
    throw createCarrierError(
      'MUTATION_REQUEST_NOT_PINNABLE',
      'Protected mutation request cannot pin authorization',
    );
  }
  return request.setHeader('Authorization', activeCarrier.authorization);
}
