import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_PREFIX = '@field-work/help-center/v1';

export const HELP_CENTER_STATE_VERSION = 2;

export function createDefaultHelpCenterState(now = Date.now()) {
  return {
    version: HELP_CENTER_STATE_VERSION,
    preferences: {
      contextualHelpEnabled: true,
      smartTipsEnabled: true,
    },
    dismissedTipIds: [],
    usedFeatureIds: [],
    tipStats: {},
    featureSignals: null,
    activeUseMs: 0,
    sessionCount: 0,
    lastSessionStartedAt: null,
    lastTipAt: null,
    updatedAt: now,
  };
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
}

function normalizeTipStats(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  Object.entries(value).forEach(([key, stat]) => {
    const id = String(key || '').trim();
    if (!id || !stat || typeof stat !== 'object') return;
    result[id] = {
      shownCount: Math.max(0, Math.floor(Number(stat.shownCount) || 0)),
      lastShownAt: Number(stat.lastShownAt) || null,
      learnMoreOpenedAt: Number(stat.learnMoreOpenedAt) || null,
    };
  });
  return result;
}

function normalizeFeatureSignals(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const booleanOrNull = (item) => (typeof item === 'boolean' ? item : null);
  return {
    checkedAt: Number(value.checkedAt) || null,
    financeRulesEnabled: booleanOrNull(value.financeRulesEnabled),
    telegramBotEnabled: booleanOrNull(value.telegramBotEnabled),
    maxBotEnabled: booleanOrNull(value.maxBotEnabled),
    yandexDiskConnected: booleanOrNull(value.yandexDiskConnected),
  };
}

export function normalizeHelpCenterState(value, now = Date.now()) {
  const defaults = createDefaultHelpCenterState(now);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;

  return {
    ...defaults,
    version: HELP_CENTER_STATE_VERSION,
    preferences: {
      contextualHelpEnabled: value.preferences?.contextualHelpEnabled !== false,
      smartTipsEnabled: value.preferences?.smartTipsEnabled !== false,
    },
    dismissedTipIds: uniqueStrings(value.dismissedTipIds),
    usedFeatureIds: uniqueStrings(value.usedFeatureIds),
    tipStats: normalizeTipStats(value.tipStats),
    featureSignals: normalizeFeatureSignals(value.featureSignals),
    activeUseMs: Math.max(0, Number(value.activeUseMs) || 0),
    sessionCount: Math.max(0, Math.floor(Number(value.sessionCount) || 0)),
    lastSessionStartedAt: Number(value.lastSessionStartedAt) || null,
    lastTipAt: Number(value.lastTipAt) || null,
    updatedAt: Number(value.updatedAt) || now,
  };
}

function getStorageKey(userId) {
  const normalizedUserId = String(userId || '').trim();
  return normalizedUserId ? `${STORAGE_PREFIX}:${normalizedUserId}` : null;
}

export async function loadHelpCenterState(userId) {
  const key = getStorageKey(userId);
  if (!key) return createDefaultHelpCenterState();
  try {
    const raw = await AsyncStorage.getItem(key);
    return normalizeHelpCenterState(raw ? JSON.parse(raw) : null);
  } catch {
    return createDefaultHelpCenterState();
  }
}

export async function saveHelpCenterState(userId, state) {
  const key = getStorageKey(userId);
  if (!key) return false;
  const normalized = normalizeHelpCenterState({ ...state, updatedAt: Date.now() });
  await AsyncStorage.setItem(key, JSON.stringify(normalized));
  return true;
}
