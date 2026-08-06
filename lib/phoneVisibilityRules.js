import { getOrderStatusVariant } from '../src/features/orders/statusPresentation';

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MAX_OFFSET_DAYS = 30;
const MILLISECONDS_PER_MINUTE = 60 * 1000;
const DEFAULT_SHOW_OFFSET_HOURS = 12;
const DEFAULT_HIDE_OFFSET_HOURS = 6;

export const PHONE_VISIBILITY_RULE_VERSION = 1;
export const PHONE_VISIBILITY_START_CONDITIONS = Object.freeze([
  'always',
  'time_before_departure',
  'status',
  'never',
]);
export const PHONE_VISIBILITY_STOP_CONDITIONS = Object.freeze([
  'never',
  'time_after_departure',
  'status',
]);
export const PHONE_VISIBILITY_STATUS_OPTIONS = Object.freeze([
  'feed',
  'new',
  'in_progress',
  'done',
]);
export const PHONE_VISIBILITY_DURATION_UNITS = Object.freeze(['min', 'hour', 'day']);
export const PHONE_VISIBILITY_UNIT_TO_MINUTES = Object.freeze({
  min: 1,
  hour: MINUTES_PER_HOUR,
  day: MINUTES_PER_HOUR * HOURS_PER_DAY,
});
export const PHONE_VISIBILITY_MAX_OFFSET_MINS =
  MAX_OFFSET_DAYS * PHONE_VISIBILITY_UNIT_TO_MINUTES.day;

export const DEFAULT_PHONE_VISIBILITY_RULES = Object.freeze({
  version: PHONE_VISIBILITY_RULE_VERSION,
  start: {
    type: 'time_before_departure',
    offsetMins: DEFAULT_SHOW_OFFSET_HOURS * MINUTES_PER_HOUR,
    status: 'in_progress',
  },
  stop: {
    type: 'time_after_departure',
    offsetMins: DEFAULT_HIDE_OFFSET_HOURS * MINUTES_PER_HOUR,
    status: 'done',
  },
});

export function buildCompanyPhoneVisibilityPatch(rules) {
  const normalized = normalizePhoneVisibilityRules(rules);
  return {
    worker_phone_mode: getLegacyPhoneMode(normalized),
    worker_phone_window_before_mins:
      normalized.start.type === 'time_before_departure'
        ? normalized.start.offsetMins
        : DEFAULT_PHONE_VISIBILITY_RULES.start.offsetMins,
    worker_phone_window_after_mins:
      normalized.stop.type === 'time_after_departure'
        ? normalized.stop.offsetMins
        : DEFAULT_PHONE_VISIBILITY_RULES.stop.offsetMins,
    worker_phone_show_condition: normalized.start.type,
    worker_phone_show_offset_mins: normalized.start.offsetMins,
    worker_phone_show_status: normalized.start.status,
    worker_phone_hide_condition: normalized.stop.type,
    worker_phone_hide_offset_mins: normalized.stop.offsetMins,
    worker_phone_hide_status: normalized.stop.status,
  };
}

export function parsePhoneVisibilityRules(settings = {}) {
  const mode = String(settings?.worker_phone_mode || '').trim();
  const before = toNonNegativeInteger(
    settings?.worker_phone_window_before_mins,
    DEFAULT_PHONE_VISIBILITY_RULES.start.offsetMins,
  );
  const after = toNonNegativeInteger(
    settings?.worker_phone_window_after_mins,
    DEFAULT_PHONE_VISIBILITY_RULES.stop.offsetMins,
  );

  if (
    settings?.worker_phone_show_condition != null ||
    settings?.worker_phone_hide_condition != null
  ) {
    return normalizePhoneVisibilityRules({
      start: {
        type: settings?.worker_phone_show_condition,
        offsetMins: settings?.worker_phone_show_offset_mins,
        status: settings?.worker_phone_show_status,
      },
      stop: {
        type: settings?.worker_phone_hide_condition,
        offsetMins: settings?.worker_phone_hide_offset_mins,
        status: settings?.worker_phone_hide_status,
      },
    });
  }

  if (mode === 'always') {
    return normalizePhoneVisibilityRules({
      ...DEFAULT_PHONE_VISIBILITY_RULES,
      start: { type: 'always', offsetMins: 0, status: 'in_progress' },
      stop: { type: 'never', offsetMins: 0, status: 'done' },
    });
  }

  if (mode === 'off' || mode === 'never') {
    return normalizePhoneVisibilityRules({
      ...DEFAULT_PHONE_VISIBILITY_RULES,
      start: { type: 'never', offsetMins: 0, status: 'in_progress' },
      stop: { type: 'never', offsetMins: 0, status: 'done' },
    });
  }

  return normalizePhoneVisibilityRules({
    ...DEFAULT_PHONE_VISIBILITY_RULES,
    start: {
      type: 'time_before_departure',
      offsetMins: before,
      status: 'in_progress',
    },
    stop: {
      type: 'time_after_departure',
      offsetMins: after,
      status: 'done',
    },
  });
}

export function normalizePhoneVisibilityRules(rules = {}) {
  return {
    version: PHONE_VISIBILITY_RULE_VERSION,
    start: normalizeRule(
      rules.start,
      DEFAULT_PHONE_VISIBILITY_RULES.start,
      PHONE_VISIBILITY_START_CONDITIONS,
    ),
    stop: normalizeRule(
      rules.stop,
      DEFAULT_PHONE_VISIBILITY_RULES.stop,
      PHONE_VISIBILITY_STOP_CONDITIONS,
    ),
  };
}

export function phoneVisibilityMinutesToDuration(minutes) {
  const value = Math.max(0, Number(minutes) || 0);
  if (value > 0 && value % PHONE_VISIBILITY_UNIT_TO_MINUTES.day === 0) {
    return { value: String(value / PHONE_VISIBILITY_UNIT_TO_MINUTES.day), unit: 'day' };
  }
  if (value > 0 && value % PHONE_VISIBILITY_UNIT_TO_MINUTES.hour === 0) {
    return { value: String(value / PHONE_VISIBILITY_UNIT_TO_MINUTES.hour), unit: 'hour' };
  }
  return { value: String(value), unit: 'min' };
}

export function phoneVisibilityDurationToMinutes(value, unit) {
  const numeric = Math.max(0, Number(String(value || '').replace(/[^0-9]/g, '')) || 0);
  const unitMultiplier = PHONE_VISIBILITY_UNIT_TO_MINUTES[unit] ||
    PHONE_VISIBILITY_UNIT_TO_MINUTES.min;
  return Math.min(numeric * unitMultiplier, PHONE_VISIBILITY_MAX_OFFSET_MINS);
}

export function getLegacyPhoneWindowValues(rules = {}) {
  const normalized = normalizePhoneVisibilityRules(rules);
  return {
    beforeMins:
      normalized.start.type === 'time_before_departure'
        ? normalized.start.offsetMins
        : DEFAULT_PHONE_VISIBILITY_RULES.start.offsetMins,
    afterMins:
      normalized.stop.type === 'time_after_departure'
        ? normalized.stop.offsetMins
        : DEFAULT_PHONE_VISIBILITY_RULES.stop.offsetMins,
  };
}

export function shouldShowOrderPhoneForRole(order, settings, role) {
  if (String(role || '').toLowerCase() !== 'worker') return true;
  return shouldShowOrderPhone(order, parsePhoneVisibilityRules(settings), new Date(), settings?.timezone);
}

export function shouldShowOrderPhone(order, rules, nowInput = new Date(), timeZone = null) {
  const normalized = normalizePhoneVisibilityRules(rules);
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  const started = isRuleSatisfied(normalized.start, order, now, 'start', timeZone);
  if (!started) return false;
  return !isRuleSatisfied(normalized.stop, order, now, 'stop', timeZone);
}

export function formatPhoneVisibilitySummary(rules, t) {
  const normalized = normalizePhoneVisibilityRules(rules);
  if (normalized.start.type === 'never') return t('settings_phone_rule_summary_never');
  if (normalized.start.type === 'always' && normalized.stop.type === 'never') {
    return t('settings_phone_rule_summary_always');
  }
  const start = formatRuleSummary(normalized.start, t, 'start');
  const stop = normalized.stop.type === 'never'
    ? t('settings_phone_rule_summary_no_stop')
    : formatRuleSummary(normalized.stop, t, 'stop');
  return `${start}; ${stop}`;
}

function normalizeRule(rule, fallback, allowedTypes) {
  const type = allowedTypes.includes(String(rule?.type || '')) ? String(rule.type) : fallback.type;
  return {
    type,
    offsetMins: toNonNegativeInteger(rule?.offsetMins, fallback.offsetMins),
    status: normalizeStatusId(rule?.status || fallback.status),
  };
}

function getLegacyPhoneMode(rules) {
  if (rules.start.type === 'never') return 'off';
  if (rules.start.type === 'always' && rules.stop.type === 'never') return 'always';
  return 'window';
}

function isRuleSatisfied(rule, order, now, scope, timeZone) {
  if (!rule || rule.type === 'never') return false;
  if (rule.type === 'always') return scope === 'start';
  if (rule.type === 'time_before_departure') {
    const departure = getDepartureDate(order, timeZone);
    if (!departure) return false;
    return now.getTime() >= departure.getTime() - rule.offsetMins * MILLISECONDS_PER_MINUTE;
  }
  if (rule.type === 'time_after_departure') {
    const departure = getDepartureDate(order, timeZone);
    if (!departure) return false;
    return now.getTime() >= departure.getTime() + rule.offsetMins * MILLISECONDS_PER_MINUTE;
  }
  if (rule.type === 'status') {
    if (normalizeStatusId(getOrderStatusVariant(order?.status)) !== rule.status) return false;
    if (!rule.offsetMins) return true;
    const changedAt = getStatusReferenceDate(order);
    if (!changedAt) return false;
    return now.getTime() >= changedAt.getTime() + rule.offsetMins * MILLISECONDS_PER_MINUTE;
  }
  return false;
}

function getDepartureDate(order, timeZone) {
  if (order?.departure_at) {
    const parsedDepartureAt = new Date(order.departure_at);
    return Number.isNaN(parsedDepartureAt.getTime()) ? null : parsedDepartureAt;
  }

  const dateOnly = parseDateOnly(order?.time_window_start || order?.departure_date);
  if (dateOnly) {
    const time = parseTimeOnly(order?.departure_time) || { hour: 23, minute: 59, second: 59 };
    return zonedTimeToDate(
      dateOnly.year,
      dateOnly.month,
      dateOnly.day,
      time.hour,
      time.minute,
      time.second,
      timeZone,
    );
  }

  const raw = order?.time_window_start || order?.departure_date;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getStatusReferenceDate(order) {
  const raw = order?.status_changed_at || order?.updated_at || order?.created_at;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatRuleSummary(rule, t, scope) {
  if (rule.type === 'always') return t('settings_phone_rule_summary_always');
  if (rule.type === 'never') return t('settings_phone_rule_summary_never');
  const statusLabel = t(`phone_visibility_status_${rule.status}`, rule.status);
  if (rule.type === 'status') {
    return rule.offsetMins > 0
      ? t(
          scope === 'start' ? 'phone_visibility_summary_after_status_delay' : 'phone_visibility_summary_hide_after_status_delay',
        )
          .replace('{status}', statusLabel)
          .replace('{delay}', formatDuration(rule.offsetMins, t))
      : t(
          scope === 'start' ? 'phone_visibility_summary_on_status' : 'phone_visibility_summary_hide_on_status',
        ).replace('{status}', statusLabel);
  }
  if (rule.type === 'time_before_departure' && rule.offsetMins === 0) {
    return t('phone_visibility_summary_at_departure');
  }
  if (rule.type === 'time_after_departure' && rule.offsetMins === 0) {
    return t('phone_visibility_summary_immediately_after_departure');
  }
  return rule.type === 'time_before_departure'
    ? t('phone_visibility_summary_before_departure').replace('{delay}', formatDuration(rule.offsetMins, t))
    : t('phone_visibility_summary_after_departure').replace('{delay}', formatDuration(rule.offsetMins, t));
}

function formatDuration(mins, t) {
  const value = toNonNegativeInteger(mins, 0);
  if (value === 0) return t('phone_visibility_delay_immediately');
  if (value % PHONE_VISIBILITY_UNIT_TO_MINUTES.day === 0) {
    return `${value / PHONE_VISIBILITY_UNIT_TO_MINUTES.day} ${t('unit_days_short')}`;
  }
  if (value % PHONE_VISIBILITY_UNIT_TO_MINUTES.hour === 0) {
    return `${value / PHONE_VISIBILITY_UNIT_TO_MINUTES.hour} ${t('unit_hours_short')}`;
  }
  return `${value} ${t('unit_minutes_short')}`;
}

function normalizeStatusId(value) {
  const raw = String(value || '').trim();
  if (raw === 'progress') return 'in_progress';
  if (raw === 'completed') return 'done';
  if (raw === 'in_feed') return 'feed';
  if (['feed', 'new', 'in_progress', 'done'].includes(raw)) return raw;
  return getOrderStatusVariant(raw);
}

function parseDateOnly(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function parseTimeOnly(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return null;
  }
  return { hour, minute, second };
}

function zonedTimeToDate(year, month, day, hour, minute, second, timeZone) {
  const fallback = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const tz = normalizeTimeZone(timeZone);
  if (!tz) return fallback;
  try {
    const offsetMs = getTimeZoneOffsetMs(fallback, tz);
    const candidate = new Date(fallback.getTime() - offsetMs);
    const correctedOffsetMs = getTimeZoneOffsetMs(candidate, tz);
    return new Date(fallback.getTime() - correctedOffsetMs);
  } catch {
    return fallback;
  }
}

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return asUtc - date.getTime();
}

function normalizeTimeZone(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: raw }).format(new Date());
    return raw;
  } catch {
    return null;
  }
}

function toNonNegativeInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return Math.min(Math.round(numeric), PHONE_VISIBILITY_MAX_OFFSET_MINS);
}
