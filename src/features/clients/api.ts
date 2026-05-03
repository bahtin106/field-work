import { supabase } from '../../../lib/supabase';
import { measureNetwork } from '../../shared/perf/devMetrics';
import {
  buildClientObjectAddressSummary,
  normalizeClientObject,
} from '../objects/addressing';
import { inspectProfileMedia } from '../profileMedia/api';
import { extractTagsFromLinks } from '../tags/api';
import { getClientAdditionalPhones } from './additionalPhones';
import { getMyCompanyId } from '../profile/api';
import { normalizeOptionalMobilePhone } from '../../shared/validation/phone';
import { applyOrderRelationFilters } from '../requests/relationFilters';

const clientByIdInFlight = new Map<string, Promise<any>>();
const CLIENT_COLUMNS_BASE =
  'id, company_id, first_name, last_name, middle_name, full_name, email, phone, avatar_url, created_at, updated_at';
const CLIENT_COLUMNS_WITH_COMMENT = `${CLIENT_COLUMNS_BASE}, comment`;
const CLIENT_COLUMNS_WITH_ADDITIONAL =
  `${CLIENT_COLUMNS_WITH_COMMENT}, additional_phone_1, additional_phone_1_label, additional_phone_2, additional_phone_2_label, additional_phone_3, additional_phone_3_label`;
const CLIENT_LIST_OBJECTS_RELATION =
  'client_objects(id, client_id, company_id, name, is_primary, country, region, city, street, house, apartment, object_tag_links(tag:company_tags(id, value, tag_type)))';
const CLIENT_TAGS_RELATION = 'client_tag_links(tag:company_tags(id, value, tag_type))';

function shouldFallbackWithoutAdditionalFields(error: any) {
  const msg = String(error?.message || '').toLowerCase();
  return (
    (msg.includes('additional_phone_1') || msg.includes('comment')) &&
    (msg.includes('does not exist') || msg.includes('not found'))
  );
}

async function resolveScopedCompanyId(explicitCompanyId: string | null = null) {
  const provided = String(explicitCompanyId || '').trim();
  if (provided) return provided;
  const mine = await getMyCompanyId();
  return String(mine || '').trim() || null;
}

export function formatClientNameForOrder(client: any) {
  if (!client || typeof client !== 'object') return '';

  const firstName = String(client.first_name ?? client.firstName ?? '').trim();
  const middleName = String(client.middle_name ?? client.middleName ?? '').trim();
  const lastName = String(client.last_name ?? client.lastName ?? '').trim();

  return [firstName, middleName, lastName].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function normalizeClient(row: any) {
  if (!row) return null;
  const firstName = String(row.first_name || '').trim();
  const lastName = String(row.last_name || '').trim();
  const middleName = String(row.middle_name || '').trim();
  const fullName =
    [firstName, middleName, lastName].filter(Boolean).join(' ').trim() ||
    String(row.full_name || '').trim();

  const objects = Array.isArray(row.client_objects)
    ? row.client_objects.map(normalizeClientObject).filter(Boolean)
    : [];
  const sortedObjects = [...objects].sort((left, right) => {
    if (!!left?.is_primary !== !!right?.is_primary) return left?.is_primary ? -1 : 1;
    return String(left?.name || '').localeCompare(String(right?.name || ''), 'ru');
  });
  const primaryObject =
    sortedObjects.find((objectItem) => objectItem?.is_primary) || sortedObjects[0] || null;
  const additionalPhones = getClientAdditionalPhones(row);

  return {
    ...row,
    firstName,
    lastName,
    middleName: middleName || null,
    fullName: fullName || '',
    comment: String(row.comment || '').trim() || null,
    secondaryPhone: additionalPhones[0]?.phone || null,
    additionalPhone1: additionalPhones[0]?.phone || null,
    additionalPhone1Label: additionalPhones[0]?.label || null,
    additionalPhone2: additionalPhones[1]?.phone || null,
    additionalPhone2Label: additionalPhones[1]?.label || null,
    additionalPhone3: additionalPhones[2]?.phone || null,
    additionalPhone3Label: additionalPhones[2]?.label || null,
    additionalPhones,
    avatarUrl: row.avatar_url || null,
    avatarDisplayUrl: row.avatar_display_url || row.avatar_url || null,
    objects: sortedObjects,
    primaryObject,
    primaryObjectSummary: buildClientObjectAddressSummary(primaryObject) || null,
    tags: extractTagsFromLinks(row.client_tag_links),
  };
}

function applyClientMediaCleanup(row: any, cleanedSet: Set<string>) {
  if (!row || !cleanedSet.size) return row;
  const nextRow = {
    ...row,
    avatar_url: cleanedSet.has(String(row.avatar_url || '').trim()) ? null : row.avatar_url,
  };
  if (Array.isArray(row.client_objects)) {
    nextRow.client_objects = row.client_objects.map((objectItem: any) => ({
      ...objectItem,
      photo_url: cleanedSet.has(String(objectItem?.photo_url || '').trim()) ? null : objectItem?.photo_url,
    }));
  }
  return nextRow;
}

async function canCurrentUserViewAllOrders() {
  try {
    const { data: userRes, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    const uid = String(userRes?.user?.id || '').trim();
    if (!uid) return false;

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, company_id')
      .eq('id', uid)
      .maybeSingle();
    if (profileError) throw profileError;

    const role = String(profile?.role || '').trim();
    const companyId = String(profile?.company_id || '').trim();
    if (!role || !companyId) return false;

    const { data: permissionRow, error: permissionError } = await supabase
      .from('app_role_permissions')
      .select('value')
      .eq('company_id', companyId)
      .eq('role', role)
      .eq('key', 'canViewAllOrders')
      .maybeSingle();
    if (permissionError) throw permissionError;

    if (permissionRow?.value === null || permissionRow?.value === undefined) {
      return ['admin', 'dispatcher'].includes(role.toLowerCase());
    }

    if (typeof permissionRow.value === 'boolean') return permissionRow.value;
    if (typeof permissionRow.value === 'number') return permissionRow.value === 1;
    if (typeof permissionRow.value === 'string') {
      return ['1', 'true', 't', 'yes', 'y'].includes(permissionRow.value.trim().toLowerCase());
    }

    return false;
  } catch {
    return false;
  }
}

export async function listClients({ companyId = null, search = '' }: any = {}) {
  return measureNetwork('clients.list', async () => {
    const scopedCompanyId = await resolveScopedCompanyId(companyId);
    if (!scopedCompanyId) return [];

    const buildListQuery = (useAdditional = true) => {
      const clientColumns = useAdditional ? CLIENT_COLUMNS_WITH_ADDITIONAL : CLIENT_COLUMNS_BASE;
      let query = supabase
      .from('clients')
      .select(`${clientColumns}, ${CLIENT_LIST_OBJECTS_RELATION}, ${CLIENT_TAGS_RELATION}`)
      .eq('company_id', scopedCompanyId)
      .order('full_name', { ascending: true, nullsFirst: false });

      const normalizedSearch = String(search || '').trim();
      if (normalizedSearch) {
        const searchFilters = [
          `full_name.ilike.%${normalizedSearch}%`,
          `first_name.ilike.%${normalizedSearch}%`,
          `last_name.ilike.%${normalizedSearch}%`,
          `middle_name.ilike.%${normalizedSearch}%`,
          `email.ilike.%${normalizedSearch}%`,
          `phone.ilike.%${normalizedSearch}%`,
        ];
        if (useAdditional) {
          searchFilters.push(
            `additional_phone_1.ilike.%${normalizedSearch}%`,
            `additional_phone_2.ilike.%${normalizedSearch}%`,
            `additional_phone_3.ilike.%${normalizedSearch}%`,
          );
        }
        query = query.or(searchFilters.join(','));
      }

      return query;
    };

    let { data, error }: any = await buildListQuery(true);
    if (error && shouldFallbackWithoutAdditionalFields(error)) {
      const fallbackResult: any = await buildListQuery(false);
      data = fallbackResult.data;
      error = fallbackResult.error;
    }
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const urls = rows.flatMap((row) => [
      String(row?.avatar_url || '').trim(),
      ...(Array.isArray(row?.client_objects)
        ? row.client_objects.map((objectItem: any) => String(objectItem?.photo_url || '').trim())
        : []),
    ]).filter(Boolean);
    const { cleanedUrls, resolvedUrls } = await inspectProfileMedia(urls);
    const cleanedSet = new Set<string>(cleanedUrls);
    return rows.map((row) =>
      normalizeClient({
        ...applyClientMediaCleanup(row, cleanedSet),
        avatar_display_url: resolvedUrls[String(row?.avatar_url || '').trim()] || row?.avatar_url || null,
        client_objects: Array.isArray(row?.client_objects)
          ? row.client_objects.map((objectItem: any) => ({
              ...objectItem,
              photo_display_url:
                resolvedUrls[String(objectItem?.photo_url || '').trim()] || objectItem?.photo_url || null,
            }))
          : row?.client_objects,
      }),
    );
  });
}

export async function getClientById(clientId: string) {
  const key = String(clientId || '').trim();
  if (!key) return null;

  const existing = clientByIdInFlight.get(key);
  if (existing) return existing;

  const p = measureNetwork('clients.getById', async () => {
    const scopedCompanyId = await resolveScopedCompanyId();
    if (!scopedCompanyId) return null;

    try {
      const { data, error }: any = await supabase
        .from('clients')
        .select(`${CLIENT_COLUMNS_WITH_ADDITIONAL}, client_objects(*, object_tag_links(tag:company_tags(id, value, tag_type))), ${CLIENT_TAGS_RELATION}`)
        .eq('id', key)
        .eq('company_id', scopedCompanyId)
        .maybeSingle();

      if (error) throw error;
      const { cleanedUrls, resolvedUrls } = await inspectProfileMedia([
          String(data?.avatar_url || '').trim(),
          ...(Array.isArray(data?.client_objects)
            ? data.client_objects.map((objectItem: any) => String(objectItem?.photo_url || '').trim())
            : []),
        ].filter(Boolean));
      const cleanedSet = new Set<string>(cleanedUrls);
      return normalizeClient({
        ...applyClientMediaCleanup(data, cleanedSet),
        avatar_display_url: resolvedUrls[String(data?.avatar_url || '').trim()] || data?.avatar_url || null,
        client_objects: Array.isArray(data?.client_objects)
          ? data.client_objects.map((objectItem: any) => ({
              ...objectItem,
              photo_display_url:
                resolvedUrls[String(objectItem?.photo_url || '').trim()] || objectItem?.photo_url || null,
            }))
          : data?.client_objects,
      });
    } catch (firstFailure: any) {
      if (!shouldFallbackWithoutAdditionalFields(firstFailure)) {
        throw firstFailure;
      }
      const { data, error }: any = await supabase
        .from('clients')
        .select(CLIENT_COLUMNS_BASE)
        .eq('id', key)
        .eq('company_id', scopedCompanyId)
        .maybeSingle();

      if (error) throw error;
      const { cleanedUrls, resolvedUrls } = await inspectProfileMedia(
        [String(data?.avatar_url || '').trim()].filter(Boolean),
      );
      const cleanedSet = new Set<string>(cleanedUrls);
      return normalizeClient({
        ...applyClientMediaCleanup(data, cleanedSet),
        avatar_display_url: resolvedUrls[String(data?.avatar_url || '').trim()] || data?.avatar_url || null,
      });
    }
  }).finally(() => {
    clientByIdInFlight.delete(key);
  });

  clientByIdInFlight.set(key, p);
  return p;
}

export async function createClient(payload: Record<string, any>) {
  return measureNetwork('clients.create', async () => {
    const insertPayload: Record<string, any> = { ...payload };
    if (!insertPayload.company_id) {
      insertPayload.company_id = await getMyCompanyId();
    }
    if (!insertPayload.company_id) {
      throw new Error('company_id is required');
    }
    const { data, error } = await supabase
      .from('clients')
      .insert(insertPayload)
      .select('id')
      .single();

    if (error) throw error;
    return getClientById(data.id);
  });
}

function normalizeConflictClientRow(row: any) {
  if (!row || typeof row !== 'object') return null;
  const firstName = String(row.first_name || '').trim();
  const lastName = String(row.last_name || '').trim();
  const middleName = String(row.middle_name || '').trim();
  const fullName =
    [firstName, middleName, lastName].filter(Boolean).join(' ').trim() ||
    String(row.full_name || '').trim();

  return {
    id: String(row.id || ''),
    firstName,
    lastName,
    middleName: middleName || null,
    fullName: fullName || '',
    phone: String(row.phone || '').trim() || null,
  };
}

export async function findClientByPrimaryPhone(
  phone: string,
  { excludeClientId = null }: { excludeClientId?: string | null } = {},
) {
  return measureNetwork('clients.findByPrimaryPhone', async () => {
    const normalizedPhone = normalizeOptionalMobilePhone(phone);
    if (!normalizedPhone) return null;

    const { data, error } = await supabase.rpc('find_client_by_primary_phone', {
      p_phone: normalizedPhone,
      p_exclude_client_id: excludeClientId || null,
    });

    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return normalizeConflictClientRow(row);
  });
}

export function extractConflictingClientId(error: any) {
  const candidates = [
    String(error?.details || ''),
    String(error?.hint || ''),
    String(error?.message || ''),
  ];
  for (const candidate of candidates) {
    const match = candidate.match(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
    );
    if (match?.[0]) return String(match[0]);
  }
  return null;
}

export async function updateClient(clientId: string, patch: Record<string, any>) {
  return measureNetwork('clients.update', async () => {
    const scopedCompanyId = await resolveScopedCompanyId();
    if (!scopedCompanyId) throw new Error('company_id is required');

    const nextPatch: Record<string, any> = { ...(patch || {}) };
    if (Object.prototype.hasOwnProperty.call(nextPatch, 'secondary_phone')) {
      nextPatch.additional_phone_1 = nextPatch.secondary_phone;
      delete nextPatch.secondary_phone;
    }

    const { error } = await supabase
      .from('clients')
      .update(nextPatch)
      .eq('id', clientId)
      .eq('company_id', scopedCompanyId);

    if (error) throw error;
    return getClientById(clientId);
  });
}

export async function deleteClient(clientId: string) {
  return measureNetwork('clients.delete', async () => {
    const scopedCompanyId = await resolveScopedCompanyId();
    if (!scopedCompanyId) throw new Error('company_id is required');
    const { error } = await supabase
      .from('clients')
      .delete()
      .eq('id', clientId)
      .eq('company_id', scopedCompanyId);
    if (error) throw error;
    return true;
  });
}

export async function getClientOrderCount(clientId: string) {
  return measureNetwork('clients.orderCount', async () => {
    if (!clientId) return 0;
    const scopedCompanyId = await resolveScopedCompanyId();
    if (!scopedCompanyId) return 0;

    const { count, error } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('company_id', scopedCompanyId);

    if (error) throw error;
    return Number(count || 0);
  });
}

export async function getClientDeleteBlockers(clientId: string) {
  return measureNetwork('clients.deleteBlockers', async () => {
    const normalizedClientId = String(clientId || '').trim();
    if (!normalizedClientId) {
      return {
        clientId: '',
        blockingOrdersCount: 0,
        blockingObjectsCount: 0,
        blockingObjectIds: [],
        myOrdersCount: 0,
        feedOrdersCount: 0,
        otherOrdersCount: 0,
        isPartial: false,
      };
    }

    try {
      const { data, error } = await supabase.rpc('get_client_delete_blockers', {
        p_client_id: normalizedClientId,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return {
        clientId: normalizedClientId,
        blockingOrdersCount: Number(row?.blocking_orders_count || 0),
        blockingObjectsCount: Number(row?.blocking_objects_count || 0),
        blockingObjectIds: Array.isArray(row?.blocking_object_ids)
          ? row.blocking_object_ids.map((value: any) => String(value || '')).filter(Boolean)
          : [],
        myOrdersCount: Number(row?.my_orders_count || 0),
        feedOrdersCount: Number(row?.feed_orders_count || 0),
        otherOrdersCount: Number(row?.other_orders_count || 0),
        isPartial: false,
      };
    } catch (_rpcError: any) {
      // Fall back to a client-side visible slice if the RPC is unavailable or fails at runtime.
      // The delete flow should degrade to a partial check instead of breaking the modal.
    }

    const { data: objectRows, error: objectsError } = await supabase
      .from('client_objects')
      .select('id')
      .eq('client_id', normalizedClientId);
    if (objectsError) throw objectsError;

    const objectIds = Array.isArray(objectRows)
      ? objectRows.map((row: any) => String(row?.id || '')).filter(Boolean)
      : [];

    const { data: userData } = await supabase.auth.getUser();
    const currentUserId = String(userData?.user?.id || '');
    const canViewAllOrders = await canCurrentUserViewAllOrders();

    let query = supabase.from('orders_secure_v2').select('id, assigned_to, object_id, client_id');
    query = applyOrderRelationFilters(query, {
      clientId: normalizedClientId,
      objectIds,
    });

    const { data: rows, error } = await query.limit(500);
    if (error) throw error;

    const list = Array.isArray(rows) ? rows : [];
    const blockingObjectIds = Array.from(
      new Set(
        list
          .map((row: any) => String(row?.object_id || ''))
          .filter((value) => value && objectIds.includes(value)),
      ),
    );

    return {
      clientId: normalizedClientId,
      blockingOrdersCount: list.length,
      blockingObjectsCount: blockingObjectIds.length,
      blockingObjectIds,
      myOrdersCount: list.filter((row: any) => String(row?.assigned_to || '') === currentUserId).length,
      feedOrdersCount: list.filter((row: any) => !row?.assigned_to).length,
      otherOrdersCount: list.filter(
        (row: any) => row?.assigned_to && String(row.assigned_to) !== currentUserId,
      ).length,
      isPartial: !canViewAllOrders,
    };
  });
}

export async function getClientByOrderId(orderId: string) {
  return measureNetwork('clients.byOrder', async () => {
    if (!orderId) return null;

    const { data: orderRow, error: orderError } = await supabase
      .from('orders')
      .select('client_id')
      .eq('id', orderId)
      .maybeSingle();

    if (orderError) throw orderError;
    const clientId = orderRow?.client_id;
    if (!clientId) return null;

    return getClientById(String(clientId));
  });
}
