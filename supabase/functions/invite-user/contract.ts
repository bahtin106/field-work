export const INVITE_USER_ROLES = ["admin", "dispatcher", "worker"] as const;
export const INVITE_USER_ROLE_FORBIDDEN_STATUS = 403;

export type InviteUserRole = (typeof INVITE_USER_ROLES)[number];

export type InviteUserInput = {
  email: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  full_name: string | null;
  phone: string | null;
  birthdate: string | null;
  role: InviteUserRole;
  department_id: string | null;
};

const ALLOWED_FIELDS = new Set([
  "email",
  "first_name",
  "middle_name",
  "last_name",
  "full_name",
  "phone",
  "birthdate",
  "role",
  "department_id",
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

export class InviteUserValidationError extends Error {
  readonly code = "invalid_invite_payload";

  constructor(message: string) {
    super(message);
    this.name = "InviteUserValidationError";
  }
}

export function activeAccessRow(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || typeof candidate !== "object") return null;
  const row = candidate as Record<string, unknown>;
  return row.can_login === true ? row : null;
}

export function canInviteUserRole(callerRole: unknown, invitedRole: InviteUserRole): boolean {
  const normalizedCallerRole = typeof callerRole === "string" ? callerRole.trim().toLowerCase() : "";
  return (normalizedCallerRole === "admin" && invitedRole !== "admin")
    || (normalizedCallerRole === "dispatcher" && invitedRole === "worker");
}

export function isAmbiguousNormalizedProfileEmailError(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const error = value as { code?: unknown; message?: unknown };
  const code = typeof error.code === "string" ? error.code.trim() : "";
  const message = typeof error.message === "string" ? error.message : "";
  return code === "21000" || message.includes("ambiguous_normalized_profile_email");
}

function assertPlainObject(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InviteUserValidationError("Request body must be a JSON object");
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InviteUserValidationError("Request body must be a JSON object");
  }
}

function normalizeOptionalText(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new InviteUserValidationError(`${field} must be a string`);
  }

  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!normalized) return null;
  if (CONTROL_CHARACTERS.test(normalized)) {
    throw new InviteUserValidationError(`${field} contains unsupported characters`);
  }
  if (normalized.length > maxLength) {
    throw new InviteUserValidationError(`${field} is too long`);
  }
  return normalized;
}

function normalizeEmail(value: unknown): string {
  const email = normalizeOptionalText(value, "email", 320)?.toLowerCase() || "";
  const parts = email.split("@");
  if (
    !email
    || parts.length !== 2
    || parts[0].length > 64
    || parts[1].length > 255
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
  ) {
    throw new InviteUserValidationError("email is invalid");
  }
  return email;
}

function normalizePhone(value: unknown): string | null {
  const phone = normalizeOptionalText(value, "phone", 40);
  if (!phone) return null;
  if (!/^[+\d\s().-]+$/u.test(phone)) {
    throw new InviteUserValidationError("phone is invalid");
  }

  const digits = phone.replace(/\D/gu, "");
  if (digits.length === 10) return `+7${digits}`;
  if (digits.length === 11 && digits.startsWith("8")) return `+7${digits.slice(1)}`;
  if (digits.length === 11 && digits.startsWith("7")) return `+${digits}`;
  if (phone.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  throw new InviteUserValidationError("phone is invalid");
}

function normalizeBirthdate(value: unknown): string | null {
  const birthdate = normalizeOptionalText(value, "birthdate", 10);
  if (!birthdate) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(birthdate)) {
    throw new InviteUserValidationError("birthdate must use YYYY-MM-DD format");
  }

  const parsed = new Date(`${birthdate}T00:00:00.000Z`);
  const today = new Date().toISOString().slice(0, 10);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== birthdate) {
    throw new InviteUserValidationError("birthdate is invalid");
  }
  if (birthdate < "1900-01-01" || birthdate > today) {
    throw new InviteUserValidationError("birthdate is outside the supported range");
  }
  return birthdate;
}

function normalizeRole(value: unknown): InviteUserRole {
  if (value === undefined || value === null || value === "") return "worker";
  if (typeof value !== "string") {
    throw new InviteUserValidationError("role must be a string");
  }

  const role = value.trim().toLowerCase();
  if (!INVITE_USER_ROLES.includes(role as InviteUserRole)) {
    throw new InviteUserValidationError("role is invalid");
  }
  return role as InviteUserRole;
}

function normalizeDepartmentId(value: unknown): string | null {
  const departmentId = normalizeOptionalText(value, "department_id", 36);
  if (!departmentId) return null;
  if (!UUID_PATTERN.test(departmentId)) {
    throw new InviteUserValidationError("department_id is invalid");
  }
  return departmentId.toLowerCase();
}

export function parseInviteUserInput(value: unknown): InviteUserInput {
  assertPlainObject(value);

  const unknownFields = Object.keys(value).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unknownFields.length > 0) {
    throw new InviteUserValidationError(`Unknown field: ${unknownFields.sort()[0]}`);
  }

  const firstName = normalizeOptionalText(value.first_name, "first_name", 120);
  const middleName = normalizeOptionalText(value.middle_name, "middle_name", 120);
  const lastName = normalizeOptionalText(value.last_name, "last_name", 120);
  const suppliedFullName = normalizeOptionalText(value.full_name, "full_name", 360);
  const computedFullName = [firstName, middleName, lastName].filter(Boolean).join(" ") || null;

  return {
    email: normalizeEmail(value.email),
    first_name: firstName,
    middle_name: middleName,
    last_name: lastName,
    full_name: suppliedFullName || computedFullName,
    phone: normalizePhone(value.phone),
    birthdate: normalizeBirthdate(value.birthdate),
    role: normalizeRole(value.role),
    department_id: normalizeDepartmentId(value.department_id),
  };
}
