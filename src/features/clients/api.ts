import { supabase } from '../../../lib/supabase';
import { measureNetwork } from '../../shared/perf/devMetrics';

const clientByIdInFlight = new Map<string, Promise<any>>();

function normalizeClient(row: any) {
  if (!row) return null;
  const firstName = String(row.first_name || '').trim();
  const lastName = String(row.last_name || '').trim();
  const middleName = String(row.middle_name || '').trim();
  const fullName =
    String(row.full_name || '').trim() ||
    [lastName, firstName, middleName].filter(Boolean).join(' ').trim();

  return {
    ...row,
    firstName,
    lastName,
    middleName: middleName || null,
    fullName: fullName || '',
    avatarUrl: row.avatar_url || null,
    objectAddress: row.object_address || null,
  };
}

export async function listClients({ companyId = null, search = '' } = {}) {
  return measureNetwork('clients.list', async () => {
    let query = supabase
      .from('clients')
      .select('id, company_id, first_name, last_name, middle_name, full_name, email, phone, avatar_url, object_address, created_at, updated_at')
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
          `object_address.ilike.%${normalizedSearch}%`,
        ].join(','),
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    return Array.isArray(data) ? data.map(normalizeClient) : [];
  });
}

export async function getClientById(clientId: string) {
  const key = String(clientId || '').trim();
  if (!key) return null;

  const existing = clientByIdInFlight.get(key);
  if (existing) return existing;

  const p = measureNetwork('clients.getById', async () => {
    const { data, error } = await supabase
      .from('clients')
      .select('id, company_id, first_name, last_name, middle_name, full_name, email, phone, avatar_url, object_address, created_at, updated_at')
      .eq('id', key)
      .maybeSingle();

    if (error) throw error;
    return normalizeClient(data);
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
