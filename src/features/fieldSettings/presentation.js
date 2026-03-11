import {
  buildFallbackEntityFieldSettings,
  isEntityFieldEnabled,
  isEntityFieldRequired,
} from './catalog';

export function sanitizeFieldLabel(label) {
  return String(label || '')
    .replace(/\s*\*+\s*$/u, '')
    .trim();
}

export function resolveEntityFieldSettings(entityType, data) {
  return data || buildFallbackEntityFieldSettings(entityType);
}

export function createEntityFieldPresentation(settings) {
  return {
    isVisible(fieldKey) {
      return isEntityFieldEnabled(settings, fieldKey);
    },
    isRequired(fieldKey) {
      return isEntityFieldRequired(settings, fieldKey);
    },
    withRequiredLabel(fieldKey, label) {
      const cleanLabel = sanitizeFieldLabel(label);
      return isEntityFieldRequired(settings, fieldKey) ? `${cleanLabel} *` : cleanLabel;
    },
    hasVisibleFields(fieldKeys) {
      return (Array.isArray(fieldKeys) ? fieldKeys : []).some((fieldKey) =>
        isEntityFieldEnabled(settings, fieldKey),
      );
    },
  };
}
