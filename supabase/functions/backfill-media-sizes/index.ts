import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { headBegetObject, listBegetObjectsWithSize } from '../_shared/beget-s3.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const json = (status: number, body: Record<string, Json>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/**
 * Backfills file_size_bytes for all external media map entries where size is 0.
 * Uses HEAD requests to S3 to get actual file sizes.
 * 
 * Requires service_role or admin auth.
 */
export async function handleBackfillMediaSizesRequest(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { success: false, message: 'POST only' });

  try {
    const supabaseUrl = String(Deno.env.get('SUPABASE_URL') || '').trim();
    const serviceRole =
      String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim() ||
      String(Deno.env.get('SERVICE_ROLE_KEY') || '').trim();
    if (!supabaseUrl || !serviceRole) throw new Error('Missing Supabase env');

    const admin = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Verify caller is service_role or admin
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (token && token !== serviceRole) {
      const { data: { user }, error: authErr } = await admin.auth.getUser(token);
      if (authErr || !user) return json(401, { success: false, message: 'Unauthorized' });
      const { data: profile } = await admin
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      if (String(profile?.role || '').toLowerCase() !== 'admin') {
        return json(403, { success: false, message: 'Admin access required' });
      }
    }

    const stats = { order_media: 0, profile_media: 0, finance_media: 0, errors: 0 };

    // 1) order_media_external_map
    {
      const { data: rows, error } = await admin
        .from('order_media_external_map')
        .select('id, external_path')
        .eq('file_size_bytes', 0)
        .limit(5000);
      if (error) throw error;
      for (const row of rows || []) {
        try {
          const path = String(row.external_path || '').trim();
          if (!path) continue;
          const head = await headBegetObject(path);
          const size = Number(head?.ContentLength || 0);
          if (size > 0) {
            await admin
              .from('order_media_external_map')
              .update({ file_size_bytes: size })
              .eq('id', row.id);
            stats.order_media++;
          }
        } catch {
          stats.errors++;
        }
      }
    }

    // 2) profile_media_external_map
    {
      const { data: rows, error } = await admin
        .from('profile_media_external_map')
        .select('id, external_path, provider')
        .eq('file_size_bytes', 0)
        .limit(5000);
      if (error) throw error;
      for (const row of rows || []) {
        try {
          const path = String(row.external_path || '').trim();
          if (!path) continue;
          if (row.provider !== 'beget_s3') continue; // Skip Yandex — no HEAD API
          const head = await headBegetObject(path);
          const size = Number(head?.ContentLength || 0);
          if (size > 0) {
            await admin
              .from('profile_media_external_map')
              .update({ file_size_bytes: size })
              .eq('id', row.id);
            stats.profile_media++;
          }
        } catch {
          stats.errors++;
        }
      }
    }

    // 3) finance_entry_media_external_map
    {
      const { data: rows, error } = await admin
        .from('finance_entry_media_external_map')
        .select('id, external_path')
        .eq('file_size_bytes', 0)
        .limit(5000);
      if (error) throw error;
      for (const row of rows || []) {
        try {
          const path = String(row.external_path || '').trim();
          if (!path) continue;
          const head = await headBegetObject(path);
          const size = Number(head?.ContentLength || 0);
          if (size > 0) {
            await admin
              .from('finance_entry_media_external_map')
              .update({ file_size_bytes: size })
              .eq('id', row.id);
            stats.finance_media++;
          }
        } catch {
          stats.errors++;
        }
      }
    }

    // Invalidate storage cache so next read recomputes
    await admin.from('company_storage_usage_cache').delete().neq('company_id', '00000000-0000-0000-0000-000000000000');

    return json(200, {
      success: true,
      message: 'Backfill complete',
      updated: stats as unknown as Json,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json(500, { success: false, message });
  }
}

if (import.meta.main) {
  Deno.serve(handleBackfillMediaSizesRequest);
}
