import { supabase } from '../../../lib/supabase';
import { measureNetwork } from '../../shared/perf/devMetrics';
import {
  buildClientObjectAddressSummary,
  normalizeClientObject,
} from '../objects/addressing';
import { inspectProfileMedia } from '../profileMedia/api';

const clientByIdInFlight = new Map<string, Promise<any>>();

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
    String(row.full_name || '').trim() ||
    [lastName, firstName, middleName].filter(Boolean).join(' ').trim();

  const objects = Array.isArray(row.client_objects)
    ? row.client_objects.map(normalizeClientObject).filter(Boolean)
    : [];
  const primaryObject =
    objects.find((objectItem) => objectItem?.is_primary) || objects[0] || null;

  return {
    ...row,
    firstName,
    lastName,
    middleName: middleName || null,
    fullName: fullName || '',
    secondaryPhone: row.secondary_phone || null,
    contactPref: row.contact_pref || null,
    avatarUrl: row.avatar_url || null,
    avatarDisplayUrl: row.avatar_display_url || row.avatar_url || null,
    objects,
    primaryObject,
    primaryObjectSummary: buildClientObjectAddressSummary(primaryObject) || null,
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

export async function listClients({ companyId = null, search = '' } = {}) {
  return measureNetwork('clients.list', async () => {
    let query = supabase
      .from('clients')
      .select('id, company_id, first_name, last_name, middle_name, full_name, email, phone, secondary_phone, contact_pref, avatar_url, created_at, updated_at, client_objects(id, client_id, company_id, name, is_primary, summary, country, region, city, street, house)')
      .order('full_name', { ascending: true, nullsFirst: false });

    if (companyId) {
      query = query.eq('company_id', companyId);
    }

    const normalizedSearch = String(search || '').trim();
    if (normalizedSearch) {
      query = query.or(
        [
          `full_name.ilike.%${normalizedSearch}%`,
          `first_name.ilike.%${normalizedSearch}%`,
          `last_name.ilike.%${normalizedSearch}%`,
          `middle_name.ilike.%${normalizedSearch}%`,
          `email.ilike.%${normalizedSearch}%`,
          `phone.ilike.%${normalizedSearch}%`,
          `secondary_phone.ilike.%${normalizedSearch}%`,
        ].join(','),
      );
    }

    const { data, error } = await query;
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const urls = rows.flatMap((row) => [
      String(row?.avatar_url || '').trim(),
      ...(Array.isArray(row?.client_objects)
        ? row.client_objects.map((objectItem: any) => String(objectItem?.photo_url || '').trim())
        : []),
    ]).filter(Boolean);
    const { cleanedUrls, resolvedUrls } = await inspectProfileMedia(urls);
    const cleanedSet = new Set(cleanedUrls);
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
    try {
      const { data, error } = await supabase
        .from('clients')
        .select('id, company_id, first_name, last_name, middle_name, full_name, email, phone, secondary_phone, contact_pref, avatar_url, created_at, updated_at, client_objects(*)')
        .eq('id', key)
        .maybeSingle();

      if (error) throw error;
      const { cleanedUrls, resolvedUrls } = await inspectProfileMedia([
          String(data?.avatar_url || '').trim(),
          ...(Array.isArray(data?.client_objects)
            ? data.client_objects.map((objectItem: any) => String(objectItem?.photo_url || '').trim())
            : []),
        ].filter(Boolean));
      const cleanedSet = new Set(cleanedUrls);
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
    } catch {
      const { data, error } = await supabase
        .from('clients')
        .select('id, company_id, first_name, last_name, middle_name, full_name, email, phone, secondary_phone, contact_pref, avatar_url, created_at, updated_at')
        .eq('id', key)
        .maybeSingle();

      if (error) throw error;
      const { cleanedUrls, resolvedUrls } = await inspectProfileMedia(
        [String(data?.avatar_url || '').trim()].filter(Boolean),
      );
      const cleanedSet = new Set(cleanedUrls);
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
    const { data, error } = await supabase
      .from('clients')
      .insert(payload)
      .select('id')
      .single();

    if (error) throw error;
    return getClientById(data.id);
  });
}

export async function updateClient(clientId: string, patch: Record<string, any>) {
  return measureNetwork('clients.update', async () => {
    const { error } = await supabase
      .from('clients')
      .update(patch)
      .eq('id', clientId);

    if (error) throw error;
    return getClientById(clientId);
  });
}

export async function deleteClient(clientId: string) {
  return measureNetwork('clients.delete', async () => {
    const { error } = await supabase.from('clients').delete().eq('id', clientId);
    if (error) throw error;
    return true;
  });
}

export async function getClientOrderCount(clientId: string) {
  return measureNetwork('clients.orderCount', async () => {
    if (!clientId) return 0;

    const { count, error } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId);

    if (error) throw error;
    return Number(count || 0);
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
