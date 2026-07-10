import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import postgres from 'npm:postgres@3.4.5';
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function handleAdminDeleteCompanyRequest(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: cors });

  try {
    const SUPABASE_URL =
      Deno.env.get('SUPABASE_URL') ||
      Deno.env.get('PROJECT_URL') ||
      Deno.env.get('SUPABASE_PUBLIC_URL') ||
      Deno.env.get('API_EXTERNAL_URL') ||
      Deno.env.get('KONG_URL') ||
      'http://supabase-kong:8000';
    const SERVICE_KEY =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';
    const DB_URL = Deno.env.get('SUPABASE_DB_URL') || '';

    if (!SUPABASE_URL || !SERVICE_KEY || !DB_URL) {
      return new Response(JSON.stringify({ success: false, message: 'Server misconfigured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }

    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization') || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) {
      return new Response(JSON.stringify({ success: false, message: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: callerData, error: callerErr } = await admin.auth.getUser(jwt);
    if (callerErr || !callerData?.user?.id) {
      return new Response(JSON.stringify({ success: false, message: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }
    const callerUserId = callerData.user.id;

    const { data: isSuperAdminRaw, error: isSuperAdminErr } = await admin.rpc('is_super_admin');
    if (isSuperAdminErr) {
      return new Response(JSON.stringify({ success: false, message: 'Super-admin check failed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }
    const isSuperAdmin = isSuperAdminRaw === true;
    if (!isSuperAdmin) {
      return new Response(JSON.stringify({ success: false, message: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }

    const body = await req.json().catch(() => ({}));
    const companyId = text(body?.company_id);
    const confirmed = body?.confirm === true;

    if (!isUuid(companyId)) {
      return new Response(JSON.stringify({ success: false, message: 'Invalid company_id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }
    if (!confirmed) {
      return new Response(JSON.stringify({ success: false, message: 'Confirmation required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }

    const sql = postgres(DB_URL, { max: 1, prepare: false });
    try {
      const result = await sql.begin(async (tx) => {
        await tx`create temp table _target_company(id uuid primary key) on commit drop`;
        await tx`insert into _target_company(id) values (${companyId}::uuid)`;

        const companyExists = await tx`select id from public.companies where id = ${companyId}::uuid limit 1`;
        if (!companyExists.length) {
          throw new Error('Company not found');
        }

        // The status guard keeps the Feed status immutable during normal operation.
        // Allow its removal only inside this verified, all-or-nothing company deletion.
        await tx`select set_config('app.company_deletion_in_progress', '1', true)`;

        await tx`create temp table _target_users(id uuid primary key) on commit drop`;
        await tx`
          insert into _target_users(id)
          select p.id
          from public.profiles p
          join _target_company c on c.id = p.company_id
          where p.id is not null
          on conflict do nothing
        `;
        await tx`
          insert into _target_users(id)
          select c.owner_id
          from public.companies c
          join _target_company tc on tc.id = c.id
          where c.owner_id is not null
          on conflict do nothing
        `;
        await tx`
          insert into _target_users(id)
          select au.id
          from auth.users au
          join _target_company tc
            on (
              (au.raw_user_meta_data->>'company_id') ~* '^[0-9a-f-]{36}$'
              and (au.raw_user_meta_data->>'company_id')::uuid = tc.id
            )
            or (
              (au.raw_app_meta_data->>'company_id') ~* '^[0-9a-f-]{36}$'
              and (au.raw_app_meta_data->>'company_id')::uuid = tc.id
            )
          where au.id is not null
          on conflict do nothing
        `;

        await tx`create temp table _target_emails(email text primary key) on commit drop`;
        await tx`
          insert into _target_emails(email)
          select distinct lower(trim(p.email))
          from public.profiles p
          join _target_users u on u.id = p.id
          where nullif(trim(p.email), '') is not null
          on conflict do nothing
        `;
        await tx`
          insert into _target_emails(email)
          select distinct lower(trim(au.email))
          from auth.users au
          join _target_users u on u.id = au.id
          where nullif(trim(au.email), '') is not null
          on conflict do nothing
        `;

        const usersBefore = await tx`select count(*)::int as count from _target_users`;

        // Delete order media maps while their orders still exist. Their cleanup triggers
        // write media_cleanup_queue.order_id, which is FK-protected by orders.
        await tx`
          do $do$
          declare v_company_id uuid := (select id from _target_company limit 1);
          begin
            if to_regclass('public.finance_entry_media_external_map') is not null then
              delete from public.finance_entry_media_external_map
              where company_id = v_company_id;
            end if;

            if to_regclass('public.order_media_external_map') is not null then
              delete from public.order_media_external_map
              where company_id = v_company_id;
            end if;
          end
          $do$
        `;

        // Orders reference client objects and users. Remove them after order media maps,
        // but before the generic company/user cleanup loops.
        await tx`delete from public.orders where company_id = ${companyId}::uuid`;

        // Avoid FK breakage in feedback-attachment cleanup triggers by removing map rows first.
        await tx`
          delete from public.profile_media_external_map
          where company_id = ${companyId}::uuid
            and entity_type in ('feedback_attachment', 'feedback')
        `;

        await tx`
          do $do$
          declare r record;
          declare v_company_id uuid := (select id from _target_company limit 1);
          begin
            for r in
              select c.table_schema, c.table_name
              from information_schema.columns c
              join information_schema.tables t
                on t.table_schema = c.table_schema
               and t.table_name = c.table_name
              where c.table_schema = 'public'
                and c.column_name = 'company_id'
                and t.table_type = 'BASE TABLE'
              group by c.table_schema, c.table_name
            loop
              begin
                execute format('delete from %I.%I where company_id = $1', r.table_schema, r.table_name)
                using v_company_id;
              exception
                when insufficient_privilege then
                  raise notice 'skip table %.%: insufficient_privilege', r.table_schema, r.table_name;
              end;
            end loop;
          end
          $do$
        `;

        await tx`
          do $do$
          declare r record;
          begin
            for r in
              select c.table_schema, c.table_name, c.column_name
              from information_schema.columns c
              join information_schema.tables t
                on t.table_schema = c.table_schema
               and t.table_name = c.table_name
              where c.table_schema = 'public'
                and c.column_name in (
                  'user_id',
                  'owner_id',
                  'created_by',
                  'created_by_user_id',
                  'assigned_to',
                  'destination_user_id',
                  'recipient_user_id',
                  'actor_user_id',
                  'profile_id',
                  'employee_id',
                  'manager_id',
                  'author_id',
                  'requested_by',
                  'changed_by'
                )
                and t.table_type = 'BASE TABLE'
            loop
              begin
                execute format(
                  'delete from %I.%I where %I in (select id from _target_users)',
                  r.table_schema, r.table_name, r.column_name
                );
              exception
                when insufficient_privilege then
                  raise notice 'skip table %.% (%): insufficient_privilege', r.table_schema, r.table_name, r.column_name;
              end;
            end loop;
          end
          $do$
        `;

        await tx`
          do $do$
          declare r record;
          begin
            for r in
              select c.table_schema, c.table_name, c.column_name
              from information_schema.columns c
              join information_schema.tables t
                on t.table_schema = c.table_schema
               and t.table_name = c.table_name
              where c.table_schema = 'auth'
                and c.column_name = 'user_id'
                and c.udt_name = 'uuid'
                and t.table_type = 'BASE TABLE'
            loop
              begin
                execute format(
                  'delete from %I.%I where %I in (select id from _target_users)',
                  r.table_schema, r.table_name, r.column_name
                );
              exception
                when insufficient_privilege then
                  raise notice 'skip table %.% (%): insufficient_privilege', r.table_schema, r.table_name, r.column_name;
              end;
            end loop;
          end
          $do$
        `;

        await tx`
          do $do$
          begin
            delete from auth.refresh_tokens where user_id in (select id::text from _target_users);

            if to_regclass('public.registration_email_codes') is not null then
              delete from public.registration_email_codes
              where lower(trim(email)) in (select email from _target_emails);
            end if;

            if to_regclass('public.registration_email_proofs') is not null then
              delete from public.registration_email_proofs
              where lower(trim(email)) in (select email from _target_emails);
            end if;
          end
          $do$
        `;
        await tx`delete from public.profiles where id in (select id from _target_users)`;
        await tx`
          delete from storage.objects
          where owner in (select id from _target_users)
             or owner_id in (select id::text from _target_users)
        `;
        await tx`delete from auth.users where id in (select id from _target_users)`;
        await tx`delete from public.companies where id in (select id from _target_company)`;

        const usersAfter = await tx`
          select count(*)::int as count
          from auth.users
          where id in (select id from _target_users)
        `;
        const companyAfter = await tx`
          select count(*)::int as count
          from public.companies
          where id = ${companyId}::uuid
        `;
        await tx`
          do $do$
          begin
            create temp table _company_delete_leftovers(kind text, rows_left bigint) on commit drop;
          exception when duplicate_table then
            truncate table _company_delete_leftovers;
          end
          $do$
        `;
        await tx`
          do $do$
          declare r record;
          declare v_company_id uuid := (select id from _target_company limit 1);
          declare v_count bigint;
          begin
            for r in
              select c.table_schema, c.table_name
              from information_schema.columns c
              join information_schema.tables t
                on t.table_schema = c.table_schema
               and t.table_name = c.table_name
              where c.table_schema = 'public'
                and c.column_name = 'company_id'
                and t.table_type = 'BASE TABLE'
              group by c.table_schema, c.table_name
            loop
              execute format('select count(*) from %I.%I where company_id = $1', r.table_schema, r.table_name)
              into v_count
              using v_company_id;
              if v_count > 0 then
                insert into _company_delete_leftovers(kind, rows_left)
                values (format('%I.%I.company_id', r.table_schema, r.table_name), v_count);
              end if;
            end loop;
          end
          $do$
        `;
        const companyRowsAfter = await tx`
          select coalesce(sum(rows_left), 0)::int as count
          from _company_delete_leftovers
        `;
        const storageAfter = await tx`
          select count(*)::int as count
          from storage.objects
          where owner in (select id from _target_users)
             or owner_id in (select id::text from _target_users)
        `;
        const authRefreshTokensAfter = await tx`
          select count(*)::int as count
          from auth.refresh_tokens
          where user_id in (select id::text from _target_users)
        `;
        const leftovers = {
          users_left: Number(usersAfter[0]?.count || 0),
          companies_left: Number(companyAfter[0]?.count || 0),
          company_rows_left: Number(companyRowsAfter[0]?.count || 0),
          storage_objects_left: Number(storageAfter[0]?.count || 0),
          auth_refresh_tokens_left: Number(authRefreshTokensAfter[0]?.count || 0),
        };

        if (Object.values(leftovers).some((count) => count > 0)) {
          throw new Error(`Company delete incomplete: ${JSON.stringify(leftovers)}`);
        }

        return {
          deleted_users_estimate: Number(usersBefore[0]?.count || 0),
          ...leftovers,
        };
      });

      return new Response(JSON.stringify({ success: true, ...result }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  } catch (e) {
    console.error('admin-delete-company error', e);
    return new Response(
      JSON.stringify({
        success: false,
        message: e instanceof Error ? e.message : String(e),
      }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }
}

if (import.meta.main) {
  Deno.serve(handleAdminDeleteCompanyRequest);
}
