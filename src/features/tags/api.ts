import { supabase } from '../../../lib/supabase';
import { measureNetwork } from '../../shared/perf/devMetrics';
import { TAG_SUGGESTIONS_LIMIT } from '../../../components/tags/tagConfig';
import {
  assertMutationAuthCarrier,
  assertMutationPayloadCompany,
  pinMutationAuthorization,
  type MutationAuthCarrier,
} from '../../shared/security/mutationAuthCarrier';

export type TagType = 'client' | 'object';

export type CompanyTag = {
  id: string;
  value: string;
  tag_type: TagType;
  company_id: string;
  usageCount?: number;
};

export async function searchCompanyTags({
  tagType,
  query = '',
  limit = TAG_SUGGESTIONS_LIMIT,
}: {
  tagType: TagType;
  query?: string;
  limit?: number;
}, signal?: AbortSignal): Promise<CompanyTag[]> {
  return measureNetwork('tags.search', async () => {
    const safeQuery = String(query || '').slice(0, 64);
    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Number(limit), 1), 30) : TAG_SUGGESTIONS_LIMIT;

    let request = supabase.rpc('search_company_tags', {
      p_tag_type: tagType,
      p_query: safeQuery,
      p_limit: safeLimit,
    });
    if (signal) request = request.abortSignal(signal);
    const { data, error } = await request;

    if (error) throw error;

    return (Array.isArray(data) ? data : []).map((row: any) => ({
      id: String(row?.id || ''),
      value: String(row?.value || ''),
      tag_type: tagType,
      company_id: '',
      usageCount: Number(row?.usage_count || 0),
    }));
  });
}

export async function listCompanyTags({
  companyId,
  tagType,
}: {
  companyId: string;
  tagType: TagType;
}, signal?: AbortSignal): Promise<CompanyTag[]> {
  return measureNetwork('tags.list', async () => {
    if (!companyId) return [];

    let query = supabase
      .from('company_tags')
      .select('id, company_id, tag_type, value, normalized_value')
      .eq('company_id', companyId)
      .eq('tag_type', tagType)
      .order('value', { ascending: true });
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;

    if (error) throw error;

    return (Array.isArray(data) ? data : []).map((row: any) => ({
      id: String(row?.id || ''),
      value: String(row?.value || ''),
      tag_type: row?.tag_type,
      company_id: String(row?.company_id || ''),
    }));
  });
}

export async function setClientTags(
  clientId: string,
  tags: string[],
  authCarrier: MutationAuthCarrier,
) {
  assertMutationAuthCarrier(authCarrier);
  return measureNetwork('tags.setClient', async () => {
    const request = pinMutationAuthorization(
      supabase.rpc('set_client_tags', {
        p_client_id: clientId,
        p_tags: Array.isArray(tags) ? tags : [],
      }),
      authCarrier,
    );
    const { error } = await request;
    assertMutationAuthCarrier(authCarrier);
    if (error) throw error;
    return true;
  });
}

export async function setObjectTags(
  objectId: string,
  tags: string[],
  authCarrier: MutationAuthCarrier,
) {
  assertMutationAuthCarrier(authCarrier);
  return measureNetwork('tags.setObject', async () => {
    const request = pinMutationAuthorization(
      supabase.rpc('set_object_tags', {
        p_object_id: objectId,
        p_tags: Array.isArray(tags) ? tags : [],
      }),
      authCarrier,
    );
    const { error } = await request;
    assertMutationAuthCarrier(authCarrier);
    if (error) throw error;
    return true;
  });
}

export async function createCompanyTag({
  companyId,
  tagType,
  value,
}: {
  companyId: string;
  tagType: TagType;
  value: string;
}, authCarrier: MutationAuthCarrier) {
  assertMutationAuthCarrier(authCarrier);
  const scopedCompanyId = assertMutationPayloadCompany(authCarrier, companyId);
  return measureNetwork('tags.create', async () => {
    const cleanValue = String(value || '').replace(/\s+/g, ' ').trim();
    if (!tagType || !cleanValue) return null;

    const insertRequest = pinMutationAuthorization(
      supabase
        .from('company_tags')
        .insert({
          company_id: scopedCompanyId,
          tag_type: tagType,
          value: cleanValue,
        })
        .select('id, company_id, tag_type, value')
        .maybeSingle(),
      authCarrier,
    );
    const { data, error } = await insertRequest;
    assertMutationAuthCarrier(authCarrier);

    if (!error) return data;

    if (String(error?.code || '') !== '23505') throw error;

    const existingRequest = pinMutationAuthorization(
      supabase
        .from('company_tags')
        .select('id, company_id, tag_type, value')
        .eq('company_id', scopedCompanyId)
        .eq('tag_type', tagType)
        .ilike('value', cleanValue)
        .limit(1)
        .maybeSingle(),
      authCarrier,
    );
    const { data: existing, error: existingError } = await existingRequest;
    assertMutationAuthCarrier(authCarrier);

    if (existingError) throw existingError;
    return existing || null;
  });
}

export async function deleteCompanyTag(tagId: string, authCarrier: MutationAuthCarrier) {
  assertMutationAuthCarrier(authCarrier);
  return measureNetwork('tags.delete', async () => {
    const request = pinMutationAuthorization(
      supabase.from('company_tags').delete().eq('id', tagId),
      authCarrier,
    );
    const { error } = await request;
    assertMutationAuthCarrier(authCarrier);
    if (error) throw error;
    return true;
  });
}

export async function deleteAllCompanyTags({
  companyId,
  tagType,
}: {
  companyId: string;
  tagType: TagType;
}, authCarrier: MutationAuthCarrier) {
  assertMutationAuthCarrier(authCarrier);
  const scopedCompanyId = assertMutationPayloadCompany(authCarrier, companyId);
  return measureNetwork('tags.deleteAll', async () => {
    if (!tagType) return true;
    const request = pinMutationAuthorization(
      supabase
        .from('company_tags')
        .delete()
        .eq('company_id', scopedCompanyId)
        .eq('tag_type', tagType),
      authCarrier,
    );
    const { error } = await request;
    assertMutationAuthCarrier(authCarrier);
    if (error) throw error;
    return true;
  });
}

export async function updateCompanyTagSettings({
  companyId,
  enableClientTags,
  enableObjectTags,
}: {
  companyId: string;
  enableClientTags?: boolean;
  enableObjectTags?: boolean;
}, authCarrier: MutationAuthCarrier) {
  assertMutationAuthCarrier(authCarrier);
  const scopedCompanyId = assertMutationPayloadCompany(authCarrier, companyId);
  return measureNetwork('tags.updateSettings', async () => {
    const patch: Record<string, any> = {};
    if (typeof enableClientTags === 'boolean') patch.enable_client_tags = enableClientTags;
    if (typeof enableObjectTags === 'boolean') patch.enable_object_tags = enableObjectTags;

    if (Object.keys(patch).length === 0) return true;

    const request = pinMutationAuthorization(
      supabase.from('companies').update(patch).eq('id', scopedCompanyId),
      authCarrier,
    );
    const { error } = await request;
    assertMutationAuthCarrier(authCarrier);
    if (error) throw error;
    return true;
  });
}

export function extractTagsFromLinks(links: any[] | null | undefined) {
  if (!Array.isArray(links)) return [];

  const map = new Map<string, string>();

  links.forEach((link) => {
    const tag = link?.tag || link?.company_tags || null;
    const tagId = String(tag?.id || link?.tag_id || '').trim();
    const value = String(tag?.value || '').trim();
    if (!tagId || !value) return;
    if (!map.has(tagId)) map.set(tagId, value);
  });

  return Array.from(map.entries()).map(([id, value]) => ({ id, value }));
}

