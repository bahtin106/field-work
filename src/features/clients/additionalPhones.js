import { toE164MobilePhoneOrNull } from '../../shared/validation/phone';

export const CLIENT_ADDITIONAL_PHONE_SLOT_COUNT = 3;
export const CLIENT_ADDITIONAL_PHONE_SLOT_IDS = [1, 2, 3];
export const CLIENT_ADDITIONAL_PHONE_LABEL_MAX_LENGTH = 48;

function trimToNull(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function toEntry(value) {
  if (!value || typeof value !== 'object') return { phone: null, label: null };
  const rawLabel = trimToNull(value.label);
  return {
    phone: trimToNull(value.phone),
    label: rawLabel ? rawLabel.slice(0, CLIENT_ADDITIONAL_PHONE_LABEL_MAX_LENGTH) : null,
  };
}

export function createEmptyAdditionalClientPhones() {
  return CLIENT_ADDITIONAL_PHONE_SLOT_IDS.map(() => ({ phone: '', label: '' }));
}

function normalizeSlotIds(slotIds) {
  const source = Array.isArray(slotIds) ? slotIds : [];
  const known = new Set(CLIENT_ADDITIONAL_PHONE_SLOT_IDS);
  const unique = new Set();
  source.forEach((slotId) => {
    const n = Number(slotId);
    if (!Number.isFinite(n)) return;
    const normalized = Math.trunc(n);
    if (!known.has(normalized)) return;
    unique.add(normalized);
  });
  return Array.from(unique).sort((a, b) => a - b);
}

export function normalizeAdditionalClientPhones(value) {
  const source = Array.isArray(value) ? value : [];
  return CLIENT_ADDITIONAL_PHONE_SLOT_IDS.map((_slotId, index) => {
    const sourceItem = source[index];
    return toEntry(sourceItem);
  });
}

export function getVisibleAdditionalPhoneSlotIds(additionalPhones) {
  const normalized = normalizeAdditionalClientPhones(additionalPhones);
  const visible = normalized
    .map((entry, index) => ({ slotId: index + 1, phone: trimToNull(entry?.phone) }))
    .filter((entry) => !!entry.phone)
    .map((entry) => entry.slotId);
  return normalizeSlotIds(visible);
}

export function getNextHiddenAdditionalPhoneSlotId(visibleSlotIds) {
  const visible = new Set(normalizeSlotIds(visibleSlotIds));
  return CLIENT_ADDITIONAL_PHONE_SLOT_IDS.find((slotId) => !visible.has(slotId)) || null;
}

export function getClientAdditionalPhones(client) {
  const source = {
    additional_phone_1: trimToNull(client?.additional_phone_1),
    additional_phone_1_label: trimToNull(client?.additional_phone_1_label),
    additional_phone_2: trimToNull(client?.additional_phone_2),
    additional_phone_2_label: trimToNull(client?.additional_phone_2_label),
    additional_phone_3: trimToNull(client?.additional_phone_3),
    additional_phone_3_label: trimToNull(client?.additional_phone_3_label),
    additionalPhone1: trimToNull(client?.additionalPhone1),
    additionalPhone1Label: trimToNull(client?.additionalPhone1Label),
    additionalPhone2: trimToNull(client?.additionalPhone2),
    additionalPhone2Label: trimToNull(client?.additionalPhone2Label),
    additionalPhone3: trimToNull(client?.additionalPhone3),
    additionalPhone3Label: trimToNull(client?.additionalPhone3Label),
  };

  return CLIENT_ADDITIONAL_PHONE_SLOT_IDS.map((slotId) => {
    const snakePhoneKey = `additional_phone_${slotId}`;
    const snakeLabelKey = `additional_phone_${slotId}_label`;
    const camelPhoneKey = `additionalPhone${slotId}`;
    const camelLabelKey = `additionalPhone${slotId}Label`;

    const phone =
      trimToNull(source[snakePhoneKey]) ||
      trimToNull(source[camelPhoneKey]);
    const label = trimToNull(source[snakeLabelKey]) || trimToNull(source[camelLabelKey]);

    return { phone, label };
  });
}

export function buildClientAdditionalPhonesPatch(additionalPhones, options = {}) {
  const fallbackLabel = trimToNull(options.defaultLabel);
  const normalized = normalizeAdditionalClientPhones(additionalPhones);
  const visibleSlotIds = normalizeSlotIds(options.visibleSlotIds || CLIENT_ADDITIONAL_PHONE_SLOT_IDS);
  const visible = new Set(visibleSlotIds);
  const patch = {};

  normalized.forEach((entry, index) => {
    const slotId = index + 1;
    const isVisible = visible.has(slotId);
    patch[`additional_phone_${slotId}`] = isVisible ? toE164MobilePhoneOrNull(entry.phone) : null;
    patch[`additional_phone_${slotId}_label`] = isVisible ? entry.label || fallbackLabel || null : null;
  });

  return patch;
}

export function collectClientPhoneSearchValues(client) {
  const basePhones = [
    trimToNull(client?.phone),
  ];
  const additionalPhones = getClientAdditionalPhones(client).map((entry) => entry.phone);
  return [...basePhones, ...additionalPhones].filter(Boolean);
}

export function buildAdditionalPhoneDisplayLabel(t, label) {
  const base = String(t?.('order_field_secondary_phone') || 'Доп. телефон');
  const resolved = trimToNull(label);
  return resolved || base;
}
