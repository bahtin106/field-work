import { toE164MobilePhoneOrNull } from '../../shared/validation/phone';

export const OBJECT_ADDITIONAL_PHONE_SLOT_COUNT = 3;
export const OBJECT_ADDITIONAL_PHONE_SLOT_IDS = [1, 2, 3];
export const OBJECT_ADDITIONAL_PHONE_LABEL_MAX_LENGTH = 48;

function trimToNull(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function toEntry(value) {
  if (!value || typeof value !== 'object') return { phone: null, label: null };
  const rawLabel = trimToNull(value.label);
  return {
    phone: trimToNull(value.phone),
    label: rawLabel ? rawLabel.slice(0, OBJECT_ADDITIONAL_PHONE_LABEL_MAX_LENGTH) : null,
  };
}

function normalizeSlotIds(slotIds) {
  const source = Array.isArray(slotIds) ? slotIds : [];
  const known = new Set(OBJECT_ADDITIONAL_PHONE_SLOT_IDS);
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

export function createEmptyAdditionalObjectPhones() {
  return OBJECT_ADDITIONAL_PHONE_SLOT_IDS.map(() => ({ phone: '', label: '' }));
}

export function resolveVisibleAdditionalObjectPhoneSlotIds(options = {}) {
  const enabledSlotIds = normalizeSlotIds(options.enabledSlotIds);
  const requiredSlotIds = normalizeSlotIds(options.requiredSlotIds).filter((slotId) =>
    enabledSlotIds.includes(slotId),
  );
  const explicitVisibleSlotIds = normalizeSlotIds(options.explicitVisibleSlotIds).filter((slotId) =>
    enabledSlotIds.includes(slotId),
  );
  const valueVisibleSlotIds = normalizeSlotIds(options.valueVisibleSlotIds).filter((slotId) =>
    enabledSlotIds.includes(slotId),
  );

  return normalizeSlotIds([
    ...requiredSlotIds,
    ...explicitVisibleSlotIds,
    ...valueVisibleSlotIds,
  ]);
}

export function getAddableAdditionalObjectPhoneSlotIds(enabledSlotIds, requiredSlotIds) {
  const enabled = normalizeSlotIds(enabledSlotIds);
  const required = new Set(normalizeSlotIds(requiredSlotIds));
  return enabled.filter((slotId) => !required.has(slotId));
}

export function normalizeAdditionalObjectPhones(value) {
  const source = Array.isArray(value) ? value : [];
  return OBJECT_ADDITIONAL_PHONE_SLOT_IDS.map((_slotId, index) => {
    const sourceItem = source[index];
    return toEntry(sourceItem);
  });
}

export function getVisibleAdditionalObjectPhoneSlotIds(additionalPhones) {
  const normalized = normalizeAdditionalObjectPhones(additionalPhones);
  const visible = normalized
    .map((entry, index) => ({ slotId: index + 1, phone: trimToNull(entry?.phone) }))
    .filter((entry) => !!entry.phone)
    .map((entry) => entry.slotId);
  return normalizeSlotIds(visible);
}

export function getObjectAdditionalPhones(objectItem) {
  const source = {
    additional_phone_1: trimToNull(objectItem?.additional_phone_1),
    additional_phone_1_label: trimToNull(objectItem?.additional_phone_1_label),
    additional_phone_2: trimToNull(objectItem?.additional_phone_2),
    additional_phone_2_label: trimToNull(objectItem?.additional_phone_2_label),
    additional_phone_3: trimToNull(objectItem?.additional_phone_3),
    additional_phone_3_label: trimToNull(objectItem?.additional_phone_3_label),
    additionalPhone1: trimToNull(objectItem?.additionalPhone1),
    additionalPhone1Label: trimToNull(objectItem?.additionalPhone1Label),
    additionalPhone2: trimToNull(objectItem?.additionalPhone2),
    additionalPhone2Label: trimToNull(objectItem?.additionalPhone2Label),
    additionalPhone3: trimToNull(objectItem?.additionalPhone3),
    additionalPhone3Label: trimToNull(objectItem?.additionalPhone3Label),
  };

  return OBJECT_ADDITIONAL_PHONE_SLOT_IDS.map((slotId) => {
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

export function buildObjectAdditionalPhonesPatch(additionalPhones, options = {}) {
  const fallbackLabel = trimToNull(options.defaultLabel);
  const normalized = normalizeAdditionalObjectPhones(additionalPhones);
  const hiddenSource = normalizeAdditionalObjectPhones(options.hiddenSource || additionalPhones);
  const visibleSlotIds = normalizeSlotIds(options.visibleSlotIds || OBJECT_ADDITIONAL_PHONE_SLOT_IDS);
  const visible = new Set(visibleSlotIds);
  const preserveHidden = options.preserveHidden === true;
  const patch = {};

  normalized.forEach((entry, index) => {
    const slotId = index + 1;
    const isVisible = visible.has(slotId);
    const hiddenEntry = hiddenSource[index] || { phone: null, label: null };
    patch[`additional_phone_${slotId}`] = isVisible
      ? toE164MobilePhoneOrNull(entry.phone)
      : preserveHidden
        ? toE164MobilePhoneOrNull(hiddenEntry.phone)
        : null;
    patch[`additional_phone_${slotId}_label`] = isVisible
      ? entry.label || fallbackLabel || null
      : preserveHidden
        ? hiddenEntry.label || null
        : null;
  });

  return patch;
}
