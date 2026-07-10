import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const MAX_PROVIDER = 'max';
const MAX_API_BASE_URL = 'https://platform-api2.max.ru';
const MAX_TRUSTED_CA_CERTS = [`
-----BEGIN CERTIFICATE-----
MIIHQjCCBSqgAwIBAgICEAIwDQYJKoZIhvcNAQELBQAwcDELMAkGA1UEBhMCUlUx
PzA9BgNVBAoMNlRoZSBNaW5pc3RyeSBvZiBEaWdpdGFsIERldmVsb3BtZW50IGFu
ZCBDb21tdW5pY2F0aW9uczEgMB4GA1UEAwwXUnVzc2lhbiBUcnVzdGVkIFJvb3Qg
Q0EwHhcNMjIwMzAyMTEyNTE5WhcNMjcwMzA2MTEyNTE5WjBvMQswCQYDVQQGEwJS
VTE/MD0GA1UECgw2VGhlIE1pbmlzdHJ5IG9mIERpZ2l0YWwgRGV2ZWxvcG1lbnQg
YW5kIENvbW11bmljYXRpb25zMR8wHQYDVQQDDBZSdXNzaWFuIFRydXN0ZWQgU3Vi
IENBMIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA9YPqBKOk19NFymrE
wehzrhBEgT2atLezpduB24mQ7CiOa/HVpFCDRZzdxqlh8drku408/tTmWzlNH/br
HuQhZ/miWKOf35lpKzjyBd6TPM23uAfJvEOQ2/dnKGGJbsUo1/udKSvxQwVHpVv3
S80OlluKfhWPDEXQpgyFqIzPoxIQTLZ0deirZwMVHarZ5u8HqHetRuAtmO2ZDGQn
vVOJYAjls+Hiueq7Lj7Oce7CQsTwVZeP+XQx28PAaEZ3y6sQEt6rL06ddpSdoTMp
BnCqTbxW+eWMyjkIn6t9GBtUV45yB1EkHNnj2Ex4GwCiN9T84QQjKSr+8f0psGrZ
vPbCbQAwNFJjisLixnjlGPLKa5vOmNwIh/LAyUW5DjpkCx004LPDuqPpFsKXNKpa
L2Dm6uc0x4Jo5m+gUTVORB6hOSzWnWDj2GWfomLzzyjG81DRGFBpco/O93zecsIN
3SL2Ysjpq1zdoS01CMYxie//9zWvYwzI25/OZigtnpCIrcd2j1Y6dMUFQAzAtHE+
qsXflSL8HIS+IJEFIQobLlYhHkoE3avgNx5jlu+OLYe0dF0Ykx1PGNjbwqvTX37R
Cn32NMjlotW2QcGEZhDKj+3urZizp5xdTPZitA+aEjZM/Ni71VOdiOP0igbw6asZ
2fxdozZ1TnSSYNYvNATwthNmZysCAwEAAaOCAeUwggHhMBIGA1UdEwEB/wQIMAYB
Af8CAQAwDgYDVR0PAQH/BAQDAgGGMB0GA1UdDgQWBBTR4XENCy2BTm6KSo9MI7NM
XqtpCzAfBgNVHSMEGDAWgBTh0YHlzlpfBKrS6badZrHF+qwshzCBxwYIKwYBBQUH
AQEEgbowgbcwOwYIKwYBBQUHMAKGL2h0dHA6Ly9yb3N0ZWxlY29tLnJ1L2NkcC9y
b290Y2Ffc3NsX3JzYTIwMjIuY3J0MDsGCCsGAQUFBzAChi9odHRwOi8vY29tcGFu
eS5ydC5ydS9jZHAvcm9vdGNhX3NzbF9yc2EyMDIyLmNydDA7BggrBgEFBQcwAoYv
aHR0cDovL3JlZXN0ci1wa2kucnUvY2RwL3Jvb3RjYV9zc2xfcnNhMjAyMi5jcnQw
gbAGA1UdHwSBqDCBpTA1oDOgMYYvaHR0cDovL3Jvc3RlbGVjb20ucnUvY2RwL3Jv
b3RjYV9zc2xfcnNhMjAyMi5jcmwwNaAzoDGGL2h0dHA6Ly9jb21wYW55LnJ0LnJ1
L2NkcC9yb290Y2Ffc3NsX3JzYTIwMjIuY3JsMDWgM6Axhi9odHRwOi8vcmVlc3Ry
LXBraS5ydS9jZHAvcm9vdGNhX3NzbF9yc2EyMDIyLmNybDANBgkqhkiG9w0BAQsF
AAOCAgEARBVzZls79AdiSCpar15dA5Hr/rrT4WbrOfzlpI+xrLeRPrUG6eUWIW4v
Sui1yx3iqGLCjPcKb+HOTwoRMbI6ytP/ndp3TlYua2advYBEhSvjs+4vDZNwXr/D
anbwIWdurZmViQRBDFebpkvnIvru/RpWud/5r624Wp8voZMRtj/cm6aI9LtvBfT9
cfzhOaexI/99c14dyiuk1+6QhdwKaCRTc1mdfNQmnfWNRbfWhWBlK3h4GGE9JK33
Gk8ZS8DMrkdAh0xby4xAQ/mSWAfWrBmfzlOqGyoB1U47WTOeqNbWkkoAP2ys94+s
Jg4NTkiDVtXRF6nr6fYi0bSOvOFg0IQrMXO2Y8gyg9ARdPJwKtvWX8VPADCYMiWH
h4n8bZokIrImVKLDQKHY4jCsND2HHdJfnrdL2YJw1qFskNO4cSNmZydw0Wkgjv9k
F+KxqrDKlB8MZu2Hclph6v/CZ0fQ9YuE8/lsHZ0Qc2HyiSMnvjgK5fDc3TD4fa8F
E8gMNurM+kV8PT8LNIM+4Zs+LKEV8nqRWBaxkIVJGekkVKO8xDBOG/aN62AZKHOe
GcyIdu7yNMMRihGVZCYr8rYiJoKiOzDqOkPkLOPdhtVlgnhowzHDxMHND/E2WA5p
ZHuNM/m0TXt2wTTPL7JH2YC0gPz/BvvSzjksgzU5rLbRyUKQkgU=
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIFwjCCA6qgAwIBAgICEAAwDQYJKoZIhvcNAQELBQAwcDELMAkGA1UEBhMCUlUx
PzA9BgNVBAoMNlRoZSBNaW5pc3RyeSBvZiBEaWdpdGFsIERldmVsb3BtZW50IGFu
ZCBDb21tdW5pY2F0aW9uczEgMB4GA1UEAwwXUnVzc2lhbiBUcnVzdGVkIFJvb3Qg
Q0EwHhcNMjIwMzAxMjEwNDE1WhcNMzIwMjI3MjEwNDE1WjBwMQswCQYDVQQGEwJS
VTE/MD0GA1UECgw2VGhlIE1pbmlzdHJ5IG9mIERpZ2l0YWwgRGV2ZWxvcG1lbnQg
YW5kIENvbW11bmljYXRpb25zMSAwHgYDVQQDDBdSdXNzaWFuIFRydXN0ZWQgUm9v
dCBDQTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAMfFOZ8pUAL3+r2n
qqE0Zp52selXsKGFYoG0GM5bwz1bSFtCt+AZQMhkWQheI3poZAToYJu69pHLKS6Q
XBiwBC1cvzYmUYKMYZC7jE5YhEU2bSL0mX7NaMxMDmH2/NwuOVRj8OImVa5s1F4U
zn4Kv3PFlDBjjSjXKVY9kmjUBsXQrIHeaqmUIsPIlNWUnimXS0I0abExqkbdrXbX
YwCOXhOO2pDUx3ckmJlCMUGacUTnylyQW2VsJIyIGA8V0xzdaeUXg0VZ6ZmNUr5Y
Ber/EAOLPb8NYpsAhJe2mXjMB/J9HNsoFMBFJ0lLOT/+dQvjbdRZoOT8eqJpWnVD
U+QL/qEZnz57N88OWM3rabJkRNdU/Z7x5SFIM9FrqtN8xewsiBWBI0K6XFuOBOTD
4V08o4TzJ8+Ccq5XlCUW2L48pZNCYuBDfBh7FxkB7qDgGDiaftEkZZfApRg2E+M9
G8wkNKTPLDc4wH0FDTijhgxR3Y4PiS1HL2Zhw7bD3CbslmEGgfnnZojNkJtcLeBH
BLa52/dSwNU4WWLubaYSiAmA9IUMX1/RpfpxOxd4Ykmhz97oFbUaDJFipIggx5sX
ePAlkTdWnv+RWBxlJwMQ25oEHmRguNYf4Zr/Rxr9cS93Y+mdXIZaBEE0KS2iLRqa
OiWBki9IMQU4phqPOBAaG7A+eP8PAgMBAAGjZjBkMB0GA1UdDgQWBBTh0YHlzlpf
BKrS6badZrHF+qwshzAfBgNVHSMEGDAWgBTh0YHlzlpfBKrS6badZrHF+qwshzAS
BgNVHRMBAf8ECDAGAQH/AgEEMA4GA1UdDwEB/wQEAwIBhjANBgkqhkiG9w0BAQsF
AAOCAgEAALIY1wkilt/urfEVM5vKzr6utOeDWCUczmWX/RX4ljpRdgF+5fAIS4vH
tmXkqpSCOVeWUrJV9QvZn6L227ZwuE15cWi8DCDal3Ue90WgAJJZMfTshN4OI8cq
W9E4EG9wglbEtMnObHlms8F3CHmrw3k6KmUkWGoa+/ENmcVl68u/cMRl1JbW2bM+
/3A+SAg2c6iPDlehczKx2oa95QW0SkPPWGuNA/CE8CpyANIhu9XFrj3RQ3EqeRcS
AQQod1RNuHpfETLU/A2gMmvn/w/sx7TB3W5BPs6rprOA37tutPq9u6FTZOcG1Oqj
C/B7yTqgI7rbyvox7DEXoX7rIiEqyNNUguTk/u3SZ4VXE2kmxdmSh3TQvybfbnXV
4JbCZVaqiZraqc7oZMnRoWrXRG3ztbnbes/9qhRGI7PqXqeKJBztxRTEVj8ONs1d
WN5szTwaPIvhkhO3CO5ErU2rVdUr89wKpNXbBODFKRtgxUT70YpmJ46VVaqdAhOZ
D9EUUn4YaeLaS8AjSF/h7UkjOibNc4qVDiPP+rkehFWM66PVnP1Msh93tc+taIfC
EYVMxjh8zNbFuoc7fzvvrFILLe7ifvEIUqSVIC/AzplM/Jxw7buXFeGP1qVCBEHq
391d/9RAfaZ12zkwFsl+IKwE/OZxW8AHa9i1p4GO0YSNuczzEm4=
-----END CERTIFICATE-----
`.trim()];
const NEW_STATUS = '\u041d\u043e\u0432\u044b\u0439';
const CONFIRM_TEXT = '\u2705 \u0417\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u044c \u0441\u043e\u0437\u0434\u0430\u043d\u0438\u0435 \u0437\u0430\u044f\u0432\u043a\u0438';
const RESTART_TEXT = '\u041d\u0430\u0447\u0430\u0442\u044c \u0437\u0430\u043d\u043e\u0432\u043e';
const BACK_TEXT = '\u041d\u0430\u0437\u0430\u0434';
const NEXT_TEXT = '\u0414\u0430\u043b\u0435\u0435';
const SKIP_TEXT = '\u041f\u0440\u043e\u043f\u0443\u0441\u0442\u0438\u0442\u044c';
const CANCEL_TEXT = '\u274c \u041e\u0442\u043c\u0435\u043d\u0438\u0442\u044c \u0437\u0430\u044f\u0432\u043a\u0443';
const CREATE_NEW_REQUEST_TEXT = '\u2705 \u0421\u043e\u0437\u0434\u0430\u0442\u044c \u043d\u043e\u0432\u0443\u044e \u0437\u0430\u044f\u0432\u043a\u0443';
const KEEP_CURRENT_REQUEST_TEXT = '\u041d\u0435 \u0441\u0435\u0439\u0447\u0430\u0441';
const EDIT_CANCEL_TEXT = '\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f \u043a \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0435';

const PRIVATE_CHAT_ONLY_TEXT = '\u0411\u043e\u0442 \u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442 \u0442\u043e\u043b\u044c\u043a\u043e \u0432 \u043b\u0438\u0447\u043d\u043e\u043c \u0447\u0430\u0442\u0435.';
const GENERIC_FAILURE_TEXT = '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0431\u0440\u0430\u0431\u043e\u0442\u0430\u0442\u044c \u0437\u0430\u044f\u0432\u043a\u0443. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0435\u0449\u0451 \u0440\u0430\u0437 \u0438\u043b\u0438 \u0441\u0432\u044f\u0436\u0438\u0442\u0435\u0441\u044c \u0441 \u043a\u043e\u043c\u043f\u0430\u043d\u0438\u0435\u0439.';
const BOT_NOT_CONFIGURED_TEXT = '\u0411\u043e\u0442 \u043f\u043e\u043a\u0430 \u043d\u0435 \u043d\u0430\u0441\u0442\u0440\u043e\u0435\u043d. \u041a\u043e\u043c\u043f\u0430\u043d\u0438\u0438 \u043d\u0443\u0436\u043d\u043e \u0432\u043a\u043b\u044e\u0447\u0438\u0442\u044c \u0445\u043e\u0442\u044f \u0431\u044b \u043e\u0434\u043d\u043e \u043f\u043e\u043b\u0435 \u0434\u043b\u044f \u0437\u0430\u043f\u0440\u043e\u0441\u0430.';
const BOT_EMPTY_FIELDS_SAVE_ERROR = '\u0412\u043a\u043b\u044e\u0447\u0438\u0442\u0435 \u0445\u043e\u0442\u044f \u0431\u044b \u043e\u0434\u043d\u043e \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e\u0435 \u043f\u043e\u043b\u0435 \u0434\u043b\u044f Max-\u0431\u043e\u0442\u0430.';
const MANDATORY_MAX_FIELD_KEYS = new Set<string>(['customer_name', 'phone']);
const HIDDEN_MAX_FIELD_KEYS = new Set(['title', 'object_name', 'office']);
const OBJECT_MATCH_FIELD_KEYS = ['country', 'region', 'district', 'city', 'street', 'house', 'postal_code', 'floor', 'entrance', 'apartment'];
const ADDRESS_FIELD_KEYS = new Set([
  'country',
  'region',
  'district',
  'city',
  'street',
  'house',
  'postal_code',
  'floor',
  'entrance',
  'apartment',
  'entrance_info',
  'parking_notes',
]);
const BOT_FIELD_SETTING_DEPENDENCIES: Record<string, Array<{ entityType: string; fieldKey: string }>> = {
  secondary_phone: [{ entityType: 'client', fieldKey: 'additional_phone_1' }],
  email: [{ entityType: 'client', fieldKey: 'email' }],
  comment: [{ entityType: 'order', fieldKey: 'comment' }],
  country: [{ entityType: 'object', fieldKey: 'country' }],
  region: [{ entityType: 'object', fieldKey: 'region' }],
  district: [{ entityType: 'object', fieldKey: 'district' }],
  city: [{ entityType: 'object', fieldKey: 'city' }],
  street: [{ entityType: 'object', fieldKey: 'street' }],
  house: [{ entityType: 'object', fieldKey: 'house' }],
  postal_code: [{ entityType: 'object', fieldKey: 'postal_code' }],
  floor: [{ entityType: 'object', fieldKey: 'floor' }],
  entrance: [{ entityType: 'object', fieldKey: 'entrance' }],
  apartment: [{ entityType: 'object', fieldKey: 'apartment' }],
  entrance_info: [{ entityType: 'object', fieldKey: 'comment' }],
};
const MESSAGE_RATE_LIMIT_MS = 700;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

type AdminClient = ReturnType<typeof createClient>;

type IntegrationRow = {
  id: string;
  company_id: string;
  provider: string;
  is_enabled: boolean;
  onboarding_token: string;
  destination_type: 'feed' | 'assignee';
  destination_user_id: string | null;
  create_client: boolean;
  existing_client_policy: 'reuse' | 'order_only';
  create_object: boolean;
  existing_object_policy: 'reuse_or_create' | 'always_create';
  welcome_message: string | null;
  success_message: string | null;
  failure_message: string | null;
};

type EffectiveField = {
  field_key: string;
  entity_scope: 'order' | 'client' | 'object';
  input_kind: string;
  label: string;
  prompt: string;
  placeholder: string | null;
  sort_order: number;
  is_enabled: boolean;
  is_required: boolean;
  supports_required: boolean;
  disabled_by_field_settings?: boolean;
  unavailable_reason?: string | null;
};

type ConversationRow = {
  provider: string;
  external_chat_id: string;
  external_user_id: string | null;
  external_username: string | null;
  company_id: string | null;
  integration_id: string | null;
  status: string;
  current_field_key: string | null;
  state: Record<string, unknown> | null;
  last_message_at?: string | null;
};

type MaxMessage = {
  updateId: string;
  messageId: string;
  chatId: string;
  chatType: string;
  text: string;
  userId: string;
  username: string;
  contactPhone: string;
  contactUserId: string;
};

type MaxCallback = {
  updateId: string;
  callbackId: string;
  chatId: string;
  chatType: string;
  messageId: string;
  userId: string;
  username: string;
  data: string;
};

const json = (status: number, body: Record<string, Json>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error && typeof error === 'object') {
    const maybe = error as Record<string, unknown>;
    for (const key of ['message', 'error_description', 'details', 'hint']) {
      const value = maybe[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    try {
      return JSON.stringify(error);
    } catch {}
  }
  return 'Unknown error';
}

function isUniqueViolation(error: unknown) {
  const code = String((error as Record<string, unknown>)?.code || '').trim();
  if (code === '23505') return true;
  const message = toErrorMessage(error).toLowerCase();
  return message.includes('duplicate key') || message.includes('unique');
}

function normalizeUuidOrNull(value: unknown) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRe.test(text) ? text : null;
}

function isOrderStatusConstraintError(error: unknown) {
  const code = String((error as Record<string, unknown>)?.code || '').trim();
  if (code !== '23514') return false;
  const message = toErrorMessage(error).toLowerCase();
  return message.includes('status') || message.includes('orders_status');
}

function normalizeText(raw: unknown) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

function escapeHtml(raw: unknown) {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function trimToNull(raw: unknown) {
  const value = normalizeText(raw);
  return value || null;
}

function normalizePhoneDigits(raw: unknown) {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  if (digits.length > 11) digits = digits.slice(0, 11);
  return digits;
}

function formatPhoneMask(raw: unknown) {
  const digits = normalizePhoneDigits(raw);
  if (!digits) return '';
  const local = digits.startsWith('7') ? digits.slice(1) : digits;
  const a = local.slice(0, 3);
  const b = local.slice(3, 6);
  const c = local.slice(6, 8);
  const d = local.slice(8, 10);
  let result = '+7';
  if (a) result += ` (${a}`;
  if (a.length === 3) result += ')';
  if (b) result += ` ${b}`;
  if (c) result += `-${c}`;
  if (d) result += `-${d}`;
  return result;
}

function toE164PhoneOrNull(raw: unknown) {
  const digits = normalizePhoneDigits(raw);
  if (digits.length !== 11 || !digits.startsWith('7')) return null;
  return `+${digits}`;
}

function trimCommentText(raw: unknown) {
  return String(raw ?? '').replace(/\r/g, '').trim();
}

function appendOrderCommentNote(baseComment: unknown, note: string | null) {
  const base = trimCommentText(baseComment);
  const normalizedNote = trimCommentText(note);
  if (!normalizedNote) return base || null;
  return base ? `${base}\n\n${normalizedNote}` : normalizedNote;
}

function getWebhookUrl() {
  const direct = normalizeText(Deno.env.get('MAX_WEBHOOK_URL'));
  if (direct) return direct;

  const publicUrl = normalizeText(Deno.env.get('SUPABASE_PUBLIC_URL'));
  if (publicUrl) return `${publicUrl.replace(/\/+$/, '')}/functions/v1/max-bot`;

  const fallback = normalizeText(Deno.env.get('SUPABASE_URL'));
  return fallback ? `${fallback.replace(/\/+$/, '')}/functions/v1/max-bot` : '';
}

function secureCompare(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function levenshteinDistance(left: string, right: string) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array(right.length + 1);

  for (let i = 0; i < left.length; i += 1) {
    current[0] = i + 1;
    for (let j = 0; j < right.length; j += 1) {
      const substitutionCost = left[i] === right[j] ? 0 : 1;
      current[j + 1] = Math.min(
        current[j] + 1,
        previous[j + 1] + 1,
        previous[j] + substitutionCost,
      );
    }
    for (let j = 0; j < current.length; j += 1) previous[j] = current[j];
  }

  return previous[right.length];
}

function similarityScore(leftRaw: unknown, rightRaw: unknown) {
  const left = normalizeText(leftRaw);
  const right = normalizeText(rightRaw);
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  if (left === right) return 1;
  const maxLength = Math.max(left.length, right.length);
  if (!maxLength) return 1;
  return 1 - levenshteinDistance(left, right) / maxLength;
}

function buildObjectSummary(address: Record<string, string>) {
  return [address.city, address.street, address.house, address.apartment ? `\u043a\u0432. ${address.apartment}` : '']
    .filter(Boolean)
    .join(', ')
    .trim();
}

function buildFullAddress(address: Record<string, string>) {
  return [
    address.postal_code,
    address.country,
    address.region,
    address.district,
    address.city,
    address.street ? `\u0443\u043b. ${address.street}` : '',
    address.house ? `\u0434. ${address.house}` : '',
    address.apartment ? `\u043a\u0432. ${address.apartment}` : '',
    address.entrance ? `\u043f\u043e\u0434\u044a\u0435\u0437\u0434 ${address.entrance}` : '',
    address.floor ? `\u044d\u0442\u0430\u0436 ${address.floor}` : '',
    address.entrance_info,
    address.parking_notes,
  ]
    .filter(Boolean)
    .join(', ')
    .trim();
}

function conversationKeyboard(kind: 'collecting' | 'confirming', required: boolean, hasValue = false, editMode = false) {
  if (kind === 'confirming') {
    return {
      keyboard: [[{ text: CONFIRM_TEXT }], [{ text: BACK_TEXT }, { text: RESTART_TEXT }], [{ text: CANCEL_TEXT }]],
      resize_keyboard: true,
    };
  }
  if (editMode) {
    return {
      keyboard: [[{ text: EDIT_CANCEL_TEXT }], [{ text: CANCEL_TEXT }]],
      resize_keyboard: true,
    };
  }
  const rows = [];
  if (hasValue) rows.push([{ text: NEXT_TEXT }]);
  if (!required) rows.push([{ text: SKIP_TEXT }]);
  rows.push([{ text: BACK_TEXT }, { text: CANCEL_TEXT }]);
  return { keyboard: rows, resize_keyboard: true };
}

function phoneKeyboard(required: boolean, hasValue = false, editMode = false) {
  const rows: Array<Array<{ text: string; request_contact?: boolean }>> = [
    [{ text: '\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u043d\u043e\u043c\u0435\u0440', request_contact: true }],
  ];
  if (editMode) {
    rows.push([{ text: EDIT_CANCEL_TEXT }], [{ text: CANCEL_TEXT }]);
    return { keyboard: rows, resize_keyboard: true };
  }
  if (hasValue) rows.push([{ text: NEXT_TEXT }]);
  if (!required) rows.push([{ text: SKIP_TEXT }]);
  rows.push([{ text: BACK_TEXT }, { text: CANCEL_TEXT }]);
  return { keyboard: rows, resize_keyboard: true };
}

function newRequestKeyboard() {
  return {
    keyboard: [[{ text: CREATE_NEW_REQUEST_TEXT }], [{ text: KEEP_CURRENT_REQUEST_TEXT }]],
    resize_keyboard: true,
  };
}

function getAdminClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRole =
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceRole) throw new Error('Missing Supabase env');
  return createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function buildMaxInlineKeyboard(rows: unknown[][] | null | undefined) {
  if (!Array.isArray(rows) || !rows.length) return undefined;
  const buttons = rows
    .map((row) =>
      (Array.isArray(row) ? row : [])
        .map((rawButton) => {
          const button = (rawButton || {}) as Record<string, unknown>;
          const text = normalizeText(button.text);
          if (!text) return null;
          if (button.request_contact === true) return { type: 'request_contact', text };
          if (normalizeText(button.callback_data)) {
            return { type: 'callback', text, payload: normalizeText(button.callback_data) };
          }
          return { type: 'message', text };
        })
        .filter(Boolean),
    )
    .filter((row) => row.length > 0);
  if (!buttons.length) return undefined;
  return [{ type: 'inline_keyboard', payload: { buttons } }];
}

function buildMaxAttachments(options: {
  keyboard?: Record<string, unknown> | null;
  inlineKeyboard?: unknown[][] | null;
  removeKeyboard?: boolean;
}) {
  if (options.removeKeyboard) return undefined;
  if (options.inlineKeyboard) return buildMaxInlineKeyboard(options.inlineKeyboard);
  const keyboardRows = options.keyboard?.keyboard as unknown[][] | undefined;
  const inlineRows = options.keyboard?.inline_keyboard as unknown[][] | undefined;
  return buildMaxInlineKeyboard(inlineRows || keyboardRows);
}

let maxApiHttpClient: unknown | null | undefined;

function getMaxApiHttpClient() {
  if (maxApiHttpClient !== undefined) return maxApiHttpClient;
  const createHttpClient = (Deno as unknown as {
    createHttpClient?: (options: { caCerts: string[] }) => unknown;
  }).createHttpClient;
  if (typeof createHttpClient !== 'function') {
    maxApiHttpClient = null;
    return maxApiHttpClient;
  }
  try {
    maxApiHttpClient = createHttpClient({ caCerts: MAX_TRUSTED_CA_CERTS });
  } catch (error) {
    console.warn('[max-bot] Failed to create Max API HTTP client', toErrorMessage(error));
    maxApiHttpClient = null;
  }
  return maxApiHttpClient;
}

async function sendMaxApiRequest(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  query: Record<string, string | number | boolean | null | undefined> = {},
  body?: Record<string, unknown>,
) {
  const botToken = Deno.env.get('MAX_BOT_TOKEN') || '';
  if (!botToken) throw new Error('Missing MAX_BOT_TOKEN');
  const url = new URL(path, MAX_API_BASE_URL);
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  const fetchInit = {
    method,
    headers: {
      Authorization: botToken,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  } as RequestInit & { client?: unknown };
  const client = getMaxApiHttpClient();
  if (client) fetchInit.client = client;
  const response = await fetch(url.toString(), fetchInit);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) throw new Error(toErrorMessage(data));
  return data;
}

function extractMaxResponseMessageId(response: Record<string, unknown>) {
  const message = (response?.message || {}) as Record<string, unknown>;
  const body = (message.body || {}) as Record<string, unknown>;
  return (
    normalizeText(body.mid) ||
    normalizeText(body.message_id) ||
    normalizeText(message.message_id) ||
    normalizeText(message.id) ||
    normalizeText(response?.message_id)
  );
}

async function sendMaxMessage(
  chatId: string,
  text: string,
  options: { keyboard?: Record<string, unknown> | null; inlineKeyboard?: unknown[][] | null; removeKeyboard?: boolean } = {},
) {
  return sendMaxApiRequest('POST', '/messages', { chat_id: chatId }, {
    text,
    format: 'html',
    attachments: buildMaxAttachments(options),
    notify: true,
  });
}

async function editMaxMessageText(
  chatId: string,
  messageId: string | number,
  text: string,
  options: { inlineKeyboard?: unknown[][] | null } = {},
) {
  const normalized = normalizeText(messageId);
  if (!normalized) throw new Error('Invalid message id');
  return sendMaxApiRequest('PUT', '/messages', { message_id: normalized }, {
    text,
    format: 'html',
    attachments: buildMaxAttachments({ inlineKeyboard: options.inlineKeyboard }),
    notify: true,
  });
}

async function deleteMaxMessage(chatId: string, messageId: string | number) {
  const normalized = normalizeText(messageId);
  if (!chatId || !normalized) return;
  await sendMaxApiRequest('DELETE', '/messages', { message_id: normalized });
}

async function safeDeleteMaxMessage(chatId: string, messageId: string | number) {
  try {
    await deleteMaxMessage(chatId, messageId);
  } catch {}
}

async function answerMaxCallback(callbackId: string, text = '') {
  if (!callbackId || !text) return;
  await sendMaxApiRequest('POST', '/answers', { callback_id: callbackId }, {
    notification: text,
  });
}

async function ensureMaxWebhook() {
  const botToken = Deno.env.get('MAX_BOT_TOKEN') || '';
  const secretToken = Deno.env.get('MAX_WEBHOOK_SECRET') || '';
  const baseUrl = getWebhookUrl();
  if (!botToken || !secretToken) throw new Error('Missing Max webhook env');
  if (!baseUrl) throw new Error('Missing Max webhook URL');
  const current = await sendMaxApiRequest('GET', '/subscriptions').catch(() => null) as
    | { subscriptions?: Array<Record<string, unknown>> }
    | null;
  const subscriptions = Array.isArray(current?.subscriptions) ? current.subscriptions : [];
  if (subscriptions.some((item) => normalizeText(item.url) === baseUrl)) return baseUrl;
  await sendMaxApiRequest('POST', '/subscriptions', {}, {
    url: baseUrl,
    secret: secretToken,
    update_types: ['bot_started', 'message_created', 'message_callback'],
  });
  return baseUrl;
}

async function getCallerContext(admin: AdminClient, req: Request) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Error('Unauthorized');

  const {
    data: { user },
    error: authErr,
  } = await admin.auth.getUser(token);
  if (authErr || !user?.id) throw new Error('Unauthorized');

  const { data: profile, error } = await admin
    .from('profiles')
    .select('id, role, company_id')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw error;
  if (!profile?.company_id) throw new Error('Company not found');
  if (String(profile.role || '').toLowerCase() !== 'admin') throw new Error('Forbidden');

  return {
    userId: String(user.id),
    companyId: String(profile.company_id),
  };
}

async function getIntegration(admin: AdminClient, companyId: string) {
  const { data, error } = await admin
    .from('messenger_integrations')
    .select('*')
    .eq('company_id', companyId)
    .eq('provider', MAX_PROVIDER)
    .maybeSingle();
  if (error) throw error;
  return (data as IntegrationRow | null) || null;
}

async function ensureIntegration(admin: AdminClient, companyId: string) {
  const existing = await getIntegration(admin, companyId);
  if (existing) return existing;
  const { data, error } = await admin
    .from('messenger_integrations')
    .insert({ company_id: companyId, provider: MAX_PROVIDER })
    .select('*')
    .single();
  if (error) throw error;
  return data as IntegrationRow;
}

async function getDisabledEntityFieldKeys(admin: AdminClient, companyId: string) {
  const { data, error } = await admin
    .from('company_entity_field_settings')
    .select('entity_type, field_key, is_enabled')
    .eq('company_id', companyId)
    .eq('is_enabled', false);
  if (error) throw error;

  const disabled = new Set<string>();
  for (const row of Array.isArray(data) ? data : []) {
    const entityType = normalizeText(row?.entity_type);
    const fieldKey = normalizeText(row?.field_key);
    if (entityType && fieldKey) disabled.add(`${entityType}:${fieldKey}`);
  }
  return disabled;
}

function isDisabledByEntityFieldSettings(fieldKey: string, disabledEntityFields: Set<string>) {
  const dependencies = BOT_FIELD_SETTING_DEPENDENCIES[fieldKey] || [];
  return dependencies.some((dependency) =>
    disabledEntityFields.has(`${dependency.entityType}:${dependency.fieldKey}`),
  );
}

async function hasEnabledFieldInPayload(
  admin: AdminClient,
  companyId: string,
  fields: Array<Record<string, unknown>>,
) {
  if (MANDATORY_MAX_FIELD_KEYS.size > 0) return true;
  const disabledEntityFields = await getDisabledEntityFieldKeys(admin, companyId);
  return (Array.isArray(fields) ? fields : []).some((field) => {
    const fieldKey = normalizeText(field.field_key);
    if (!fieldKey || HIDDEN_MAX_FIELD_KEYS.has(fieldKey)) return false;
    if (MANDATORY_MAX_FIELD_KEYS.has(fieldKey)) return true;
    if (field.is_enabled === false) return false;
    return !isDisabledByEntityFieldSettings(fieldKey, disabledEntityFields);
  });
}

async function getEffectiveFields(
  admin: AdminClient,
  integration: IntegrationRow,
  options: { includeDisabled?: boolean } = {},
) {
  const includeDisabled = options.includeDisabled === true;
  const [
    { data: catalog, error: catalogError },
    { data: settings, error: settingsError },
    disabledEntityFields,
  ] = await Promise.all([
    admin
      .from('messenger_field_catalog')
      .select('*')
      .eq('provider', MAX_PROVIDER)
      .eq('is_active', true)
      .order('default_sort_order', { ascending: true })
      .order('field_key', { ascending: true }),
    admin
      .from('company_messenger_field_settings')
      .select('*')
      .eq('company_id', integration.company_id)
      .eq('provider', MAX_PROVIDER),
    getDisabledEntityFieldKeys(admin, integration.company_id),
  ]);
  if (catalogError) throw catalogError;
  if (settingsError) throw settingsError;

  const settingsByKey = new Map<string, Record<string, unknown>>();
  for (const row of Array.isArray(settings) ? settings : []) {
    settingsByKey.set(String(row.field_key || ''), row as Record<string, unknown>);
  }

  const rows = (Array.isArray(catalog) ? catalog : [])
    .map((row) => {
      const item = row as Record<string, unknown>;
      const fieldKey = String(item.field_key || '');
      if (HIDDEN_MAX_FIELD_KEYS.has(fieldKey)) return null;
      const setting = settingsByKey.get(fieldKey);
      const isMandatory = MANDATORY_MAX_FIELD_KEYS.has(fieldKey);
      const disabledByFieldSettings = isDisabledByEntityFieldSettings(fieldKey, disabledEntityFields);
      return {
        field_key: fieldKey,
        entity_scope: String(item.entity_scope || 'order') as EffectiveField['entity_scope'],
        input_kind: String(item.input_kind || 'text'),
        label: String(item.label || fieldKey),
        prompt: String(item.prompt || fieldKey),
        placeholder: normalizeText(item.placeholder) || null,
        sort_order: Number(setting?.sort_order ?? item.default_sort_order ?? 0) || 0,
        is_enabled: disabledByFieldSettings
          ? false
          : isMandatory
          ? true
          : setting?.is_enabled !== undefined
            ? setting.is_enabled !== false
            : item.default_enabled !== false,
        is_required: isMandatory,
        supports_required: false,
        disabled_by_field_settings: disabledByFieldSettings,
        unavailable_reason: disabledByFieldSettings ? 'field_settings_disabled' : null,
      } as EffectiveField;
    })
    .filter(Boolean)
    .filter((field) => includeDisabled || field.is_enabled)
    .sort((a, b) => a.sort_order - b.sort_order);
  return rows.sort((a, b) => a.sort_order - b.sort_order);
}

async function listAssignees(admin: AdminClient, companyId: string) {
  const { data, error } = await admin
    .from('profiles')
    .select('id, first_name, last_name, full_name, email, role, is_admin_blocked, license_state')
    .eq('company_id', companyId)
    .neq('role', 'client')
    .order('full_name', { ascending: true });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map((row) => ({
    id: String(row.id),
    label:
      normalizeText(row.full_name) ||
      normalizeText([row.last_name, row.first_name].filter(Boolean).join(' ')) ||
      normalizeText(row.email) ||
      'Без имени',
    role: String(row.role || ''),
    is_blocked: row.is_admin_blocked === true || String(row.license_state || '') === 'blocked_by_license',
  }));
}

function buildStartLink(token: string) {
  const username = (Deno.env.get('MAX_BOT_USERNAME') || '').replace(/^@+/, '').trim();
  if (!username || !token) return null;
  return `https://max.ru/${username}?start=${encodeURIComponent(token)}`;
}

async function upsertCompanyFieldSettings(
  admin: AdminClient,
  companyId: string,
  fields: Array<Record<string, unknown>>,
) {
  await admin
    .from('company_messenger_field_settings')
    .delete()
    .eq('company_id', companyId)
    .eq('provider', MAX_PROVIDER);

  const rows = (Array.isArray(fields) ? fields : [])
    .map((field) => {
      const fieldKey = normalizeText(field.field_key);
      const isMandatory = MANDATORY_MAX_FIELD_KEYS.has(fieldKey);
      return {
        field_key: fieldKey,
        company_id: companyId,
        provider: MAX_PROVIDER,
        is_enabled: isMandatory ? true : field.is_enabled !== false,
        is_required: isMandatory,
        sort_order: Number(field.sort_order || 0) || 0,
      };
    })
    .filter((row) => row.field_key && !HIDDEN_MAX_FIELD_KEYS.has(row.field_key));

  if (!rows.length) return;
  const { error } = await admin
    .from('company_messenger_field_settings')
    .upsert(rows, { onConflict: 'company_id,provider,field_key' });
  if (error) throw error;
}

async function handleStatus(req: Request, admin: AdminClient) {
  const caller = await getCallerContext(admin, req);
  const integration = await ensureIntegration(admin, caller.companyId);
  const [fields, assignees] = await Promise.all([
    getEffectiveFields(admin, integration, { includeDisabled: true }),
    listAssignees(admin, caller.companyId),
  ]);
  return json(200, {
    success: true,
    'pattern': 'shared_bot_per_company_link',
    start_link: buildStartLink(integration.onboarding_token),
    webhook_url: getWebhookUrl(),
    config: integration,
    fields,
    assignees,
  });
}

async function handleSaveConfig(req: Request, admin: AdminClient, body: Record<string, unknown>) {
  const caller = await getCallerContext(admin, req);
  const config = (body.config && typeof body.config === 'object' ? body.config : {}) as Record<string, unknown>;
  const current = await ensureIntegration(admin, caller.companyId);
  const destinationType = config.destination_type === 'assignee' ? 'assignee' : 'feed';
  const destinationUserId = normalizeText(config.destination_user_id) || current.destination_user_id || null;

  if (destinationType === 'assignee' && !destinationUserId) {
    return json(400, { success: false, message: 'Нужно выбрать ответственного.' });
  }
  if (
    config.is_enabled === true &&
    !(await hasEnabledFieldInPayload(
      admin,
      caller.companyId,
      Array.isArray(body.fields) ? (body.fields as Array<Record<string, unknown>>) : [],
    ))
  ) {
    return json(400, { success: false, message: BOT_EMPTY_FIELDS_SAVE_ERROR });
  }
  if (destinationUserId) {
    const { data: assignee, error } = await admin
      .from('profiles')
      .select('id')
      .eq('id', destinationUserId)
      .eq('company_id', caller.companyId)
      .maybeSingle();
    if (error) throw error;
    if (!assignee) return json(400, { success: false, message: 'Ответственный не найден в компании.' });
  }

  if (config.is_enabled === true) {
    try {
      await ensureMaxWebhook();
    } catch (error) {
      const message = toErrorMessage(error);
      console.error('[max-bot][ensure-webhook]', message);
      return json(400, { success: false, message });
    }
  }

  const { error } = await admin
    .from('messenger_integrations')
    .upsert(
      {
        ...current,
        company_id: caller.companyId,
        provider: MAX_PROVIDER,
        is_enabled: config.is_enabled === true,
        destination_type: destinationType,
        destination_user_id: destinationUserId,
        create_client: true,
        'existing_client_policy': 'reuse',
        create_object: true,
        'existing_object_policy': 'reuse_or_create',
        welcome_message: normalizeText(config.welcome_message) || null,
        success_message: normalizeText(config.success_message) || null,
        failure_message: normalizeText(config.failure_message) || null,
      },
      { onConflict: 'company_id,provider' },
    );
  if (error) throw error;

  await upsertCompanyFieldSettings(
    admin,
    caller.companyId,
    Array.isArray(body.fields) ? (body.fields as Array<Record<string, unknown>>) : [],
  );

  return await handleStatus(req, admin);
}

async function handleRegenerateToken(req: Request, admin: AdminClient) {
  const caller = await getCallerContext(admin, req);
  await ensureIntegration(admin, caller.companyId);
  const { data, error } = await admin
    .from('messenger_integrations')
    .update({ onboarding_token: crypto.randomUUID().replace(/-/g, '').slice(0, 24) })
    .eq('company_id', caller.companyId)
    .eq('provider', MAX_PROVIDER)
    .select('onboarding_token')
    .single();
  if (error) throw error;
  return json(200, {
    success: true,
    onboarding_token: data.onboarding_token,
    start_link: buildStartLink(String(data.onboarding_token || '')),
  });
}

async function getConversation(admin: AdminClient, chatId: string) {
  const { data, error } = await admin
    .from('messenger_conversations')
    .select('*')
    .eq('provider', MAX_PROVIDER)
    .eq('external_chat_id', chatId)
    .maybeSingle();
  if (error) throw error;
  return (data as ConversationRow | null) || null;
}

async function saveConversation(admin: AdminClient, patch: Record<string, unknown>) {
  const { data, error } = await admin
    .from('messenger_conversations')
    .upsert(patch, { onConflict: 'provider,external_chat_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data as ConversationRow;
}

async function findIntegrationByToken(admin: AdminClient, token: string) {
  const { data, error } = await admin
    .from('messenger_integrations')
    .select('*')
    .eq('provider', MAX_PROVIDER)
    .eq('onboarding_token', token)
    .maybeSingle();
  if (error) throw error;
  return (data as IntegrationRow | null) || null;
}

async function getIntegrationById(admin: AdminClient, integrationId: string) {
  const normalizedId = normalizeText(integrationId);
  if (!normalizedId) return null;
  const { data, error } = await admin
    .from('messenger_integrations')
    .select('*')
    .eq('id', normalizedId)
    .eq('provider', MAX_PROVIDER)
    .maybeSingle();
  if (error) throw error;
  return (data as IntegrationRow | null) || null;
}

function getMaxUpdateId(update: Record<string, unknown>) {
  const message = ((update.message || update.message_created || {}) as Record<string, unknown>) || {};
  const body = (message.body || {}) as Record<string, unknown>;
  const callback = ((update.callback || update.message_callback || {}) as Record<string, unknown>) || {};
  return (
    normalizeText(update.update_id) ||
    normalizeText(update.updateId) ||
    `${normalizeText(update.update_type) || 'update'}:${normalizeText(update.chat_id)}:${normalizeText(update.timestamp)}:${normalizeText(body.mid || callback.callback_id)}`
  );
}

function extractMaxContactPhone(message: Record<string, unknown>) {
  const contact = (message.contact || {}) as Record<string, unknown>;
  const direct = normalizeText(contact.phone_number || contact.phone || message.phone_number || message.phone);
  if (direct) return direct;
  const body = (message.body || {}) as Record<string, unknown>;
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  for (const rawAttachment of attachments) {
    const attachment = (rawAttachment || {}) as Record<string, unknown>;
    const payload = (attachment.payload || {}) as Record<string, unknown>;
    const candidate = normalizeText(payload.phone || payload.phone_number || payload.contact_phone);
    if (candidate) return candidate;
    const vcf = normalizeText(payload.vcf_info || payload.vcard || payload.vcf);
    const match = vcf.match(/TEL[^:\n\r]*:([+\d][^\n\r]*)/i);
    if (match?.[1]) return normalizeText(match[1]);
  }
  return '';
}

function extractMaxMessage(update: Record<string, unknown>) {
  const updateType = normalizeText(update.update_type);
  if (updateType === 'message_callback') return null;
  const message = ((update.message || update.message_created || {}) as Record<string, unknown>) || {};
  const body = (message.body || {}) as Record<string, unknown>;
  const sender = ((message.sender || update.user || message.from || {}) as Record<string, unknown>) || {};
  const recipient = ((message.recipient || {}) as Record<string, unknown>) || {};
  const payload = normalizeText(update.payload);
  const text =
    updateType === 'bot_started'
      ? (payload ? `/start ${payload}` : '/start')
      : normalizeText(body.text || message.text || update.text);
  if (!text && !extractMaxContactPhone(message)) return null;
  const userId = normalizeText(sender.user_id || sender.id || update.user_id || update.chat_id);
  const chatId = normalizeText(update.chat_id || recipient.chat_id || recipient.user_id || userId);
  return {
    updateId: getMaxUpdateId(update),
    messageId: normalizeText(body.mid || body.message_id || message.message_id || message.id),
    chatId,
    chatType: update.is_channel === true ? 'channel' : 'private',
    text,
    userId,
    username: normalizeText(sender.username || sender.name),
    contactPhone: extractMaxContactPhone(message),
    contactUserId: userId,
  };
}

function extractMaxCallback(update: Record<string, unknown>) {
  if (normalizeText(update.update_type) !== 'message_callback' && !update.callback) return null;
  const callback = ((update.callback || update.message_callback || {}) as Record<string, unknown>) || {};
  const message = ((callback.message || update.message || {}) as Record<string, unknown>) || {};
  const body = (message.body || {}) as Record<string, unknown>;
  const sender = ((callback.user || update.user || message.sender || {}) as Record<string, unknown>) || {};
  const recipient = ((message.recipient || {}) as Record<string, unknown>) || {};
  const userId = normalizeText(sender.user_id || sender.id || update.user_id || update.chat_id);
  const chatId = normalizeText(update.chat_id || callback.chat_id || recipient.chat_id || recipient.user_id || userId);
  return {
    updateId: getMaxUpdateId(update),
    callbackId: normalizeText(callback.callback_id || callback.id || update.callback_id),
    chatId,
    chatType: update.is_channel === true ? 'channel' : 'private',
    messageId: normalizeText(body.mid || body.message_id || callback.message_id || message.message_id || message.id),
    userId,
    username: normalizeText(sender.username || sender.name),
    data: normalizeText(callback.payload || callback.data || callback.callback_data || update.payload),
  } as MaxCallback;
}

function extractStartToken(text: string) {
  const trimmed = normalizeText(text);
  if (!trimmed.toLowerCase().startsWith('/start')) return '';
  const parts = trimmed.split(' ').filter(Boolean);
  return parts.length > 1 ? parts[1] : '';
}

async function markUpdateProcessed(admin: AdminClient, updateId: string) {
  if (!updateId) return false;
  const { error } = await admin
    .from('messenger_update_log')
    .insert({ provider: MAX_PROVIDER, external_update_id: updateId });
  if (!error) return true;
  const message = toErrorMessage(error).toLowerCase();
  if (message.includes('duplicate') || message.includes('unique')) return false;
  throw error;
}

function nextField(fields: EffectiveField[], currentFieldKey: string | null) {
  if (!fields.length) return null;
  if (!currentFieldKey) return fields[0];
  const index = fields.findIndex((field) => field.field_key === currentFieldKey);
  return index >= 0 ? fields[index + 1] || null : fields[0];
}

function previousField(fields: EffectiveField[], currentFieldKey: string | null) {
  if (!fields.length) return null;
  if (!currentFieldKey) return null;
  const index = fields.findIndex((field) => field.field_key === currentFieldKey);
  return index > 0 ? fields[index - 1] || null : null;
}

function readConversationState(conversation: ConversationRow | null) {
  const state = (conversation?.state && typeof conversation.state === 'object'
    ? conversation.state
    : {}) as Record<string, unknown>;
  const values = (state.values && typeof state.values === 'object'
    ? state.values
    : {}) as Record<string, string>;
  const ui = (state.ui && typeof state.ui === 'object'
    ? state.ui
    : {}) as Record<string, unknown>;
  return { state, values, ui };
}

function filterValuesByFields(values: Record<string, string>, fields: EffectiveField[] | null | undefined) {
  if (!Array.isArray(fields) || !fields.length) return {};
  const allowedKeys = new Set(fields.map((field) => field.field_key));
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(values || {})) {
    if (allowedKeys.has(key)) next[key] = value;
  }
  return next;
}

function hasClientInput(values: Record<string, string>) {
  return Boolean(
    trimToNull(values.customer_name) ||
    trimToNull(values.phone) ||
    trimToNull(values.secondary_phone) ||
    trimToNull(values.email),
  );
}

function assertRequiredClientValues(values: Record<string, string>) {
  if (!trimToNull(values.customer_name)) {
    throw new Error('CUSTOMER_NAME_REQUIRED');
  }
  if (!toE164PhoneOrNull(values.phone)) {
    throw new Error('CUSTOMER_PHONE_REQUIRED');
  }
}

function buildConversationState(
  values: Record<string, string>,
  ui: Record<string, unknown> = {},
) {
  return { values, ui };
}

function isConversationForIntegration(
  conversation: ConversationRow | null,
  integration: IntegrationRow | null,
) {
  if (!conversation || !integration) return false;
  return (
    normalizeText(conversation.company_id) === normalizeText(integration.company_id) &&
    normalizeText(conversation.integration_id) === normalizeText(integration.id)
  );
}

function getTrackedBotMessageId(conversation: ConversationRow | null) {
  const { ui } = readConversationState(conversation);
  return normalizeText(ui.bot_message_id) || null;
}

function getTrackedConfirmationMessageId(conversation: ConversationRow | null) {
  const { ui } = readConversationState(conversation);
  return normalizeText(ui.confirmation_message_id) || null;
}

function getTrackedProgressMessageId(conversation: ConversationRow | null) {
  const { ui } = readConversationState(conversation);
  return normalizeText(ui.progress_message_id) || null;
}

async function getCompanyDisplayName(admin: AdminClient, companyId: string | null) {
  const normalizedId = normalizeText(companyId);
  if (!normalizedId) return '';
  const { data, error } = await admin
    .from('companies')
    .select('name')
    .eq('id', normalizedId)
    .maybeSingle();
  if (error) throw error;
  return normalizeText(data?.name);
}

async function sendManagedConversationMessage(
  chatId: string,
  conversation: ConversationRow | null,
  text: string,
  options: { keyboard?: Record<string, unknown> | null; inlineKeyboard?: unknown[][] | null; removeKeyboard?: boolean } = {},
) {
  const previousBotMessageId = getTrackedBotMessageId(conversation);
  const previousConfirmationMessageId = getTrackedConfirmationMessageId(conversation);
  if (previousBotMessageId) {
    await safeDeleteMaxMessage(chatId, previousBotMessageId);
  }
  if (previousConfirmationMessageId && previousConfirmationMessageId !== previousBotMessageId) {
    await safeDeleteMaxMessage(chatId, previousConfirmationMessageId);
  }
  const response = await sendMaxMessage(chatId, text, options);
  return extractMaxResponseMessageId(response) || null;
}

function buildProgressText(fields: EffectiveField[], values: Record<string, string>) {
  const summary = buildSummary(fields, values);
  if (!summary) return '';
  return `Уже заполнено:\n\n${summary}`;
}

async function syncProgressMessage(
  chatId: string,
  conversation: ConversationRow,
  fields: EffectiveField[] | null,
  values: Record<string, string>,
  options: { hide?: boolean } = {},
) {
  const { ui } = readConversationState(conversation);
  const previousProgressMessageId = getTrackedProgressMessageId(conversation);
  const text = options.hide || !fields ? '' : buildProgressTextRich(fields, values);

  if (!text) {
    if (previousProgressMessageId) {
      await safeDeleteMaxMessage(chatId, previousProgressMessageId);
    }
    return { ...ui, progress_message_id: null };
  }

  if (previousProgressMessageId) {
    try {
      await editMaxMessageText(chatId, previousProgressMessageId, text);
      return { ...ui, progress_message_id: previousProgressMessageId };
    } catch {
      await safeDeleteMaxMessage(chatId, previousProgressMessageId);
    }
  }

  const response = await sendMaxMessage(chatId, text);
  return {
    ...ui,
    progress_message_id: extractMaxResponseMessageId(response) || null,
  };
}

function buildSummary(fields: EffectiveField[], values: Record<string, string>) {
  return fields
    .filter((field) => normalizeText(values[field.field_key]))
    .map((field) => `${field.label}: ${formatFieldValueForPreview(field, values[field.field_key] || '')}`)
    .join('\n');
}

function formatFieldValueForPreview(field: EffectiveField, value: string) {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  if (field.input_kind === 'phone') return formatPhoneMask(normalized) || normalized;
  return normalized;
}

function getConfirmationFieldLabel(field: EffectiveField) {
  if (field.field_key === 'customer_name') return '\u0418\u043c\u044f';
  return field.label;
}

function buildSummaryRich(fields: EffectiveField[], values: Record<string, string>) {
  return fields
    .filter((field) => normalizeText(values[field.field_key]))
    .map((field) => `<b>${escapeHtml(getConfirmationFieldLabel(field))}:</b> ${escapeHtml(formatFieldValueForPreview(field, values[field.field_key] || ''))}`)
    .join('\n');
}

function buildProgressTextRich(fields: EffectiveField[], values: Record<string, string>) {
  const summary = buildSummaryRich(fields, values);
  if (!summary) return '';
  return `<b><u>Ваши данные</u></b>\n\n${summary}`;
}

function buildFieldPromptRich(
  fields: EffectiveField[],
  field: EffectiveField,
  values: Record<string, string>,
  options: { prefix?: string | null } = {},
) {
  const index = fields.findIndex((item) => item.field_key === field.field_key);
  const step = index >= 0 ? index + 1 : 1;
  const total = fields.length || 1;
  const currentValue = formatFieldValueForPreview(field, values[field.field_key] || '');
  const parts = [`<b>Шаг ${step} из ${total}</b>`];
  if (normalizeText(options.prefix)) parts.push(escapeHtml(normalizeText(options.prefix)));
  parts.push(escapeHtml(field.prompt));
  if (field.input_kind === 'phone') {
    parts.push('Введите нормер телефона в формате +79876543210');
  }
  if (currentValue) parts.push(`<b>Сейчас:</b> ${escapeHtml(currentValue)}`);
  return parts.filter(Boolean).join('\n\n');
}

function buildConfirmationValidationNoteRich(ui: Record<string, unknown>) {
  const note = normalizeText(ui.address_validation_note);
  if (!note) return '';
  return `<i>[${escapeHtml(note)}]</i>`;
}

function buildConfirmationTextRich(
  fields: EffectiveField[],
  values: Record<string, string>,
  validationNoteRich = '',
) {
  const note = String(validationNoteRich || '').trim();
  return `<b>\u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u0434\u0430\u043d\u043d\u044b\u0435</b>\n\n${buildSummaryRich(fields, values)}${note ? `\n\n${note}` : ''}\n\n\u0415\u0441\u043b\u0438 \u0432\u0441\u0451 \u0432\u0435\u0440\u043d\u043e, \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435 \u0441\u043e\u0437\u0434\u0430\u043d\u0438\u0435 \u0437\u0430\u044f\u0432\u043a\u0438 \u0438\u043b\u0438 \u043d\u0430\u0436\u043c\u0438\u0442\u0435 \u043d\u0430 \u043f\u0443\u043d\u043a\u0442, \u043a\u043e\u0442\u043e\u0440\u044b\u0439 \u0445\u043e\u0442\u0438\u0442\u0435 \u043e\u0442\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c`;
}

function buildPostSubmitNoticeText(
  integration: IntegrationRow,
  result: { addressText?: string | null },
) {
  const base =
    integration.success_message ||
    `\u0413\u043e\u0442\u043e\u0432\u043e. \u0417\u0430\u044f\u0432\u043a\u0430 \u0441\u043e\u0437\u0434\u0430\u043d\u0430${result.addressText ? ` \u043f\u043e \u0430\u0434\u0440\u0435\u0441\u0443: ${result.addressText}` : ''}.`;
  return `${base}\n\n\u041d\u0430\u0436\u043c\u0438\u0442\u0435 \u00ab${CREATE_NEW_REQUEST_TEXT}\u00bb, \u0447\u0442\u043e\u0431\u044b \u0441\u043e\u0437\u0434\u0430\u0442\u044c \u0435\u0449\u0451 \u043e\u0434\u043d\u0443 \u0437\u0430\u044f\u0432\u043a\u0443.`;
}

function buildFieldPromptText(
  fields: EffectiveField[],
  field: EffectiveField,
  values: Record<string, string>,
  options: { prefix?: string | null } = {},
) {
  const index = fields.findIndex((item) => item.field_key === field.field_key);
  const step = index >= 0 ? index + 1 : 1;
  const total = fields.length || 1;
  const currentValue = formatFieldValueForPreview(field, values[field.field_key] || '');
  const parts = [`Шаг ${step} из ${total}`];
  if (normalizeText(options.prefix)) parts.push(normalizeText(options.prefix));
  parts.push(field.prompt);
  if (field.input_kind === 'phone') {
    parts.push('Введите нормер телефона в формате +79876543210');
  }
  if (currentValue) parts.push(`Сейчас: ${currentValue}`);
  return parts.filter(Boolean).join('\n\n');
}

function buildConfirmationInlineKeyboard(
  fields: EffectiveField[],
  values: Record<string, string>,
  menu: 'main' | 'address' = 'main',
) {
  const enabledAddressFields = fields.filter((field) => ADDRESS_FIELD_KEYS.has(field.field_key));
  const editableFields = fields.filter((field) => normalizeText(values[field.field_key]));
  const mainEditableFields = editableFields.filter((field) => !ADDRESS_FIELD_KEYS.has(field.field_key));
  const addressMenuFields = enabledAddressFields.filter((field) =>
    field.is_enabled || normalizeText(values[field.field_key]),
  );
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];

  if (menu === 'address') {
    for (let index = 0; index < addressMenuFields.length; index += 2) {
      rows.push(
        addressMenuFields.slice(index, index + 2).map((field) => ({
          text: getConfirmationFieldLabel(field),
          callback_data: `edit:${field.field_key}`,
        })),
      );
    }
    rows.push([{ text: BACK_TEXT, callback_data: 'confirm:menu_main' }]);
    rows.push([{ text: CANCEL_TEXT, callback_data: 'confirm:cancel' }]);
    return rows;
  }

  for (let index = 0; index < mainEditableFields.length; index += 2) {
    rows.push(
      mainEditableFields.slice(index, index + 2).map((field) => ({
        text: getConfirmationFieldLabel(field),
        callback_data: `edit:${field.field_key}`,
      })),
    );
  }
  if (addressMenuFields.length) {
    rows.push([{ text: '\u0410\u0434\u0440\u0435\u0441', callback_data: 'confirm:address_menu' }]);
  }
  rows.push([{ text: CONFIRM_TEXT, callback_data: 'confirm:submit' }]);
  rows.push([{ text: RESTART_TEXT, callback_data: 'confirm:restart' }]);
  rows.push([{ text: CANCEL_TEXT, callback_data: 'confirm:cancel' }]);
  return rows;
}

function currentCompanyStartHint(integration: IntegrationRow | null) {
  const link = integration ? buildStartLink(integration.onboarding_token) : null;
  if (!link) return '\u041e\u0442\u043a\u0440\u043e\u0439\u0442\u0435 \u0441\u0441\u044b\u043b\u043a\u0443 \u0438\u0437 \u043d\u0443\u0436\u043d\u043e\u0439 \u043a\u043e\u043c\u043f\u0430\u043d\u0438\u0438, \u0447\u0442\u043e\u0431\u044b \u043d\u0430\u0447\u0430\u0442\u044c \u0438\u043c\u0435\u043d\u043d\u043e \u0435\u0451 \u0437\u0430\u044f\u0432\u043a\u0443.';
  return `\u0427\u0442\u043e\u0431\u044b \u043f\u0435\u0440\u0435\u043a\u043b\u044e\u0447\u0438\u0442\u044c\u0441\u044f \u043d\u0430 \u0434\u0440\u0443\u0433\u0443\u044e \u043a\u043e\u043c\u043f\u0430\u043d\u0438\u044e, \u043e\u0442\u043a\u0440\u043e\u0439\u0442\u0435 \u0435\u0451 \u0441\u0441\u044b\u043b\u043a\u0443: ${link}`;
}

function getDirectStartNoticeText() {
  return 'Чтобы оставить заявку, получите ссылку у компании и откройте бота по этой ссылке.';
}

const PATRONYMIC_SUFFIXES = [
  'ович', 'евич', 'ич', 'оглы', 'улы',
  'овна', 'евна', 'ична', 'инична', 'кызы',
];

const PATRONYMIC_MARKER_TOKENS = ['оглы', 'улы', 'уулу', 'кызы'];

const SURNAME_SUFFIXES = [
  'ов', 'ова', 'ев', 'ева', 'ёв', 'ёва', 'ин', 'ина', 'ын', 'ына',
  'ский', 'ская', 'цкий', 'цкая', 'енко', 'ко', 'ук', 'юк', 'як',
  'ич', 'вич', 'ичус', 'ян', 'янц', 'дзе', 'швили', 'оглы', 'кызы',
];

function tokenizeCustomerName(raw: string) {
  const prepared = normalizeText(raw)
    .replace(/([\p{L}])\.\s*([\p{L}])\.?/gu, '$1. $2.')
    .replace(/[,\n\r;()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!prepared) return [] as string[];

  return prepared
    .split(' ')
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.-]+$/gu, ''))
    .filter(Boolean);
}

function isInitialToken(token: string) {
  const compact = normalizeText(token).replace(/\./g, '');
  return compact.length === 1 && /^\p{L}$/u.test(compact);
}

function isPatronymicToken(token: string) {
  const normalized = normalizeText(token).replace(/\./g, '').toLowerCase();
  if (!normalized || isInitialToken(normalized)) return false;
  if (PATRONYMIC_MARKER_TOKENS.includes(normalized)) return true;
  return PATRONYMIC_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function isPatronymicMarkerToken(token: string) {
  const normalized = normalizeText(token).replace(/\./g, '').toLowerCase();
  return PATRONYMIC_MARKER_TOKENS.includes(normalized);
}

function looksLikeSurnameToken(token: string) {
  const normalized = normalizeText(token).replace(/\./g, '').toLowerCase();
  if (!normalized || isInitialToken(normalized) || isPatronymicToken(normalized)) return false;
  const parts = normalized.split('-').filter(Boolean);
  const candidate = parts[parts.length - 1] || normalized;
  return SURNAME_SUFFIXES.some((suffix) => candidate.endsWith(suffix));
}

function buildNameCandidate(first_name: string, last_name: string, middle_name: string | null) {
  return {
    first_name: normalizeText(first_name),
    last_name: normalizeText(last_name),
    middle_name: trimToNull(middle_name),
  };
}

function scoreNameCandidate(candidate: { first_name: string; last_name: string; middle_name: string | null }) {
  let score = 0;
  if (candidate.first_name) score += 2;
  if (candidate.last_name) score += 1;

  if (candidate.first_name && !isInitialToken(candidate.first_name)) score += 1;
  if (candidate.last_name && looksLikeSurnameToken(candidate.last_name)) score += 3;
  if (candidate.first_name && looksLikeSurnameToken(candidate.first_name)) score -= 2;
  if (candidate.last_name && isInitialToken(candidate.last_name)) score -= 4;
  if (candidate.first_name && isPatronymicToken(candidate.first_name)) score -= 5;
  if (candidate.last_name && isPatronymicToken(candidate.last_name)) score -= 6;

  if (candidate.middle_name) {
    const middleParts = tokenizeCustomerName(candidate.middle_name);
    if (middleParts.some((part) => isPatronymicToken(part))) score += 6;
    if (middleParts.every((part) => isInitialToken(part))) score += 1;
  }

  return score;
}

function splitCustomerName(raw: string) {
  const parts = tokenizeCustomerName(raw);
  if (!parts.length) return buildNameCandidate('', '', null);
  if (parts.length === 1) return buildNameCandidate(parts[0], '', null);

  if (parts.length === 3 && isPatronymicMarkerToken(parts[1])) {
    return buildNameCandidate(parts[2], '', `${parts[0]} ${parts[1]}`);
  }

  if (parts.length === 3 && isPatronymicMarkerToken(parts[2])) {
    return buildNameCandidate(parts[0], '', `${parts[1]} ${parts[2]}`);
  }

  if (parts.length === 2) {
    const [first, second] = parts;
    if (isPatronymicToken(second)) return buildNameCandidate(first, '', second);
    if (isPatronymicToken(first)) return buildNameCandidate(second, '', first);
  }

  const candidates = [
    buildNameCandidate(parts[1] || parts[0], parts[0] || '', parts.length > 2 ? parts.slice(2).join(' ') : null),
    buildNameCandidate(parts[0], parts[1] || '', parts.length > 2 ? parts.slice(2).join(' ') : null),
  ];

  if (parts.length >= 3) {
    candidates.push(buildNameCandidate(parts[0], parts[parts.length - 1], parts.slice(1, -1).join(' ')));
  }

  candidates.sort((left, right) => scoreNameCandidate(right) - scoreNameCandidate(left));
  return candidates[0];
}

const NAME_EQUIVALENTS: Record<string, string> = {
  'саша': 'александр',
  'саня': 'александр',
  'alex': 'александр',
  'алекс': 'александр',
  'лёша': 'алексей',
  'леша': 'алексей',
  'дима': 'дмитрий',
  'миша': 'михаил',
  'серёжа': 'сергей',
  'сережа': 'сергей',
  'вова': 'владимир',
  'женя': 'евгений',
  'катя': 'екатерина',
  'оля': 'ольга',
};

function normalizeNameTokenForCompare(raw: unknown) {
  const token = normalizeText(raw)
    .toLowerCase()
    .replace(/\u0451/g, '\u0435')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .trim();
  if (!token) return '';
  return NAME_EQUIVALENTS[token] || token;
}

function nameTokenSimilarity(leftRaw: unknown, rightRaw: unknown) {
  const left = normalizeNameTokenForCompare(leftRaw);
  const right = normalizeNameTokenForCompare(rightRaw);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length === 1 || right.length === 1) return left[0] === right[0] ? 0.85 : 0;
  if (left.length >= 3 && right.length >= 3 && (left.startsWith(right) || right.startsWith(left))) {
    return 0.9;
  }
  const similarity = similarityScore(left, right);
  if (left.length >= 4 && right.length >= 4 && left.slice(0, 4) === right.slice(0, 4)) {
    return Math.max(similarity, 0.82);
  }
  return similarity;
}

function buildClientNameFromRow(row: Record<string, unknown> | null) {
  if (!row) return '';
  return [row.last_name, row.first_name, row.middle_name]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(' ')
    .trim();
}

function compareClientNamesSmart(inputNameRaw: unknown, dbNameRaw: unknown) {
  const inputTokens = tokenizeCustomerName(String(inputNameRaw || ''))
    .map((token) => normalizeNameTokenForCompare(token))
    .filter(Boolean);
  const dbTokens = tokenizeCustomerName(String(dbNameRaw || ''))
    .map((token) => normalizeNameTokenForCompare(token))
    .filter(Boolean);

  if (!inputTokens.length || !dbTokens.length) return 'uncertain' as const;

  const meaningfulInput = inputTokens.filter((token) => token.length > 1 || /^[\p{L}\p{N}]$/u.test(token));
  if (!meaningfulInput.length) return 'uncertain' as const;

  let strongMatches = 0;
  let weakMatches = 0;
  let misses = 0;

  for (const token of meaningfulInput) {
    if (token.length === 1) {
      const hasInitialMatch = dbTokens.some((candidate) => candidate.startsWith(token));
      if (hasInitialMatch) weakMatches += 1;
      else misses += 1;
      continue;
    }

    const best = dbTokens.reduce((score, candidate) => {
      const next = nameTokenSimilarity(token, candidate);
      return next > score ? next : score;
    }, 0);

    if (best >= 0.9) strongMatches += 1;
    else if (best >= 0.76) weakMatches += 1;
    else misses += 1;
  }

  const total = meaningfulInput.length || 1;
  const coverage = (strongMatches + weakMatches * 0.6) / total;

  if (coverage >= 0.75) return 'match' as const;
  if (misses === total || coverage <= 0.35) return 'mismatch' as const;
  return 'uncertain' as const;
}

async function buildClientNameDiscrepancyNote(
  admin: AdminClient,
  companyId: string,
  clientId: string | null,
  values: Record<string, string>,
) {
  const enteredName = normalizeText(values.customer_name);
  const phone = trimToNull(values.phone);
  if (!enteredName || !phone || !clientId) return null;

  const matchedByPhone = await findExistingClient(admin, companyId, phone);
  if (!matchedByPhone?.id || String(matchedByPhone.id) !== String(clientId)) return null;

  const { data: clientRow, error } = await admin
    .from('clients')
    .select('id, first_name, last_name, middle_name')
    .eq('id', clientId)
    .maybeSingle();
  if (error) throw error;
  const dbName = buildClientNameFromRow(clientRow as Record<string, unknown> | null);
  if (!dbName) return null;

  const verdict = compareClientNamesSmart(enteredName, dbName);
  if (verdict === 'match') return null;
  if (verdict === 'mismatch') {
    return `[ _Клиент указал другое имя: "${enteredName}" (в базе: "${dbName}")._ ]`;
  }
  return `[ _Клиент указал имя: "${enteredName}". Не удалось однозначно сопоставить с именем в базе: "${dbName}"._ ]`;
}

const ADDRESS_TEXT_MATCH_FIELDS = ['country', 'region', 'district', 'city', 'street', 'postal_code'] as const;
const ADDRESS_EXACT_MATCH_FIELDS = ['house', 'entrance', 'apartment', 'floor'] as const;
const ADDRESS_STREET_SYNONYMS = new Map<string, string>([
  ['ул', 'улица'],
  ['ул.', 'улица'],
  ['пр', 'проспект'],
  ['пр.', 'проспект'],
  ['пр-т', 'проспект'],
  ['просп', 'проспект'],
  ['д', 'дом'],
  ['д.', 'дом'],
]);

function normalizeAddressTextForMatch(raw: unknown) {
  const base = normalizeText(raw)
    .toLowerCase()
    .replace(/\u0451/g, '\u0435')
    .replace(/[.,/#!$%^&*;:{}=_`~()"'\[\]-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) return '';
  return base
    .split(' ')
    .map((token) => ADDRESS_STREET_SYNONYMS.get(token) || token)
    .join(' ')
    .trim();
}

function normalizeAddressNumberLike(raw: unknown) {
  return normalizeText(raw)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^\p{L}\p{N}/-]+/gu, '');
}

function buildAddressForMatch(addressLike: Record<string, unknown>) {
  const normalized: Record<string, string> = {};
  for (const field of ADDRESS_TEXT_MATCH_FIELDS) {
    normalized[field] = normalizeAddressTextForMatch(addressLike?.[field]);
  }
  for (const field of ADDRESS_EXACT_MATCH_FIELDS) {
    normalized[field] = normalizeAddressNumberLike(addressLike?.[field]);
  }
  return normalized;
}

function buildAddressShortForPrompt(addressLike: Record<string, unknown>) {
  return [addressLike?.city, addressLike?.street, addressLike?.house]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(', ')
    .trim();
}

async function applyAddressValidationForConfirmation(
  admin: AdminClient,
  integration: IntegrationRow,
  values: Record<string, string>,
  ui: Record<string, unknown>,
) {
  const nextValues = { ...values };
  const nextUi = { ...ui };

  if (nextUi.address_manual_override === true) {
    nextUi.address_autocorrect_applied = false;
    return { values: nextValues, ui: nextUi };
  }

  const phone = trimToNull(values.phone);
  if (!phone) {
    nextUi.address_validation_note = null;
    nextUi.address_autocorrect_applied = false;
    return { values: nextValues, ui: nextUi };
  }

  const matchedClient = await findExistingClient(admin, integration.company_id, phone);
  const clientId = normalizeText(matchedClient?.id);
  if (!clientId) {
    nextUi.address_validation_note = null;
    nextUi.address_autocorrect_applied = false;
    return { values: nextValues, ui: nextUi };
  }

  const { data: objectRows, error } = await admin
    .from('client_objects')
    .select('id, country, region, district, city, street, house, postal_code, floor, entrance, apartment')
    .eq('client_id', clientId)
    .limit(300);
  if (error) throw error;

  const objects = Array.isArray(objectRows) ? objectRows : [];
  if (!objects.length) {
    nextUi.address_validation_note = null;
    nextUi.address_autocorrect_applied = false;
    return { values: nextValues, ui: nextUi };
  }

  const draft = buildAddressForMatch(values as Record<string, unknown>);
  if (!draft.street || !draft.house) {
    nextUi.address_validation_note = null;
    nextUi.address_autocorrect_applied = false;
    return { values: nextValues, ui: nextUi };
  }

  let bestMatch: {
    row: Record<string, unknown>;
    score: number;
    streetScore: number;
    cityScore: number;
  } | null = null;

  for (const objectRow of objects) {
    const candidate = buildAddressForMatch(objectRow as Record<string, unknown>);
    if (!candidate.street || !candidate.house) continue;
    if (candidate.house !== draft.house) continue;

    const streetScore = similarityScore(draft.street, candidate.street);
    const cityScore = draft.city && candidate.city ? similarityScore(draft.city, candidate.city) : 0.82;
    const score = streetScore * 0.72 + cityScore * 0.28;

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        row: objectRow as Record<string, unknown>,
        score,
        streetScore,
        cityScore,
      };
    }
  }

  if (!bestMatch) {
    nextUi.address_validation_note = null;
    nextUi.address_autocorrect_applied = false;
    return { values: nextValues, ui: nextUi };
  }

  const shouldAutocorrect =
    bestMatch.score >= 0.92 &&
    bestMatch.streetScore >= 0.93 &&
    bestMatch.cityScore >= 0.9;

  if (shouldAutocorrect) {
    let changed = false;
    for (const field of [...ADDRESS_TEXT_MATCH_FIELDS, ...ADDRESS_EXACT_MATCH_FIELDS]) {
      const fromDb = normalizeText(bestMatch.row?.[field]);
      if (!fromDb) continue;
      if (normalizeText(nextValues[field]) === fromDb) continue;
      nextValues[field] = fromDb;
      changed = true;
    }
    if (changed) {
      nextUi.address_autocorrect_applied = true;
      nextUi.address_validation_note = `Адрес уточнен автоматически: ${buildAddressShortForPrompt(bestMatch.row)}.`;
      return { values: nextValues, ui: nextUi };
    }
    nextUi.address_validation_note = null;
    nextUi.address_autocorrect_applied = false;
    return { values: nextValues, ui: nextUi };
  }

  const shouldWarn =
    bestMatch.score >= 0.74 &&
    bestMatch.streetScore >= 0.68 &&
    bestMatch.cityScore >= 0.62;

  if (shouldWarn) {
    nextUi.address_validation_note = `Проверьте адрес: возможно имелся в виду «${buildAddressShortForPrompt(bestMatch.row)}».`;
    nextUi.address_autocorrect_applied = false;
    return { values: nextValues, ui: nextUi };
  }

  nextUi.address_validation_note = null;
  nextUi.address_autocorrect_applied = false;
  return { values: nextValues, ui: nextUi };
}

async function moveConversationToConfirmation(
  admin: AdminClient,
  conversation: ConversationRow,
  integration: IntegrationRow,
  values: Record<string, string>,
  ui: Record<string, unknown>,
) {
  const prepared = await applyAddressValidationForConfirmation(admin, integration, values, ui);
  return saveConversation(admin, {
    ...conversation,
    'status': 'confirming',
    current_field_key: null,
    state: buildConversationState(prepared.values, {
      ...prepared.ui,
      return_to_confirmation: false,
    }),
    last_message_at: new Date().toISOString(),
  });
}

function titleFromValues(values: Record<string, string>) {
  const customerName = normalizeText(values.customer_name);
  const address = buildObjectSummary(values);
  if (customerName && address) return `\u0417\u0430\u044f\u0432\u043a\u0430 \u043e\u0442 ${customerName}: ${address}`;
  if (customerName) return `\u0417\u0430\u044f\u0432\u043a\u0430 \u043e\u0442 ${customerName}`;
  if (address) return `\u0417\u0430\u044f\u0432\u043a\u0430: ${address}`;
  return '\u041d\u043e\u0432\u0430\u044f \u0437\u0430\u044f\u0432\u043a\u0430';
}

function mapFieldValue(field: EffectiveField, text: string, contactPhone: string) {
  const value = field.input_kind === 'phone' && contactPhone ? contactPhone : text;
  if (!value && field.is_required) {
    return { ok: false, message: `Поле "${field.label}" нельзя оставить пустым.` };
  }
  if (!value && !field.is_required) return { ok: true, value: '' };
  if (field.input_kind === 'phone') {
    const e164 = toE164PhoneOrNull(value);
    if (!e164) {
      const suggestion = formatPhoneMask(value);
      return {
        ok: false,
        message: suggestion
          ? `Не получилось распознать телефон. Проверьте номер. Возможно, это ${suggestion}.`
          : 'Не получилось распознать телефон. Введите его в формате +7 (999) 123-45-67.',
      };
    }
    return { ok: true, value: e164 };
  }
  return { ok: true, value: normalizeText(value) };
}

async function findExistingClient(admin: AdminClient, companyId: string, phone: string) {
  if (!phone) return null;
  const normalizedPhone = String(phone).trim();
  const { data, error } = await admin.rpc('find_company_client_by_phone', {
    p_company_id: companyId,
    p_phone: normalizedPhone,
  });
  if (!error) {
    const row = Array.isArray(data) ? data[0] : data;
    if (row) return row;
  }

  // Fallback when RPC is unavailable/missing or does not find a match.
  const { data: fallbackRows, error: fallbackError } = await admin
    .from('clients')
    .select('id, phone')
    .eq('company_id', companyId)
    .limit(2000);
  if (fallbackError) {
    if (error) throw error;
    throw fallbackError;
  }
  const targetDigits = normalizePhoneDigits(normalizedPhone);
  return (Array.isArray(fallbackRows) ? fallbackRows : []).find(
    (row) => normalizePhoneDigits(row?.phone) === targetDigits,
  ) || null;
}

async function findExistingClientByIdentity(
  admin: AdminClient,
  companyId: string,
  values: Record<string, string>,
) {
  const phone = trimToNull(values.phone);
  if (phone) {
    const byPhone = await findExistingClient(admin, companyId, phone);
    if (byPhone) return byPhone;
  }

  const name = splitCustomerName(values.customer_name);
  const firstName = trimToNull(name.first_name);
  const lastName = trimToNull(name.last_name);
  const middleName = trimToNull(name.middle_name);
  const email = trimToNull(values.email);

  const hasIdentity = Boolean(firstName || lastName || middleName || email);
  if (!hasIdentity) return null;

  let query = admin
    .from('clients')
    .select('id, phone, first_name, last_name, middle_name, email, created_at')
    .eq('company_id', companyId);

  if (firstName) query = query.eq('first_name', firstName);
  if (lastName) query = query.eq('last_name', lastName);
  if (middleName) query = query.eq('middle_name', middleName);
  if (email) query = query.eq('email', email);

  const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length ? data[0] : null;
}

async function enrichExistingClientIfNeeded(
  admin: AdminClient,
  clientId: string,
  values: Record<string, string>,
) {
  const secondaryPhone = trimToNull(values.secondary_phone);
  const email = trimToNull(values.email);
  const comment = trimToNull(values.comment);

  if (!secondaryPhone && !email && !comment) return;

  const { data: client, error: clientError } = await admin
    .from('clients')
    .select('id, phone, email, comment, additional_phone_1, additional_phone_1_label')
    .eq('id', clientId)
    .maybeSingle();
  if (clientError) throw clientError;
  if (!client?.id) return;

  const patch: Record<string, string | null> = {};
  const primaryPhoneDigits = normalizePhoneDigits(client.phone);
  const additionalPhoneDigits = normalizePhoneDigits(client.additional_phone_1);
  const nextSecondaryDigits = normalizePhoneDigits(secondaryPhone);

  if (
    secondaryPhone &&
    nextSecondaryDigits &&
    nextSecondaryDigits !== primaryPhoneDigits &&
    !additionalPhoneDigits
  ) {
    patch.additional_phone_1 = secondaryPhone;
    patch.additional_phone_1_label = client.additional_phone_1_label || 'Доп. телефон';
  }

  if (email && !trimToNull(client.email)) {
    patch.email = email;
  }

  if (comment && !trimToNull(client.comment)) {
    patch.comment = comment;
  }

  if (!Object.keys(patch).length) return;

  const { error: updateError } = await admin
    .from('clients')
    .update(patch)
    .eq('id', clientId);
  if (updateError) throw updateError;
}

async function createClientIfNeeded(admin: AdminClient, integration: IntegrationRow, values: Record<string, string>) {
  assertRequiredClientValues(values);
  if (!hasClientInput(values)) return null;
  const existing = await findExistingClientByIdentity(admin, integration.company_id, values);
  if (existing) {
    const clientId = String(existing.id);
    await enrichExistingClientIfNeeded(admin, clientId, values);
    return clientId;
  }
  const name = splitCustomerName(values.customer_name);
  const secondaryPhone = trimToNull(values.secondary_phone);
  const { data, error } = await admin
    .from('clients')
    .insert({
      company_id: integration.company_id,
      first_name: name.first_name,
      last_name: name.last_name,
      middle_name: name.middle_name,
      phone: trimToNull(values.phone),
      additional_phone_1: secondaryPhone,
      additional_phone_1_label: secondaryPhone ? 'Доп. телефон' : null,
      email: trimToNull(values.email),
      comment: trimToNull(values.comment),
    })
    .select('id')
    .single();
  if (error) {
    if (!isUniqueViolation(error)) throw error;
    const conflictClient = await findExistingClientByIdentity(admin, integration.company_id, values);
    if (!conflictClient?.id) throw error;
    const clientId = String(conflictClient.id);
    await enrichExistingClientIfNeeded(admin, clientId, values);
    return clientId;
  }
  return String(data.id);
}

async function findExistingObject(admin: AdminClient, clientId: string, values: Record<string, string>) {
  const { data, error } = await admin
    .from('client_objects')
    .select('id, country, region, district, city, street, house, postal_code, floor, entrance, apartment')
    .eq('client_id', clientId);
  if (error) throw error;
  const incoming = Object.fromEntries(
    OBJECT_MATCH_FIELD_KEYS.map((key) => [key, normalizeText(values[key])]),
  ) as Record<string, string>;
  return (Array.isArray(data) ? data : []).find((row) =>
    OBJECT_MATCH_FIELD_KEYS.every((key) => normalizeText(row?.[key]) === incoming[key]),
  ) || null;
}

async function createObjectIfNeeded(admin: AdminClient, integration: IntegrationRow, clientId: string | null, values: Record<string, string>) {
  const createObjectAllowed = integration.create_object !== false;
  const existingObjectPolicy =
    integration.existing_object_policy === 'always_create' ? 'always_create' : 'reuse_or_create';
  const address = {
    country: normalizeText(values.country),
    region: normalizeText(values.region),
    district: normalizeText(values.district),
    city: normalizeText(values.city),
    street: normalizeText(values.street),
    house: normalizeText(values.house),
    postal_code: normalizeText(values.postal_code),
    apartment: normalizeText(values.apartment),
    entrance: normalizeText(values.entrance),
    floor: normalizeText(values.floor),
    comment: normalizeText(values.entrance_info),
    entrance_info: normalizeText(values.entrance_info),
    parking_notes: normalizeText(values.parking_notes),
  };
  const objectName = buildObjectSummary(address) || 'Объект';
  if (!createObjectAllowed || !clientId || !buildObjectSummary(address)) {
    return { objectId: null, address, addressMode: 'custom', objectName };
  }
  if (existingObjectPolicy !== 'always_create') {
    const existing = await findExistingObject(admin, clientId, address);
    if (existing) {
      return { objectId: String(existing.id), address, addressMode: 'object', objectName };
    }
  }
  const { data, error } = await admin
    .from('client_objects')
    .insert({
      client_id: clientId,
      company_id: integration.company_id,
      name: objectName,
      'location_mode': 'address',
      country: address.country || null,
      region: address.region || null,
      district: address.district || null,
      city: address.city || null,
      street: address.street || null,
      house: address.house || null,
      postal_code: address.postal_code || null,
      apartment: address.apartment || null,
      entrance: address.entrance || null,
      floor: address.floor || null,
      comment: address.comment || null,
    })
    .select('id, name')
    .single();
  if (error) {
    if (!isUniqueViolation(error)) throw error;
    const conflictObject = await findExistingObject(admin, clientId, address);
    if (!conflictObject?.id) throw error;
    return {
      objectId: String(conflictObject.id),
      address,
      'addressMode': 'object',
      objectName: normalizeText(conflictObject.name) || objectName,
    };
  }
  return { objectId: String(data.id), address, addressMode: 'object', objectName: normalizeText(data.name) || objectName };
}

async function createOrderFromConversation(
  admin: AdminClient,
  integration: IntegrationRow,
  values: Record<string, string>,
  fields: EffectiveField[] = [],
) {
  const activeValues = filterValuesByFields(values, fields);
  assertRequiredClientValues(activeValues);
  const clientId = await createClientIfNeeded(admin, integration, activeValues);
  const object = await createObjectIfNeeded(admin, integration, clientId, activeValues);
  const nameDiscrepancyNote = await buildClientNameDiscrepancyNote(
    admin,
    integration.company_id,
    clientId,
    activeValues,
  );
  const finalComment = appendOrderCommentNote(activeValues.comment, nameDiscrepancyNote);
  const assignedTo =
    integration.destination_type === 'assignee'
      ? normalizeUuidOrNull(integration.destination_user_id)
      : null;
  const { data: company, error: companyError } = await admin
    .from('companies')
    .select('currency, use_order_statuses, feed_status_enabled')
    .eq('id', integration.company_id)
    .maybeSingle();
  if (companyError) throw companyError;
  const useCompanyStatuses = company?.use_order_statuses === true;
  const statusCandidates = useCompanyStatuses
    ? [assignedTo ? 'new' : company?.feed_status_enabled === true ? 'feed' : 'new']
    : [NEW_STATUS];
  let createdOrderId: string | null = null;
  let lastInsertError: unknown = null;

  for (let index = 0; index < statusCandidates.length; index += 1) {
    const status = statusCandidates[index];
    const { data, error } = await admin
      .from('orders')
      .insert({
        company_id: integration.company_id,
        title: titleFromValues(activeValues),
        comment: finalComment,
        phone: trimToNull(activeValues.phone),
        client_id: clientId,
        object_id: object.objectId,
        address_mode: object.addressMode,
        country: object.address.country || null,
        region: object.address.region || null,
        district: object.address.district || null,
        city: object.address.city || null,
        street: object.address.street || null,
        house: object.address.house || null,
        postal_code: object.address.postal_code || null,
        floor: object.address.floor || null,
        entrance: object.address.entrance || null,
        apartment: object.address.apartment || null,
        entrance_info: object.address.entrance_info || object.address.comment || null,
        parking_notes: object.address.parking_notes || null,
        assigned_to: assignedTo,
        status,
        urgent: false,
        currency: company?.currency || null,
        'creation_source': 'max',
      })
      .select('id')
      .single();

    if (!error && data?.id) {
      createdOrderId = String(data.id);
      break;
    }

    lastInsertError = error;
    const canRetryWithLegacyStatus =
      assignedTo &&
      index === 0 &&
      status === NEW_STATUS &&
      isOrderStatusConstraintError(error);
    if (!canRetryWithLegacyStatus) {
      throw error;
    }
  }

  if (!createdOrderId) throw lastInsertError || new Error('ORDER_CREATE_FAILED');
  return { orderId: createdOrderId, clientId, objectId: object.objectId, addressText: buildFullAddress(object.address) };
}

async function promptField(
  admin: AdminClient,
  conversation: ConversationRow,
  chatId: string,
  fields: EffectiveField[],
  field: EffectiveField,
  values: Record<string, string>,
  options: { prefix?: string | null } = {},
) {
  const nextUi = await syncProgressMessage(chatId, conversation, fields, values);
  const currentValue = normalizeText(values[field.field_key]);
  const { ui } = readConversationState(conversation);
  const editMode = ui.return_to_confirmation === true;
  const botMessageId = await sendManagedConversationMessage(
    chatId,
    conversation,
    buildFieldPromptRich(fields, field, values, options),
    {
      keyboard:
        field.input_kind === 'phone'
          ? phoneKeyboard(field.is_required, !!currentValue, editMode)
          : conversationKeyboard('collecting', field.is_required, !!currentValue, editMode),
    },
  );
  return saveConversation(admin, {
    ...conversation,
    state: buildConversationState(values, {
      ...nextUi,
      bot_message_id: botMessageId,
      confirmation_message_id: null,
    }),
    last_message_at: new Date().toISOString(),
  });
}

async function promptConfirmation(
  admin: AdminClient,
  conversation: ConversationRow,
  chatId: string,
  fields: EffectiveField[],
  values: Record<string, string>,
) {
  const nextUi = await syncProgressMessage(chatId, conversation, null, values, { hide: true });
  const { ui } = readConversationState(conversation);
  const validationNote = normalizeText(ui.address_validation_note);
  const noteText = validationNote ? `\n\n[${validationNote}]` : '';
  const botMessageId = await sendManagedConversationMessage(
    chatId,
    conversation,
    `Проверьте данные:\n\n${buildSummary(fields, values)}${noteText}\n\nЕсли всё верно, подтвердите создание заявки.`,
    {
      inlineKeyboard: buildConfirmationInlineKeyboard(fields, values),
    },
  );
  return saveConversation(admin, {
    ...conversation,
    state: buildConversationState(values, {
      ...nextUi,
      bot_message_id: botMessageId,
    }),
    last_message_at: new Date().toISOString(),
  });
}

async function promptConfirmationRich(
  admin: AdminClient,
  conversation: ConversationRow,
  chatId: string,
  fields: EffectiveField[],
  values: Record<string, string>,
  options: { menu?: 'main' | 'address' } = {},
) {
  const { ui } = readConversationState(conversation);
  const nextMenu = options.menu || 'main';
  const nextUi = await syncProgressMessage(chatId, conversation, null, values, { hide: true });
  const validationNoteRich = buildConfirmationValidationNoteRich(ui);
  const botMessageId = await sendManagedConversationMessage(
    chatId,
    conversation,
    buildConfirmationTextRich(fields, values, validationNoteRich),
    {
      inlineKeyboard: buildConfirmationInlineKeyboard(fields, values, nextMenu),
    },
  );
  return saveConversation(admin, {
    ...conversation,
    state: buildConversationState(values, {
      ...ui,
      ...nextUi,
      confirmation_menu: nextMenu,
      bot_message_id: botMessageId,
      confirmation_message_id: botMessageId,
    }),
    last_message_at: new Date().toISOString(),
  });
}

async function showConversationNotice(
  admin: AdminClient,
  conversation: ConversationRow,
  chatId: string,
  text: string,
  options: { keyboard?: Record<string, unknown> | null; inlineKeyboard?: unknown[][] | null; removeKeyboard?: boolean } = {},
) {
  const { values, ui } = readConversationState(conversation);
  const finalText =
    ui.direct_start_notice === true
      ? getDirectStartNoticeText()
      : text;
  const nextUi = await syncProgressMessage(chatId, conversation, null, values, { hide: true });
  const botMessageId = await sendManagedConversationMessage(chatId, conversation, escapeHtml(finalText), options);
  return saveConversation(admin, {
    ...conversation,
    state: buildConversationState(values, {
      ...nextUi,
      direct_start_notice: false,
      bot_message_id: botMessageId,
      confirmation_message_id: null,
    }),
    last_message_at: new Date().toISOString(),
  });
}

async function resetConversationToIdle(admin: AdminClient, conversation: ConversationRow) {
  const { ui } = readConversationState(conversation);
  return saveConversation(admin, {
    ...conversation,
    company_id: null,
    integration_id: null,
    'status': 'idle',
    current_field_key: null,
    state: buildConversationState({}, {
      ...ui,
      awaiting_restart_confirmation: false,
      pending_restart_integration_id: null,
      direct_start_notice: true,
    }),
    completed_at: new Date().toISOString(),
    last_message_at: new Date().toISOString(),
  });
}

async function promptNewRequestConfirmation(
  admin: AdminClient,
  conversation: ConversationRow,
  integration: IntegrationRow,
  chatId: string,
) {
  const companyName = await getCompanyDisplayName(admin, integration.company_id);
  const { values, ui } = readConversationState(conversation);
  const nextUi = await syncProgressMessage(chatId, conversation, null, values, { hide: true });
  const text = companyName
    ? `\u0417\u0430\u044f\u0432\u043a\u0430 \u0434\u043b\u044f \u043a\u043e\u043c\u043f\u0430\u043d\u0438\u0438 \u00ab${escapeHtml(companyName)}\u00bb \u0443\u0436\u0435 \u0441\u043e\u0437\u0434\u0430\u043d\u0430.\n\n\u0425\u043e\u0442\u0438\u0442\u0435 \u0441\u043e\u0437\u0434\u0430\u0442\u044c \u043d\u043e\u0432\u0443\u044e \u0437\u0430\u044f\u0432\u043a\u0443?`
    : '\u042d\u0442\u0430 \u0437\u0430\u044f\u0432\u043a\u0430 \u0443\u0436\u0435 \u0441\u043e\u0437\u0434\u0430\u043d\u0430.\n\n\u0425\u043e\u0442\u0438\u0442\u0435 \u0441\u043e\u0437\u0434\u0430\u0442\u044c \u043d\u043e\u0432\u0443\u044e \u0437\u0430\u044f\u0432\u043a\u0443?';
  const botMessageId = await sendManagedConversationMessage(chatId, conversation, text, {
    keyboard: newRequestKeyboard(),
  });
  return saveConversation(admin, {
    ...conversation,
    state: buildConversationState(values, {
      ...ui,
      ...nextUi,
      awaiting_restart_confirmation: true,
      pending_restart_integration_id: integration.id,
      bot_message_id: botMessageId,
      confirmation_message_id: null,
    }),
    last_message_at: new Date().toISOString(),
  });
}

async function handleConfirmationCallback(
  admin: AdminClient,
  conversation: ConversationRow,
  integration: IntegrationRow,
  fields: EffectiveField[],
  callback: MaxCallback,
) {
  const { values } = readConversationState(conversation);
  const data = callback.data;

  if (data === 'confirm:submit') {
    try {
      const result = await createOrderFromConversation(admin, integration, values, fields);
      conversation = await saveConversation(admin, {
        ...conversation,
        'status': 'completed',
        current_field_key: null,
        state: buildConversationState(values, readConversationState(conversation).ui),
        completed_at: new Date().toISOString(),
        last_order_id: result.orderId,
        last_client_id: result.clientId,
        last_object_id: result.objectId,
        last_message_at: new Date().toISOString(),
      });
      await showConversationNotice(
        admin,
        conversation,
        callback.chatId,
        buildPostSubmitNoticeText(integration, result),
        { keyboard: newRequestKeyboard() },
      );
      await safeDeleteMaxMessage(callback.chatId, callback.messageId);
      await answerMaxCallback(callback.callbackId);
      return json(200, { success: true });
    } catch (error) {
      const failureReason = toErrorMessage(error);
      const failureText = integration.failure_message || GENERIC_FAILURE_TEXT;
      console.error('[max-bot][create-order]', {
        companyId: integration.company_id,
        chatId: callback.chatId,
        error: failureReason,
      });
      await showConversationNotice(admin, conversation, callback.chatId, failureText, {
        inlineKeyboard: buildConfirmationInlineKeyboard(fields, values),
      });
      await safeDeleteMaxMessage(callback.chatId, callback.messageId);
      await answerMaxCallback(callback.callbackId);
      return json(200, { success: true });
    }
  }

  if (data === 'confirm:restart') {
    await restartConversation(admin, conversation, integration, fields, callback.chatId, callback.userId, callback.username);
    await safeDeleteMaxMessage(callback.chatId, callback.messageId);
    await answerMaxCallback(callback.callbackId);
    return json(200, { success: true });
  }

  if (data === 'confirm:address_menu') {
    await promptConfirmationRich(admin, conversation, callback.chatId, fields, values, { menu: 'address' });
    await safeDeleteMaxMessage(callback.chatId, callback.messageId);
    await answerMaxCallback(callback.callbackId);
    return json(200, { success: true });
  }

  if (data === 'confirm:menu_main') {
    await promptConfirmationRich(admin, conversation, callback.chatId, fields, values, { menu: 'main' });
    await answerMaxCallback(callback.callbackId);
    return json(200, { success: true });
  }

  if (data === 'confirm:cancel') {
    const { ui } = readConversationState(conversation);
    conversation = await saveConversation(admin, {
      ...conversation,
      'status': 'idle',
      current_field_key: null,
      state: buildConversationState({}, ui),
      completed_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
    });
    await showConversationNotice(
      admin,
      conversation,
      callback.chatId,
      'Заполнение остановлено. Чтобы начать снова, откройте ссылку из приложения.',
      { removeKeyboard: true },
    );
    await answerMaxCallback(callback.callbackId);
    return json(200, { success: true });
  }

  if (data === 'confirm:back') {
    const previous = fields[fields.length - 1] || null;
    if (previous) {
      const { ui } = readConversationState(conversation);
      conversation = await saveConversation(admin, {
        ...conversation,
        'status': 'collecting',
        current_field_key: previous.field_key,
        state: buildConversationState(values, {
          ...ui,
          return_to_confirmation: true,
        }),
        last_message_at: new Date().toISOString(),
      });
      await promptField(admin, conversation, callback.chatId, fields, previous, values);
    }
    await answerMaxCallback(callback.callbackId);
    return json(200, { success: true });
  }

  if (data.startsWith('edit:')) {
    const fieldKey = data.slice(5);
    const targetField = fields.find((field) => field.field_key === fieldKey) || null;
    if (!targetField) {
      await answerMaxCallback(callback.callbackId, 'Поле недоступно');
      return json(200, { success: true });
    }
    const { ui } = readConversationState(conversation);
    conversation = await saveConversation(admin, {
      ...conversation,
      'status': 'collecting',
      current_field_key: targetField.field_key,
      state: buildConversationState(values, {
        ...ui,
        return_to_confirmation: true,
        'confirmation_menu': 'main',
      }),
      last_message_at: new Date().toISOString(),
    });
    await promptField(admin, conversation, callback.chatId, fields, targetField, values, {
      'prefix': 'Измените это поле.',
    });
    await answerMaxCallback(callback.callbackId);
    return json(200, { success: true });
  }

  await answerMaxCallback(callback.callbackId);
  return json(200, { success: true, ignored: true });
}

async function restartConversation(
  admin: AdminClient,
  conversation: ConversationRow,
  integration: IntegrationRow,
  fields: EffectiveField[],
  chatId: string,
  userId: string,
  username: string,
) {
  const firstField = nextField(fields, null);
  const { ui } = readConversationState(conversation);
  const previousBotMessageId = getTrackedBotMessageId(conversation);
  const previousConfirmationMessageId = getTrackedConfirmationMessageId(conversation);
  const previousProgressMessageId = getTrackedProgressMessageId(conversation);
  if (previousProgressMessageId) await safeDeleteMaxMessage(chatId, previousProgressMessageId);
  if (previousConfirmationMessageId) await safeDeleteMaxMessage(chatId, previousConfirmationMessageId);
  if (previousBotMessageId && previousBotMessageId !== previousConfirmationMessageId) {
    await safeDeleteMaxMessage(chatId, previousBotMessageId);
  }
  const companyName = await getCompanyDisplayName(admin, integration.company_id);
  const introText = [
    companyName ? `Вы заполняете заявку для компании «${companyName}».` : 'Вы заполняете новую заявку.',
    'Ответьте на несколько коротких вопросов, и мы сразу передадим данные в заявку.',
    normalizeText(integration.welcome_message),
  ]
    .filter(Boolean)
    .join('\n\n');
  const nextConversation = await saveConversation(admin, {
    ...conversation,
    provider: MAX_PROVIDER,
    external_chat_id: chatId,
    external_user_id: userId || null,
    external_username: username || null,
    company_id: integration.company_id,
    integration_id: integration.id,
    'status': 'collecting',
    current_field_key: firstField?.field_key || null,
    state: buildConversationState({}, {
      ...ui,
      awaiting_restart_confirmation: false,
      pending_restart_integration_id: null,
      direct_start_notice: false,
      return_to_confirmation: false,
      'confirmation_menu': 'main',
      bot_message_id: null,
      confirmation_message_id: null,
      progress_message_id: null,
    }),
    started_at: new Date().toISOString(),
    completed_at: null,
    last_message_at: new Date().toISOString(),
  });
  if (firstField) {
    await promptField(
      admin,
      nextConversation,
      chatId,
      fields,
      firstField,
      {},
      { prefix: introText || null },
    );
  } else {
    await showConversationNotice(admin, nextConversation, chatId, BOT_NOT_CONFIGURED_TEXT, {
      removeKeyboard: true,
    });
  }
}

async function sendCurrentStepReminder(
  admin: AdminClient,
  chatId: string,
  conversation: ConversationRow,
  integration: IntegrationRow,
  fields: EffectiveField[],
) {
  const { values } = readConversationState(conversation);
  const currentField =
    fields.find((field) => field.field_key === conversation.current_field_key) || nextField(fields, null);
  if (conversation.status === 'confirming') {
    await promptConfirmationRich(admin, conversation, chatId, fields, values);
    return;
  }
  if (currentField) {
    await promptField(admin, conversation, chatId, fields, currentField, values, {
      prefix: currentCompanyStartHint(integration),
    });
    return;
  }
  const botMessageId = await sendManagedConversationMessage(chatId, conversation, currentCompanyStartHint(integration), {
    removeKeyboard: true,
  });
  const { ui } = readConversationState(conversation);
  await saveConversation(admin, {
    ...conversation,
    state: buildConversationState(values, {
      ...ui,
      bot_message_id: botMessageId,
    }),
    last_message_at: new Date().toISOString(),
  });
}

async function handleWebhook(admin: AdminClient, req: Request) {
  const secretToken = Deno.env.get('MAX_WEBHOOK_SECRET') || '';
  const providedSecret = req.headers.get('X-Max-Bot-Api-Secret') || '';
  if (!secretToken || !providedSecret || !secureCompare(providedSecret, secretToken)) {
    return json(401, { success: false, message: 'Unauthorized webhook' });
  }

  const payload = (await req.json().catch(() => ({}))) as Record<string, unknown> | Record<string, unknown>[];
  const update = (
    Array.isArray(payload)
      ? payload[0]
      : Array.isArray((payload as Record<string, unknown>).updates)
        ? ((payload as Record<string, unknown>).updates as Record<string, unknown>[])[0]
        : payload
  ) as Record<string, unknown>;
  if (!update || typeof update !== 'object') return json(200, { success: true, ignored: true });
  const callback = extractMaxCallback(update);
  const message = extractMaxMessage(update);
  const chatId = callback?.chatId || message?.chatId || '';
  const chatType = callback?.chatType || message?.chatType || '';
  if (!chatId) return json(200, { success: true, ignored: true });
  if (chatType && chatType !== 'private') {
    await sendMaxMessage(chatId, PRIVATE_CHAT_ONLY_TEXT, { removeKeyboard: true }).catch(() => null);
    return json(200, { success: true, ignored: true });
  }

  const shouldProcess = await markUpdateProcessed(admin, callback?.updateId || message?.updateId || '');
  if (!shouldProcess) return json(200, { success: true, duplicate: true });

  let conversation = await getConversation(admin, chatId);
  if (!conversation) {
    conversation = await saveConversation(admin, {
      provider: MAX_PROVIDER,
      external_chat_id: chatId,
      external_user_id: callback?.userId || message?.userId || null,
      external_username: callback?.username || message?.username || null,
      'status': 'idle',
      state: buildConversationState({}, {}),
      last_message_at: new Date(0).toISOString(),
    });
  }

  if (callback) {
    if (!conversation.company_id || !conversation.integration_id) {
      await answerMaxCallback(callback.callbackId);
      return json(200, { success: true, ignored: true });
    }
    const integration = await getIntegration(admin, conversation.company_id);
    if (!integration || !integration.is_enabled) {
      await answerMaxCallback(callback.callbackId);
      return json(200, { success: true, ignored: true });
    }
    const fields = await getEffectiveFields(admin, integration);
    if (conversation.status !== 'confirming') {
      await answerMaxCallback(callback.callbackId);
      return json(200, { success: true, ignored: true });
    }
    return handleConfirmationCallback(admin, conversation, integration, fields, callback);
  }

  const text = message?.text || '';

  const previousMessageAt = Date.parse(String(conversation.last_message_at || ''));
  if (!callback && Number.isFinite(previousMessageAt) && Date.now() - previousMessageAt < MESSAGE_RATE_LIMIT_MS) {
    return json(200, { success: true, throttled: true });
  }

  if (text.toLowerCase().startsWith('/start')) {
    const token = extractStartToken(text);
    if (!token) {
      conversation = await resetConversationToIdle(admin, conversation);
      conversation = await showConversationNotice(
        admin,
        conversation,
        message.chatId,
        'Откройте бота по ссылке из настроек компании.',
        { removeKeyboard: true },
      );
      await safeDeleteMaxMessage(message.chatId, message.messageId);
      return json(200, { success: true });
    }
    const integration = await findIntegrationByToken(admin, token);
    if (!integration || !integration.is_enabled) {
      conversation = await showConversationNotice(
        admin,
        conversation,
        message.chatId,
        'Эта ссылка больше не действительна.',
        { removeKeyboard: true },
      );
      await safeDeleteMaxMessage(message.chatId, message.messageId);
      return json(200, { success: true });
    }
    const fields = await getEffectiveFields(admin, integration);
    if (!fields.length) {
      conversation = await showConversationNotice(
        admin,
        conversation,
        message.chatId,
        BOT_NOT_CONFIGURED_TEXT,
        { removeKeyboard: true },
      );
      await safeDeleteMaxMessage(message.chatId, message.messageId);
      return json(200, { success: true });
    }
    if (conversation.status === 'completed' && isConversationForIntegration(conversation, integration)) {
      await promptNewRequestConfirmation(admin, conversation, integration, message.chatId);
      await safeDeleteMaxMessage(message.chatId, message.messageId);
      return json(200, { success: true });
    }
    await restartConversation(admin, conversation, integration, fields, message.chatId, message.userId, message.username);
    await safeDeleteMaxMessage(message.chatId, message.messageId);
    return json(200, { success: true });
  }

  if (text === CANCEL_TEXT || text.toLowerCase() === '/cancel') {
    const { ui } = readConversationState(conversation);
    conversation = await saveConversation(admin, {
      ...conversation,
      'status': 'idle',
      current_field_key: null,
      state: buildConversationState({}, ui),
      completed_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
    });
    conversation = await showConversationNotice(
      admin,
      conversation,
      message.chatId,
      'Заполнение остановлено. Чтобы начать снова, откройте ссылку из приложения.',
      { removeKeyboard: true },
    );
    await safeDeleteMaxMessage(message.chatId, message.messageId);
    return json(200, { success: true });
  }

  if (!conversation.company_id || !conversation.integration_id) {
    conversation = await showConversationNotice(
      admin,
      conversation,
      message.chatId,
      'Сначала откройте бота по ссылке из настроек компании.',
      { removeKeyboard: true },
    );
    await safeDeleteMaxMessage(message.chatId, message.messageId);
    return json(200, { success: true });
  }

  const integration = await getIntegration(admin, conversation.company_id);
  if (!integration || !integration.is_enabled) {
    conversation = await showConversationNotice(
      admin,
      conversation,
      message.chatId,
      'Бот для вашей компании сейчас отключён.',
      { removeKeyboard: true },
    );
    await safeDeleteMaxMessage(message.chatId, message.messageId);
    return json(200, { success: true });
  }

  const fields = await getEffectiveFields(admin, integration);
  if (!fields.length) {
    conversation = await showConversationNotice(
      admin,
      conversation,
      message.chatId,
      BOT_NOT_CONFIGURED_TEXT,
      { removeKeyboard: true },
    );
    await safeDeleteMaxMessage(message.chatId, message.messageId);
    return json(200, { success: true });
  }
  const { values, ui } = readConversationState(conversation);

  if (conversation.status === 'completed' || ui.awaiting_restart_confirmation === true) {
    const pendingIntegration =
      (await getIntegrationById(admin, String(ui.pending_restart_integration_id || ''))) || integration;
    if (text === CREATE_NEW_REQUEST_TEXT || text.toLowerCase() === '/restart') {
      const restartFields = await getEffectiveFields(admin, pendingIntegration);
      await restartConversation(
        admin,
        conversation,
        pendingIntegration,
        restartFields,
        message.chatId,
        message.userId,
        message.username,
      );
      await safeDeleteMaxMessage(message.chatId, message.messageId);
      return json(200, { success: true });
    }
    if (text === KEEP_CURRENT_REQUEST_TEXT || text === CANCEL_TEXT || text.toLowerCase() === '/cancel') {
      conversation = await saveConversation(admin, {
        ...conversation,
        state: buildConversationState(values, {
          ...ui,
          awaiting_restart_confirmation: false,
          pending_restart_integration_id: null,
        }),
        last_message_at: new Date().toISOString(),
      });
      conversation = await showConversationNotice(
        admin,
        conversation,
        message.chatId,
        '\u0425\u043e\u0440\u043e\u0448\u043e. \u0415\u0441\u043b\u0438 \u043f\u043e\u043d\u0430\u0434\u043e\u0431\u0438\u0442\u0441\u044f, \u043e\u0442\u043a\u0440\u043e\u0439\u0442\u0435 \u0441\u0441\u044b\u043b\u043a\u0443 \u0435\u0449\u0451 \u0440\u0430\u0437.',
        { removeKeyboard: true },
      );
      await safeDeleteMaxMessage(message.chatId, message.messageId);
      return json(200, { success: true });
    }
    await promptNewRequestConfirmation(admin, conversation, pendingIntegration, message.chatId);
    await safeDeleteMaxMessage(message.chatId, message.messageId);
    return json(200, { success: true });
  }

  if (text === EDIT_CANCEL_TEXT && ui.return_to_confirmation === true) {
    conversation = await moveConversationToConfirmation(
      admin,
      conversation,
      integration,
      values,
      ui,
    );
    const { values: confirmedValues } = readConversationState(conversation);
    await promptConfirmationRich(admin, conversation, message.chatId, fields, confirmedValues);
    await safeDeleteMaxMessage(message.chatId, message.messageId);
    return json(200, { success: true });
  }

  if (text === RESTART_TEXT || text.toLowerCase() === '/restart') {
    await restartConversation(admin, conversation, integration, fields, message.chatId, message.userId, message.username);
    await safeDeleteMaxMessage(message.chatId, message.messageId);
    return json(200, { success: true });
  }

  if (text === BACK_TEXT) {
    if (conversation.status === 'confirming') {
      const previous = fields[fields.length - 1] || null;
      if (!previous) {
        await sendCurrentStepReminder(admin, message.chatId, conversation, integration, fields);
        await safeDeleteMaxMessage(message.chatId, message.messageId);
        return json(200, { success: true });
      }
      const { ui } = readConversationState(conversation);
      conversation = await saveConversation(admin, {
        ...conversation,
        'status': 'collecting',
        current_field_key: previous.field_key,
      state: buildConversationState(values, {
        ...ui,
        return_to_confirmation: true,
        'confirmation_menu': 'main',
      }),
      last_message_at: new Date().toISOString(),
    });
      await promptField(admin, conversation, message.chatId, fields, previous, values);
      await safeDeleteMaxMessage(message.chatId, message.messageId);
      return json(200, { success: true });
    }

    const previous = previousField(fields, conversation.current_field_key || nextField(fields, null)?.field_key || null);
    if (!previous) {
      const firstField = fields[0] || null;
      if (!firstField) {
        await showConversationNotice(admin, conversation, message.chatId, 'Для этой компании бот ещё не настроен.', {
          removeKeyboard: true,
        });
        await safeDeleteMaxMessage(message.chatId, message.messageId);
        return json(200, { success: true });
      }
      await promptField(
        admin,
        conversation,
        message.chatId,
        fields,
        firstField,
        values,
        { prefix: 'Это первый шаг. Можно продолжить заполнение.' },
      );
      await safeDeleteMaxMessage(message.chatId, message.messageId);
      return json(200, { success: true });
    }
    const { ui } = readConversationState(conversation);
    conversation = await saveConversation(admin, {
      ...conversation,
      'status': 'collecting',
      current_field_key: previous.field_key,
      state: buildConversationState(values, {
        ...ui,
        return_to_confirmation: ui.return_to_confirmation === true,
      }),
      last_message_at: new Date().toISOString(),
    });
    await promptField(admin, conversation, message.chatId, fields, previous, values);
    await safeDeleteMaxMessage(message.chatId, message.messageId);
    return json(200, { success: true });
  }

  if (conversation.status === 'confirming') {
    if (text !== CONFIRM_TEXT) {
      await showConversationNotice(admin, conversation, message.chatId, 'Подтвердите создание заявки или начните заполнение заново.', {
        keyboard: conversationKeyboard('confirming', true),
      });
      await safeDeleteMaxMessage(message.chatId, message.messageId);
      return json(200, { success: true });
    }
    try {
      const result = await createOrderFromConversation(admin, integration, values, fields);
      conversation = await saveConversation(admin, {
        ...conversation,
        'status': 'completed',
        current_field_key: null,
        state: buildConversationState(values, readConversationState(conversation).ui),
        completed_at: new Date().toISOString(),
        last_order_id: result.orderId,
        last_client_id: result.clientId,
        last_object_id: result.objectId,
        last_message_at: new Date().toISOString(),
      });
      await showConversationNotice(
        admin,
        conversation,
        message.chatId,
        buildPostSubmitNoticeText(integration, result),
        { keyboard: newRequestKeyboard() },
      );
      await safeDeleteMaxMessage(message.chatId, message.messageId);
    } catch (error) {
      const failureReason = toErrorMessage(error);
      const failureText = integration.failure_message || GENERIC_FAILURE_TEXT;
      console.error('[max-bot][create-order]', {
        companyId: integration.company_id,
        chatId: message.chatId,
        error: failureReason,
      });
      await showConversationNotice(
        admin,
        conversation,
        message.chatId,
        failureText,
        { keyboard: conversationKeyboard('confirming', true) },
      );
      await safeDeleteMaxMessage(message.chatId, message.messageId);
    }
    return json(200, { success: true });
  }

  const currentField =
    fields.find((field) => field.field_key === conversation.current_field_key) || nextField(fields, null);
  if (!currentField) {
    await showConversationNotice(admin, conversation, message.chatId, 'Для этой компании бот ещё не настроен.', {
      removeKeyboard: true,
    });
    await safeDeleteMaxMessage(message.chatId, message.messageId);
    return json(200, { success: true });
  }

  const currentValue = normalizeText(values[currentField.field_key]);

  if (text === NEXT_TEXT) {
    if (!currentValue) {
      await promptField(
        admin,
        conversation,
        message.chatId,
        fields,
        currentField,
        values,
        { prefix: 'Сначала заполните это поле или вернитесь назад.' },
      );
      await safeDeleteMaxMessage(message.chatId, message.messageId);
      return json(200, { success: true });
    }

    if (ui.return_to_confirmation === true) {
      conversation = await moveConversationToConfirmation(
        admin,
        conversation,
        integration,
        values,
        ui,
      );
      const { values: confirmedValues } = readConversationState(conversation);
      await promptConfirmationRich(admin, conversation, message.chatId, fields, confirmedValues);
      await safeDeleteMaxMessage(message.chatId, message.messageId);
      return json(200, { success: true });
    }

    const next = nextField(fields, currentField.field_key);
    if (next) {
      conversation = await saveConversation(admin, {
        ...conversation,
        'status': 'collecting',
        current_field_key: next.field_key,
        state: buildConversationState(values, {
          ...ui,
          return_to_confirmation: false,
        }),
        last_message_at: new Date().toISOString(),
      });
      await promptField(admin, conversation, message.chatId, fields, next, values);
    } else {
      conversation = await moveConversationToConfirmation(
        admin,
        conversation,
        integration,
        values,
        ui,
      );
      const { values: confirmedValues } = readConversationState(conversation);
      await promptConfirmationRich(admin, conversation, message.chatId, fields, confirmedValues);
    }
    await safeDeleteMaxMessage(message.chatId, message.messageId);
    return json(200, { success: true });
  }

  if (!currentField.is_required && text === SKIP_TEXT) {
    values[currentField.field_key] = '';
  } else {
    const parsed = mapFieldValue(currentField, text, message.contactPhone);
    if (!parsed.ok) {
      await promptField(
        admin,
        conversation,
        message.chatId,
        fields,
        currentField,
        values,
        { prefix: parsed.message || 'Проверьте введённые данные.' },
      );
      await safeDeleteMaxMessage(message.chatId, message.messageId);
      return json(200, { success: true });
    }
    values[currentField.field_key] = String(parsed.value || '');
  }

  const uiAfterInput =
    ui.return_to_confirmation === true &&
    ADDRESS_FIELD_KEYS.has(currentField.field_key) &&
    ui.address_autocorrect_applied === true
      ? {
          ...ui,
          address_manual_override: true,
          address_autocorrect_applied: false,
          address_validation_note: null,
        }
      : ui;

  if (ui.return_to_confirmation === true) {
    conversation = await moveConversationToConfirmation(
      admin,
      conversation,
      integration,
      values,
      uiAfterInput,
    );
    const { values: confirmedValues } = readConversationState(conversation);
    await promptConfirmationRich(admin, conversation, message.chatId, fields, confirmedValues);
    await safeDeleteMaxMessage(message.chatId, message.messageId);
    return json(200, { success: true });
  }

  const next = nextField(fields, currentField.field_key);
  if (next) {
    conversation = await saveConversation(admin, {
      ...conversation,
      'status': 'collecting',
      current_field_key: next.field_key,
      state: buildConversationState(values, {
        ...uiAfterInput,
        return_to_confirmation: false,
      }),
      last_message_at: new Date().toISOString(),
    });
    await promptField(admin, conversation, message.chatId, fields, next, values);
    await safeDeleteMaxMessage(message.chatId, message.messageId);
    return json(200, { success: true });
  }

  conversation = await moveConversationToConfirmation(
    admin,
    conversation,
    integration,
    values,
    uiAfterInput,
  );
  const { values: confirmedValues } = readConversationState(conversation);
  await promptConfirmationRich(admin, conversation, message.chatId, fields, confirmedValues);
  await safeDeleteMaxMessage(message.chatId, message.messageId);
  return json(200, { success: true });
}

export async function handleMaxBotRequest(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { success: false, message: 'POST only' });

  let action = '';
  try {
    const admin = getAdminClient();
    const body = (await req.clone().json().catch(() => ({}))) as Record<string, unknown>;
    action = normalizeText(body.action);
    if (!action) return await handleWebhook(admin, req);
    if (action === 'status') return await handleStatus(req, admin);
    if (action === 'save_config') return await handleSaveConfig(req, admin, body);
    if (action === 'regenerate_token') return await handleRegenerateToken(req, admin);
    if (action === 'ensure_webhook') {
      await getCallerContext(admin, req);
      return json(200, { success: true, webhook_url: await ensureMaxWebhook() });
    }
    return json(400, { success: false, message: 'Unknown action' });
  } catch (error) {
    const message = toErrorMessage(error);
    const lowered = message.toLowerCase();
    const status = lowered.includes('unauthorized')
      ? 401
      : lowered.includes('forbidden')
        ? 403
        : 500;
    console.error('[max-bot]', status, message);
    return json(action === 'status' ? 200 : status, { success: false, message });
  }
}

if (import.meta.main) {
  Deno.serve(handleMaxBotRequest);
}
