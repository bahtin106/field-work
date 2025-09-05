// supabase/functions/create_user/index.ts
// POST { email, password, role, full_name } -> { user_id }
// Создаёт пользователя в Auth, проставляет роль и имя в profiles.
// Доступно только администратору (проверка по таблице profiles).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: cors });
  }

  try {
    const SUPABASE_URL = Deno.env.get("PROJECT_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1) Проверяем, что вызывает авторизованный пользователь
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return new Response("Unauthorized", { status: 401, headers: cors });

    // Клент с сервисным ключом, но пробрасываем JWT вызывающего для auth.getUser()
    const supabaseForCaller = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    const { data: caller, error: callerErr } = await supabaseForCaller.auth.getUser();
    if (callerErr || !caller?.user) {
      return new Response("Unauthorized", { status: 401, headers: cors });
    }

    // 2) Достаём роль вызывающего из profiles и проверяем admin
    const { data: prof, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", caller.user.id)
      .single();

    if (profErr || !prof || prof.role !== "admin") {
      return new Response("Forbidden", { status: 403, headers: cors });
    }

    // 3) Парсим вход
    const body = await req.json().catch(() => ({}));
    const { email, password, role, full_name } = body || {};

    if (!email || !password || !role) {
      return new Response("email, password, role are required", { status: 400, headers: cors });
    }
    if (!["admin", "dispatcher", "worker"].includes(role)) {
      return new Response("invalid role", { status: 400, headers: cors });
    }
    if (String(password).length < 8) {
      return new Response("password must be at least 8 chars", { status: 400, headers: cors });
    }

    // 4) Создаём пользователя в Auth (email подтверждаем сразу)
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    });
    if (createErr || !created?.user) {
      return new Response(`Auth create error: ${createErr?.message ?? "unknown"}`, {
        status: 400,
        headers: cors,
      });
    }

    const userId = created.user.id;

    // 5) Записываем профиль с ролью и именем
    const { error: upsertErr } = await supabaseAdmin
      .from("profiles")
      .upsert({ id: userId, role, full_name }, { onConflict: "id" });

    if (upsertErr) {
      // откат, чтобы не оставлять "голого" юзера без профиля
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return new Response(`Profile upsert error: ${upsertErr.message}`, { status: 400, headers: cors });
    }

    return new Response(JSON.stringify({ user_id: userId }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...cors },
    });
  } catch (e) {
    return new Response(`Internal error: ${e instanceof Error ? e.message : String(e)}`, {
      status: 500,
      headers: cors,
    });
  }
});
