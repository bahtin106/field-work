// Единая точка для работы с гибкими настройками и RPC
import { supabase } from '../lib/supabase';

// ----- Company-enabled order fields (fixed builtin set) -----
async function getCurrentCompanyId() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('company_id')
    .eq('id', user.id)
    .single();
  if (error) return null;
  return data?.company_id || null;
}

const FIELD_CATALOG = [
  { key: 'title', label: 'Название заявки', type: 'text', position: 10, required: true },
  { key: 'fio', label: 'Имя заказчика', type: 'text', position: 20 },
  { key: 'phone', label: 'Телефон', type: 'phone', position: 30 },
  { key: 'region', label: 'Район или область', type: 'text', position: 40 },
  { key: 'city', label: 'Город или н.п.', type: 'text', position: 50 },
  { key: 'street', label: 'Улица или СНТ', type: 'text', position: 60 },
  { key: 'house', label: 'Дом или участок', type: 'text', position: 70 },
  { key: 'secondary_phone', label: 'Доп. телефон', type: 'phone', position: 110 },
  { key: 'contact_email', label: 'Email', type: 'text', position: 120 },
  { key: 'contact_pref', label: 'Предпочтительный контакт', type: 'select', position: 130 },
  { key: 'entrance_info', label: 'Как попасть/домофон', type: 'text', position: 140 },
  { key: 'parking_notes', label: 'Парковка', type: 'text', position: 150 },
  { key: 'geo_lat', label: 'Широта', type: 'number', position: 160 },
  { key: 'geo_lng', label: 'Долгота', type: 'number', position: 170 },
  { key: 'time_window_start', label: 'Окно прибытия — c', type: 'datetime', position: 180 },
  { key: 'time_window_end', label: 'Окно прибытия — по', type: 'datetime', position: 190 },
  { key: 'duration_min', label: 'Длительность (мин)', type: 'number', position: 200 },
  { key: 'arrival_at', label: 'Прибытие (факт)', type: 'datetime', position: 210 },
  { key: 'departure_at', label: 'Убытие (факт)', type: 'datetime', position: 220 },
  { key: 'department_id', label: 'Отдел', type: 'select', position: 230 },
  { key: 'crew_id', label: 'Бригада', type: 'select', position: 240 },
  { key: 'tags', label: 'Теги', type: 'tags', position: 250 },
  { key: 'discount', label: 'Скидка', type: 'number', position: 260 },
  { key: 'tax_rate', label: 'Налог, %', type: 'number', position: 270 },
  { key: 'total_amount', label: 'Итого', type: 'number', position: 280 },
  { key: 'payment_status', label: 'Статус оплаты', type: 'select', position: 290 },
  { key: 'customer_company', label: 'Компания заказчика', type: 'text', position: 300 },
];

function mapEnabledToSchema(rows = [], context = 'create') {
  const byKey = new Map(FIELD_CATALOG.map((f) => [f.key, f]));
  const flagName =
    context === 'edit'
      ? 'is_enabled_edit'
      : context === 'view' || context === 'list' || context === 'calendar'
        ? 'is_visible_read'
        : 'is_enabled_create';
  const fields = [];
  for (const r of rows) {
    if (!r?.[flagName]) continue;
    const meta = byKey.get(r.field_key);
    if (!meta) continue;
    fields.push({
      field_key: meta.key,
      label: meta.label,
      type: meta.type,
      position: meta.position,
      required: !!meta.required,
      storage_target: 'builtin',
    });
  }
  fields.sort((a, b) => (a.position || 9999) - (b.position || 9999));
  return { context, fields };
}

// --- Активные настройки (если хочешь дергать без провайдера) ---
export async function fetchActiveSettings() {
  const { data, error } = await supabase.rpc('get_active_settings');
  if (error) throw error;
  return data || {};
}

// --- Схема формы по контексту: 'create' | 'edit' | 'view' | 'list' | 'calendar' ---
export async function fetchFormSchema(context = 'create') {
  // 1) Try company-enabled fixed builtin fields
  try {
    const companyId = await getCurrentCompanyId();
    if (companyId) {
      const { data: rows, error } = await supabase.rpc('get_enabled_order_fields', {
        p_company_id: companyId,
      });
      if (!error && Array.isArray(rows)) {
        const schema = mapEnabledToSchema(rows, context);
        if ((schema.fields || []).length > 0) return schema;
      }
    }
  } catch (_) {}
  // 2) Fallback to legacy server-side schema (if present)
  try {
    const { data } = await supabase.rpc('get_form_schema', { p_context: context });
    if (data && Array.isArray(data.fields) && data.fields.length) return data;
  } catch (_) {}
  // 3) Safe default
  return { context, fields: [] };
}

// --- Заявка с подстановкой кастом-полей ---
export async function fetchOrderWithCustom(orderId) {
  const { data, error } = await supabase.rpc('get_order_with_custom', { p_order_id: orderId });
  if (error) throw error;
  return data; // jsonb или null
}

// --- Полная заявка (builtin+custom) + payout (если доступен) ---
export async function fetchOrderFull(orderId) {
  const { data, error } = await supabase.rpc('get_order_full', { p_order_id: orderId });
  if (error) throw error;
  return data; // jsonb или null
}

// --- Сохранение кастом-полей заявки (писать только custom-поля по field_key) ---
export async function saveOrderCustom(orderId, payloadByFieldKey) {
  // payloadByFieldKey: { status_v2: 'in_progress', priority: 'high', ... }
  const { data, error } = await supabase.rpc('save_order_custom_fields', {
    p_order_id: orderId,
    p_data: payloadByFieldKey,
  });
  if (error) throw error;
  return data; // void
}

// --- Предпросмотр выплаты по заявке ---
export async function previewPayout(orderId) {
  const { data, error } = await supabase.rpc('compute_payout', { p_order_id: orderId });
  if (error) throw error;
  return data; // { order_id, source, amount, ... }
}

// --- Доступные пользователю выплаты (админ — все, исполнитель — свои) ---
export async function fetchMyPayouts() {
  const { data, error } = await supabase.rpc('get_my_payouts');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

// --- Утилиты маппинга: field_key -> value в orders (builtin/custom) ---
export function readValueFromOrder(orderJson, field) {
  // field: объект из get_form_schema / SettingsProvider (f.field_key, f.storage_target, f.custom_key)
  if (!orderJson || !field) return null;
  const { field_key, storage_target, custom_key } = field;

  if (storage_target === 'custom') {
    const custom = orderJson.custom || {};
    return custom_key ? (custom[custom_key] ?? null) : null;
  }

  // builtin: берём прямо из корня json заявки
  return orderJson[field_key] ?? null;
}

// Собрать payload для saveOrderCustom по списку полей и значениям формы
export function buildCustomPayload(fields, formValuesByFieldKey) {
  const payload = {};
  for (const f of fields || []) {
    if (f.storage_target === 'custom') {
      const key = f.field_key;
      if (key in (formValuesByFieldKey || {})) {
        payload[key] = formValuesByFieldKey[key];
      }
    }
  }
  return payload;
}
