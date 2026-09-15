import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  activeAccessRow,
  canInviteUserRole,
  InviteUserValidationError,
  INVITE_USER_ROLE_FORBIDDEN_STATUS,
  isAmbiguousNormalizedProfileEmailError,
  parseInviteUserInput,
} from "./contract.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("PROJECT_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("ANON_KEY") || "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
const EMAIL_SERVICE_URL = String(
  Deno.env.get("EMAIL_SERVICE_URL")
    || Deno.env.get("EXPO_PUBLIC_EMAIL_SERVICE_URL")
    || "",
).replace(/\/+$/, "");
const EMAIL_SERVER_API_TOKEN = String(Deno.env.get("EMAIL_SERVER_API_TOKEN") || "").trim();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "private, no-store",
};

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required");
}
if (!EMAIL_SERVICE_URL) {
  throw new Error("EMAIL_SERVICE_URL is required");
}

function createCallerClient(jwt: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

function createServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function err(message: string, status = 400, code?: string): Response {
  return Response.json(
    { success: false, message, ...(code ? { code } : {}) },
    { status, headers: corsHeaders },
  );
}

function existingAccountError(): Response {
  return err(
    "User with this email already exists. Delete the existing account before inviting again.",
    409,
    "USER_ALREADY_EXISTS",
  );
}

function emailServiceHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(EMAIL_SERVER_API_TOKEN ? { "X-Email-Server-Token": EMAIL_SERVER_API_TOKEN } : {}),
  };
}

function generateTempPassword(): string {
  const groups = [
    "ABCDEFGHJKLMNPQRSTUVWXYZ",
    "abcdefghijkmnopqrstuvwxyz",
    "23456789",
    "!@#$%",
  ];
  const alphabet = groups.join("");
  const randomIndex = (length: number) => {
    const limit = Math.floor(256 / length) * length;
    const byte = new Uint8Array(1);
    do crypto.getRandomValues(byte); while (byte[0] >= limit);
    return byte[0] % length;
  };

  const characters = groups.map((group) => group[randomIndex(group.length)]);
  while (characters.length < 18) characters.push(alphabet[randomIndex(alphabet.length)]);
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  return characters.join("");
}

function isMissingAuthUser(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = Number((error as { status?: unknown }).status || 0);
  const message = String((error as { message?: unknown }).message || "");
  return status === 404 || /user.*not found|not found.*user/i.test(message);
}

async function cleanupOrphanIdentitiesByEmail(serviceClient: ReturnType<typeof createServiceClient>, email: string) {
  const { data, error } = await serviceClient.rpc("cleanup_auth_identity_orphans", {
    p_email: email,
    p_user_id: null,
  });
  if (error) return 0;
  const deleted = Number((data as { deleted?: unknown } | null)?.deleted ?? 0);
  return Number.isFinite(deleted) ? deleted : 0;
}

async function reconcileEmailBeforeInvite(
  serviceClient: ReturnType<typeof createServiceClient>,
  email: string,
): Promise<{ status: "ok" | "exists"; deletedUsers: number }> {
  const { data, error } = await serviceClient.rpc("reconcile_email_before_invite", {
    p_email: email,
  });
  if (error) {
    console.warn("[invite-user] email reconciliation unavailable", error.message);
    return { status: "ok", deletedUsers: 0 };
  }

  const payload = (data || {}) as { status?: string; deleted_users?: number };
  return {
    status: String(payload.status || "ok").toLowerCase() === "exists" ? "exists" : "ok",
    deletedUsers: Number(payload.deleted_users || 0) || 0,
  };
}

async function safeDeleteCreatedUser(
  serviceClient: ReturnType<typeof createServiceClient>,
  userId: string,
) {
  const { error } = await serviceClient.auth.admin.deleteUser(userId);
  if (error) console.warn("[invite-user] auth rollback failed", error.message);
}

export async function handleInviteUserRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("POST only", 405);

  try {
    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return err("Unauthorized", 401);

    const callerClient = createCallerClient(jwt);
    const {
      data: { user },
      error: authError,
    } = await callerClient.auth.getUser();
    if (authError || !user?.id) return err("Unauthorized", 401);

    // This is the canonical cross-client access decision. It intentionally runs
    // before the service-role client is created or any privileged operation is made.
    const { data: accessData, error: accessError } = await callerClient.rpc("get_my_access_state");
    if (accessError) {
      console.warn("[invite-user] access check failed", accessError.message);
      return err("Access check unavailable", 503);
    }
    const access = activeAccessRow(accessData);
    if (!access) return err("Forbidden", 403);

    const { data: callerProfile, error: callerProfileError } = await callerClient
      .from("profiles")
      .select("role, company_id")
      .eq("id", user.id)
      .maybeSingle();
    if (callerProfileError) {
      console.warn("[invite-user] caller profile check failed", callerProfileError.message);
      return err("Access check unavailable", 503);
    }
    const callerRole = String(callerProfile?.role || "").trim().toLowerCase();
    if (!callerProfile || !["admin", "dispatcher"].includes(callerRole)) {
      return err("Forbidden", 403);
    }
    const companyId = String(callerProfile.company_id || "").trim();
    if (!companyId) return err("Caller has no company", 400);
    if (access.company_id && String(access.company_id) !== companyId) return err("Forbidden", 403);

    if (!String(req.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
      return err("Content-Type must be application/json", 415);
    }
    const contentLength = Number(req.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > 16_384) {
      return err("Request body is too large", 413);
    }

    const bodyText = await req.text();
    if (new TextEncoder().encode(bodyText).byteLength > 16_384) {
      return err("Request body is too large", 413);
    }
    let rawBody: unknown = null;
    try {
      rawBody = JSON.parse(bodyText);
    } catch {
      return err("Request body must be valid JSON", 400);
    }
    let body;
    try {
      body = parseInviteUserInput(rawBody);
    } catch (validationError) {
      if (validationError instanceof InviteUserValidationError) {
        return err(validationError.message, 400);
      }
      throw validationError;
    }
    if (!canInviteUserRole(callerRole, body.role)) {
      return err("Forbidden", INVITE_USER_ROLE_FORBIDDEN_STATUS);
    }

    const serviceClient = createServiceClient();

    if (body.department_id) {
      const { data: department, error: departmentError } = await serviceClient
        .from("departments")
        .select("id")
        .eq("id", body.department_id)
        .eq("company_id", companyId)
        .maybeSingle();
      if (departmentError) {
        console.warn("[invite-user] department check failed", departmentError.message);
        return err("Department check failed", 503);
      }
      if (!department) return err("Department not found in your company", 400);
    }

    const { data: existingProfileIdValue, error: existingProfileError } = await serviceClient
      .rpc("find_profile_id_by_normalized_email_v1", {
        p_email: body.email,
      });
    if (existingProfileError) {
      if (isAmbiguousNormalizedProfileEmailError(existingProfileError)) {
        return existingAccountError();
      }
      console.warn("[invite-user] existing profile check failed", existingProfileError.message);
      return err("Email check failed", 503);
    }

    const existingProfileId = existingProfileIdValue === null
      ? null
      : typeof existingProfileIdValue === "string" && existingProfileIdValue.trim()
      ? existingProfileIdValue.trim()
      : undefined;
    if (existingProfileId === undefined) {
      console.warn("[invite-user] existing profile check returned an invalid contract shape");
      return err("Email check failed", 503);
    }

    if (existingProfileId) {
      const { data: existingAuth, error: existingAuthError } = await serviceClient.auth.admin
        .getUserById(existingProfileId);
      if (existingAuth?.user) {
        return existingAccountError();
      }
      if (existingAuthError && !isMissingAuthUser(existingAuthError)) {
        console.warn("[invite-user] existing auth check failed", existingAuthError.message);
        return err("Email check failed", 503);
      }

      // Preserve the canonical recovery behavior for a profile whose auth user
      // was already removed, while avoiding deletion on a transient auth error.
      // Cleanup is intentionally tenant-scoped even though Auth identities are
      // global. An exact email belonging to a stale profile in another company
      // must be treated as a conflict, never as authority to delete that row.
      const { data: deletedStaleProfile, error: staleProfileDeleteError } = await serviceClient
        .from("profiles")
        .delete()
        .eq("id", existingProfileId)
        .eq("company_id", companyId)
        .select("id")
        .maybeSingle();
      if (staleProfileDeleteError) {
        console.warn("[invite-user] stale profile cleanup failed", staleProfileDeleteError.message);
        return err("Failed to cleanup stale profile", 400);
      }
      if (!deletedStaleProfile || deletedStaleProfile.id !== existingProfileId) {
        return existingAccountError();
      }
    }

    const reconciliation = await reconcileEmailBeforeInvite(serviceClient, body.email);
    if (reconciliation.status === "exists") {
      return existingAccountError();
    }

    const tempPassword = generateTempPassword();
    const createPayload = {
      email: body.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        first_name: body.first_name,
        middle_name: body.middle_name,
        last_name: body.last_name,
        full_name: body.full_name,
        invited_by: user.id,
      },
    };

    let { data: created, error: createError } = await serviceClient.auth.admin.createUser(createPayload);
    if (createError) {
      const message = String(createError.message || "Create user failed");
      const isIdentityCorruption =
        /database error checking email|database error finding user|unable to find user from email identity/i.test(message);
      if (isIdentityCorruption) {
        await cleanupOrphanIdentitiesByEmail(serviceClient, body.email);
        const retry = await serviceClient.auth.admin.createUser(createPayload);
        created = retry.data;
        createError = retry.error;
      }
    }
    if (createError) {
      const message = String(createError.message || "Create user failed");
      if (/already.*(exists|registered)|duplicate|email.*(exists|taken|already)/i.test(message)) {
        return existingAccountError();
      }
      console.warn("[invite-user] auth create failed", message);
      return err("Create user failed", 400);
    }

    const invitedUserId = created?.user?.id;
    if (!invitedUserId) return err("Failed to create invited user", 400);

    const { error: profileError } = await serviceClient.from("profiles").upsert({
      id: invitedUserId,
      email: body.email,
      first_name: body.first_name,
      middle_name: body.middle_name,
      last_name: body.last_name,
      full_name: body.full_name,
      phone: body.phone,
      birthdate: body.birthdate,
      role: body.role,
      department_id: body.department_id,
      company_id: companyId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
    if (profileError) {
      await safeDeleteCreatedUser(serviceClient, invitedUserId);
      console.warn("[invite-user] profile save failed", profileError.message);
      return err("Profile save failed", 400);
    }

    const { data: savedProfile } = await serviceClient
      .from("profiles")
      .select("license_state, blocked_reason")
      .eq("id", invitedUserId)
      .maybeSingle();

    const emailResponse = await fetch(`${EMAIL_SERVICE_URL}/send-email`, {
      method: "POST",
      headers: emailServiceHeaders(),
      body: JSON.stringify({
        type: "invite",
        email: body.email,
        firstName: body.first_name || body.full_name,
        lastName: body.first_name ? body.last_name : null,
        tempPassword,
      }),
    }).catch((fetchError) => ({
      ok: false,
      status: 0,
      text: async () => String(fetchError instanceof Error ? fetchError.message : "fetch failed"),
    } as Response));

    if (!emailResponse.ok) {
      // Do not log the email-service body: a misconfigured upstream could echo
      // the request and therefore the temporary password.
      console.warn("[invite-user] email send failed", emailResponse.status);
      const { error: profileDeleteError } = await serviceClient
        .from("profiles")
        .delete()
        .eq("id", invitedUserId);
      if (profileDeleteError) console.warn("[invite-user] profile rollback failed", profileDeleteError.message);
      await safeDeleteCreatedUser(serviceClient, invitedUserId);
      return err("Email send failed", 502);
    }

    // Keep the mobile 1.1.1 response contract. The temporary password exists
    // only inside this function and the email request; it is never returned.
    return Response.json({
      success: true,
      user_id: invitedUserId,
      email: body.email,
      email_sent: true,
      message: "Invitation sent",
      license_state: savedProfile?.license_state || "active",
      blocked_reason: savedProfile?.blocked_reason || null,
      blocked_by_license: savedProfile?.license_state === "blocked_by_license",
    }, { headers: corsHeaders });
  } catch (error) {
    console.error("[invite-user]", error instanceof Error ? error.message : "internal error");
    return err("internal error", 500);
  }
}

if (import.meta.main) {
  Deno.serve(handleInviteUserRequest);
}
