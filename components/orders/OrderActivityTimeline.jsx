import { Feather } from '@expo/vector-icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { resolveDateFnsLocale } from '../../lib/localeFormatting';
import { usePermissions } from '../../lib/permissions';
import { fetchOrderActivityPage } from '../../src/features/requests/activity';
import { buildOrderAddressDisplay } from '../../src/features/requests/addressing';
import { useTranslation } from '../../src/i18n/useTranslation';
import { queryKeys } from '../../src/shared/query/queryKeys';
import { withReadDeadline } from '../../src/shared/network/readDeadline';
import {
  canRunDeferredNetworkWork,
  useOfflineSnapshot,
} from '../../src/shared/offline/offlineStatus';
import { useTheme } from '../../theme';
import Button from '../ui/Button';

const PAGE_SIZE = 20;
const RELATION_SNAPSHOT_FIELDS = new Set([
  'phone', 'address_mode', 'country', 'region', 'district', 'city', 'street',
  'house', 'postal_code', 'floor', 'entrance', 'apartment', 'entrance_info',
  'parking_notes', 'geo_lat', 'geo_lng',
]);
const FIELD_KEYS = {
  title: 'order_activity_field_title', status: 'order_details_status', assigned_to: 'order_details_executor',
  client_id: 'order_activity_field_client', object_id: 'order_activity_field_object', work_type_id: 'order_details_work_type',
  comment: 'order_details_description', urgent: 'order_details_urgent', time_window_start: 'order_activity_field_departure_start',
  time_window_end: 'order_activity_field_departure_end', departure_time: 'order_activity_field_departure_time',
  arrival_at: 'order_activity_field_arrival', departure_at: 'order_activity_field_departure_actual', duration_min: 'order_activity_field_duration',
  address_mode: 'order_activity_field_address_mode', country: 'order_activity_field_country', region: 'order_activity_field_region',
  city: 'order_activity_field_city', street: 'order_activity_field_street', house: 'order_activity_field_house',
  postal_code: 'order_activity_field_postal_code', floor: 'order_activity_field_floor', entrance: 'order_activity_field_entrance',
  apartment: 'order_activity_field_apartment', entrance_info: 'order_activity_field_entrance_info', parking_notes: 'order_activity_field_parking',
  geo_lat: 'order_activity_field_coordinates', geo_lng: 'order_activity_field_coordinates', district: 'order_activity_field_district',
  tags: 'order_activity_field_tags', phone: 'order_details_phone', completed_at: 'order_activity_field_completed_at',
  creation_source: 'order_activity_field_creation_source', start_price: 'order_activity_field_initial_amount', currency: 'order_activity_field_currency',
  payment_status: 'order_activity_field_payment_status', payment_method: 'order_activity_field_payment_method',
  finance_income_total: 'order_activity_field_income', finance_expense_total: 'order_activity_field_expense',
  finance_discount_total: 'order_activity_field_discount', finance_gross_total: 'order_activity_field_total_amount',
  finance_net_total: 'order_activity_field_net', finance_money_holder: 'order_activity_field_money_holder',
  finance_scheme_disabled: 'order_activity_field_finance_scheme', kind: 'order_activity_field_kind', note: 'order_activity_field_note',
  calc_mode: 'order_activity_field_calc_mode', input_amount: 'order_activity_field_amount', input_percent: 'order_activity_field_percent',
  percent_base: 'order_activity_field_percent_base', calculated_amount: 'order_activity_field_amount',
  recipient_user_id: 'order_activity_field_recipient', visibility_scope: 'order_activity_field_visibility',
  is_system: 'order_activity_field_system', expense_payer: 'order_activity_field_expense_payer',
  finance_effect: 'order_activity_field_finance_effect', amount: 'order_activity_field_amount', paid_at: 'order_activity_field_paid_at',
  source: 'order_activity_field_source', money_holder: 'order_activity_field_money_holder',
  media_file_1: 'order_activity_field_photos', media_file_2: 'order_activity_field_photos',
  media_file_3: 'order_activity_field_photos', media_file_4: 'order_activity_field_photos',
  media_file_5: 'order_activity_field_photos',
};

const detailFieldKey = (event, field) => (
  event.entityType === 'order_finance_entries' && field === 'title'
    ? 'order_activity_field_finance_title'
    : FIELD_KEYS[field] || 'order_activity_field_other'
);

const SENTENCE_FIELD_KEYS = {
  title: 'order_activity_sentence_field_title',
  status: 'order_activity_sentence_field_status',
  assigned_to: 'order_activity_sentence_field_assignee',
  client_id: 'order_activity_sentence_field_client',
  object_id: 'order_activity_sentence_field_object',
  work_type_id: 'order_activity_sentence_field_work_type',
  comment: 'order_activity_sentence_field_comment',
  urgent: 'order_activity_sentence_field_urgent',
  time_window_start: 'order_activity_sentence_field_departure_start',
  time_window_end: 'order_activity_sentence_field_departure_end',
  departure_time: 'order_activity_sentence_field_departure_time',
  arrival_at: 'order_activity_sentence_field_arrival',
  departure_at: 'order_activity_sentence_field_departure_actual',
  duration_min: 'order_activity_sentence_field_duration',
  address_mode: 'order_activity_sentence_field_address_mode',
  country: 'order_activity_sentence_field_country',
  region: 'order_activity_sentence_field_region',
  city: 'order_activity_sentence_field_city',
  street: 'order_activity_sentence_field_street',
  house: 'order_activity_sentence_field_house',
  postal_code: 'order_activity_sentence_field_postal_code',
  floor: 'order_activity_sentence_field_floor',
  entrance: 'order_activity_sentence_field_entrance',
  apartment: 'order_activity_sentence_field_apartment',
  entrance_info: 'order_activity_sentence_field_entrance_info',
  parking_notes: 'order_activity_sentence_field_parking',
  geo_lat: 'order_activity_sentence_field_coordinates',
  geo_lng: 'order_activity_sentence_field_coordinates',
  district: 'order_activity_sentence_field_district',
  tags: 'order_activity_sentence_field_tags',
  phone: 'order_activity_sentence_field_phone',
  completed_at: 'order_activity_sentence_field_completed_at',
  creation_source: 'order_activity_sentence_field_creation_source',
  start_price: 'order_activity_sentence_field_initial_amount',
  currency: 'order_activity_sentence_field_currency',
  finance_gross_total: 'order_activity_sentence_field_total_amount',
  finance_income_total: 'order_activity_sentence_field_income_total',
  finance_expense_total: 'order_activity_sentence_field_expense_total',
  finance_discount_total: 'order_activity_sentence_field_discount_total',
  finance_net_total: 'order_activity_sentence_field_net_total',
  finance_money_holder: 'order_activity_sentence_field_money_holder',
  finance_scheme_disabled: 'order_activity_sentence_field_finance_scheme',
  payment_status: 'order_activity_sentence_field_payment_status',
  payment_method: 'order_activity_sentence_field_payment_method',
  kind: 'order_activity_sentence_field_kind',
  note: 'order_activity_sentence_field_note',
  calc_mode: 'order_activity_sentence_field_calc_mode',
  input_amount: 'order_activity_sentence_field_input_amount',
  input_percent: 'order_activity_sentence_field_percent',
  percent_base: 'order_activity_sentence_field_percent_base',
  calculated_amount: 'order_activity_sentence_field_calculated_amount',
  recipient_user_id: 'order_activity_sentence_field_recipient',
  visibility_scope: 'order_activity_sentence_field_visibility',
  is_system: 'order_activity_sentence_field_system',
  expense_payer: 'order_activity_sentence_field_expense_payer',
  finance_effect: 'order_activity_sentence_field_finance_effect',
  amount: 'order_activity_sentence_field_payment_amount',
  paid_at: 'order_activity_sentence_field_paid_at',
  source: 'order_activity_sentence_field_source',
  money_holder: 'order_activity_sentence_field_money_holder',
};

const STATUS_TRANSLATION_KEYS = {
  feed: 'order_status_in_feed',
  new: 'order_status_new',
  in_progress: 'order_status_in_progress',
  done: 'order_status_completed',
  completed: 'order_status_completed',
  waiting: 'order_status_waiting',
};

const isEmptyValue = (value, ref) => !ref && (value === null || value === undefined || value === '');

const capitalizeNamePart = (value, locale) => {
  const text = String(value || '').trim();
  if (!text) return '';
  return `${text.charAt(0).toLocaleUpperCase(locale === 'ru' ? 'ru-RU' : 'en-US')}${text.slice(1)}`;
};

const actorDisplayName = (event, locale, fallback) => {
  const actor = event.context?.actor || {};
  const structured = [actor.firstName, actor.middleName, actor.lastName]
    .map((part) => capitalizeNamePart(part, locale))
    .filter(Boolean)
    .join(' ');
  if (structured) return structured;
  const plain = String(event.actorName || '').trim();
  return plain ? plain.split(/\s+/).map((part) => capitalizeNamePart(part, locale)).join(' ') : fallback;
};

const inferRussianActorGender = (event) => {
  if (!event.actorUserId) return null;
  const actor = event.context?.actor || {};
  const middleName = String(actor.middleName || '').toLocaleLowerCase('ru-RU');
  if (/(овна|евна|ична|инична)$/.test(middleName)) return 'female';
  if (/(ович|евич|ич)$/.test(middleName)) return 'male';
  const firstName = String(actor.firstName || '').toLocaleLowerCase('ru-RU');
  if (!firstName) return null;
  if (['никита', 'илья', 'лука', 'кузьма', 'фома', 'савва'].includes(firstName)) return 'male';
  if (/[ая]$/.test(firstName)) return 'female';
  if (/[бвгджзклмнпрстфхцчшщй]$/.test(firstName)) return 'male';
  return null;
};

const formatEventDateTime = (value, locale) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
};

const formatOrderDate = (value, locale) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(value || '');
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return String(value || '');
  return format(date, 'd MMMM yyyy', { locale: resolveDateFnsLocale(locale) });
};

const formatOrderDateTime = (value, locale) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '');
  return format(date, 'd MMMM yyyy, HH:mm', { locale: resolveDateFnsLocale(locale) });
};

const formatDepartureTime = (value) => {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return String(value || '');
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
};

const SUMMARY_FIELD_PRIORITY = [
  'status', 'assigned_to', 'client_id', 'object_id', 'payment_status',
  'finance_gross_total', 'start_price', 'amount', 'input_amount', 'input_percent',
  'calculated_amount', 'title', 'comment',
];

const primaryChangeForEvent = (event, changes = event.changes) => (
  SUMMARY_FIELD_PRIORITY.map((field) => changes.find((change) => change.field === field)).find(Boolean)
  || changes[0]
  || null
);

const valueLooksLong = (value) => {
  if (Array.isArray(value)) return value.length > 3 || value.join(', ').length > 56;
  if (value && typeof value === 'object') return true;
  return String(value ?? '').length > 56;
};

const meaningfulChangesForEvent = (event) => {
  let changes = event.changes;
  const hasStatusChange = event.entityType === 'orders'
    && event.action === 'update'
    && event.changes.some((change) => change.field === 'status');
  if (hasStatusChange) {
    changes = changes.filter((change) => change.field !== 'completed_at');
  }
  const hasOrderRelationChange = event.entityType === 'orders'
    && event.action === 'update'
    && changes.some((change) => ['client_id', 'object_id'].includes(change.field));
  if (hasOrderRelationChange) {
    changes = changes.filter((change) => !RELATION_SNAPSHOT_FIELDS.has(change.field));
  }
  if (event.entityType === 'order_finance_entries' && event.action !== 'update') {
    const titleShownInSummary = Boolean(String(event.context.title || '').trim());
    const amountShownInSummary = event.context.amount !== null && event.context.amount !== undefined;
    changes = changes.filter((change) => (
      !(titleShownInSummary && change.field === 'title')
      && !(amountShownInSummary && ['input_amount', 'calculated_amount'].includes(change.field))
    ));
  }
  return changes;
};

const inlineFinanceNoteForEvent = (event, changes) => {
  if (event.entityType !== 'order_finance_entries'
      || event.action === 'update'
      || changes.length !== 1
      || changes[0].field !== 'note'
      || changes[0].redacted) return '';
  const value = event.action === 'delete' ? changes[0].before : changes[0].after;
  const note = String(value || '').trim();
  return note && !valueLooksLong(note) ? note : '';
};

const eventNeedsDisclosure = (event, changes) => {
  const hasInlineFinanceNote = Boolean(inlineFinanceNoteForEvent(event, changes));
  return changes.length > 1
    || (event.entityType !== 'orders' && event.action !== 'update' && changes.length > 0 && !hasInlineFinanceNote)
    || changes.some((change) => !change.redacted
      && (valueLooksLong(change.before) || valueLooksLong(change.after)));
};

export default function OrderActivityTimeline({ orderId, version, active = true, onNavigateReference }) {
  const router = useRouter();
  const { theme } = useTheme();
  const { t, locale } = useTranslation();
  const { has } = usePermissions();
  const offlineSnapshot = useOfflineSnapshot();
  const canUseActivityNetwork = canRunDeferredNetworkWork(offlineSnapshot);
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const [expandedEventIds, setExpandedEventIds] = React.useState(() => new Set());
  const canView = has('canViewOrderHistory');
  const query = useInfiniteQuery({
    queryKey: queryKeys.requests.activity(orderId),
    queryFn: ({ pageParam, signal }) =>
      withReadDeadline(
        (deadlineSignal) => fetchOrderActivityPage({
          orderId,
          limit: PAGE_SIZE,
          cursor: pageParam,
          signal: deadlineSignal,
        }),
        { label: 'Order activity', signal },
      ),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(orderId && canView && active && canUseActivityNetwork),
    staleTime: 30_000,
    networkMode: 'offlineFirst',
    refetchInterval: active && canUseActivityNetwork ? 30_000 : false,
    refetchIntervalInBackground: false,
  });
  const previousVersion = React.useRef(version);
  React.useEffect(() => {
    if (!previousVersion.current || !version || previousVersion.current === version) {
      previousVersion.current = version;
      return;
    }
    previousVersion.current = version;
    if (active && canUseActivityNetwork) query.refetch();
  }, [active, canUseActivityNetwork, query, version]);

  if (!canView) return null;
  const events = query.data?.pages?.flatMap((page) => page.events) || [];

  const openReference = (ref) => {
    if (!ref?.available || !ref.entityId) return;
    let route = '';
    if (ref.entityType === 'user' && has('canViewClients')) route = `/users/${ref.entityId}`;
    if (ref.entityType === 'client' && has('canViewClients')) route = `/clients/${ref.entityId}`;
    if (ref.entityType === 'object' && has('canViewObjects')) route = `/objects/${ref.entityId}`;
    if (!route) return;
    if (typeof onNavigateReference === 'function') onNavigateReference(route);
    else router.push(route);
  };
  const canOpenReference = (ref) => ref?.available && (
    (ref.entityType === 'user' && has('canViewClients')) ||
    (ref.entityType === 'client' && has('canViewClients')) ||
    (ref.entityType === 'object' && has('canViewObjects'))
  );
  const renderReference = (ref, fallback, compact = false) => {
    if (!ref) return <Text numberOfLines={compact ? 1 : undefined} style={styles.valueText}>{fallback}</Text>;
    const label = ref.label || fallback;
    return <Pressable accessibilityRole={canOpenReference(ref) ? 'link' : undefined} disabled={!canOpenReference(ref)} onPress={() => openReference(ref)} hitSlop={6}><Text numberOfLines={compact ? 1 : undefined} style={[styles.valueText, canOpenReference(ref) && styles.linkText]}>{label}</Text></Pressable>;
  };
  const formatValueText = (field, value, valueType, currency = 'RUB') => {
    if (field === 'object_id' && (value === null || value === undefined || value === '')) {
      return t('order_object_without_address');
    }
    if (value === null || value === undefined || value === '') return t('order_activity_value_empty');
    if (typeof value === 'boolean') return value ? t('order_activity_yes') : t('order_activity_no');
    if (Array.isArray(value)) return value.length ? value.map(String).join(', ') : t('order_activity_value_empty');
    if (valueType === 'media_count') {
      const count = Math.max(0, Number(value) || 0);
      const mod10 = count % 10;
      const mod100 = count % 100;
      const pluralKey = locale === 'ru'
        ? (mod10 === 1 && mod100 !== 11 ? 'one' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'few' : 'many')
        : (count === 1 ? 'one' : 'many');
      return t(`order_activity_photo_count_${pluralKey}`).replace('{count}', String(count));
    }
    const text = String(value);
    const enumKeys = {
      status: `order_status_${text}`,
      address_mode: `order_activity_address_mode_${text}`,
      payment_status: `order_payment_status_${text}`,
      payment_method: `order_payment_method_${text}`,
      kind: `finance_kind_${text}`,
      money_holder: `finance_money_holder_${text}`,
      finance_money_holder: `finance_money_holder_${text}`,
      expense_payer: `finance_expense_payer_${text}`,
      finance_effect: `finance_effect_${text}`,
      calc_mode: `finance_calc_${text}`,
      percent_base: `order_activity_percent_base_${text}`,
      creation_source: `order_activity_creation_source_${text}`,
      source: `order_activity_source_${text}`,
      visibility_scope: `order_activity_visibility_${text}`,
    };
    let display = enumKeys[field] ? t(enumKeys[field], text) : text;
    if (typeof value === 'number' && ['start_price', 'amount', 'input_amount', 'calculated_amount', 'finance_income_total', 'finance_expense_total', 'finance_discount_total', 'finance_gross_total', 'finance_net_total'].includes(field)) {
      try {
        display = new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'en-US', { style: 'currency', currency: currency || 'RUB', maximumFractionDigits: 2 }).format(value);
      } catch {
        display = String(value);
      }
    } else if (typeof value === 'number' && field === 'input_percent') {
      display = `${value}%`;
    } else if (field === 'departure_time') {
      display = formatDepartureTime(text);
    } else if (['time_window_start', 'time_window_end'].includes(field) && /^\d{4}-\d{2}-\d{2}$/.test(text)) {
      display = formatOrderDate(text, locale);
    } else if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
      display = formatOrderDateTime(text, locale);
    }
    return display;
  };
  const valueNode = (field, value, ref, valueType, compact = false, currency = 'RUB') => {
    if (ref) {
      const statusKey = field === 'status' ? STATUS_TRANSLATION_KEYS[ref.label] : null;
      const translatedRef = statusKey ? { ...ref, label: t(statusKey, ref.label) } : ref;
      return renderReference(translatedRef, t('order_activity_value_empty'), compact);
    }
    const display = formatValueText(field, value, valueType, currency);
    const empty = field === 'object_id' ? false : isEmptyValue(value, ref);
    return <Text numberOfLines={compact ? 1 : undefined} ellipsizeMode="tail" style={empty ? styles.emptyValue : styles.valueText}>{display}</Text>;
  };

  const toggleEvent = (eventId) => {
    setExpandedEventIds((current) => {
      const next = new Set(current);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  };

  const renderChange = (event, change, index, compact, currency) => {
    const beforeAddress = change.field === 'object_id'
      ? buildOrderAddressDisplay(event.context.beforeAddress)
      : '';
    const afterAddress = change.field === 'object_id'
      ? buildOrderAddressDisplay(event.context.afterAddress)
      : '';
    return (
      <View key={`${change.field}-${index}`} style={styles.changeRow}>
        <Text style={styles.changeLabel}>{t(detailFieldKey(event, change.field))}</Text>
        {change.redacted ? (
          <Text style={styles.redactedText}>{t('order_activity_value_redacted')}</Text>
        ) : (
          <View style={styles.valuesRow}>
            <View style={styles.valueSide}>
              {valueNode(change.field, change.before, change.beforeRef, change.valueType, compact, currency)}
              {beforeAddress ? <Text style={styles.objectAddressText}>{beforeAddress}</Text> : null}
            </View>
            <Feather name="arrow-right" size={14} color={theme.colors.textSecondary} />
            <View style={styles.valueSide}>
              {valueNode(change.field, change.after, change.afterRef, change.valueType, compact, currency)}
              {afterAddress ? <Text style={styles.objectAddressText}>{afterAddress}</Text> : null}
            </View>
          </View>
        )}
      </View>
    );
  };

  const renderNarrative = (event, primaryChange, meaningfulChanges) => {
    const hasActor = Boolean(event.actorUserId);
    const actorFallback = t('order_activity_unknown_actor');
    const actorName = actorDisplayName(event, locale, actorFallback);
    const actorRef = hasActor ? {
      entityType: 'user', entityId: event.actorUserId, label: actorName,
      available: Boolean(event.actorName || event.context?.actor?.firstName || event.context?.actor?.lastName),
    } : null;
    const actorCanOpen = canOpenReference(actorRef);
    const gender = locale === 'ru' ? inferRussianActorGender(event) : 'male';
    const actorNode = (
      <Text
        accessibilityRole={actorCanOpen ? 'link' : undefined}
        onPress={actorCanOpen ? () => openReference(actorRef) : undefined}
        style={actorCanOpen ? styles.summaryLink : styles.summaryActor}
      >
        {actorName}
      </Text>
    );
    const verb = (action) => t(`order_activity_verb_${action}_${gender || 'male'}`);
    const passiveKey = event.entityType === 'orders'
      ? (event.action === 'insert' ? 'order_activity_created' : 'order_activity_updated')
      : event.entityType === 'order_finance_entries'
        ? `order_activity_finance_${event.action}`
        : `order_activity_payment_${event.action}`;
    const lowerFirst = (value) => {
      const text = String(value || '');
      return text ? `${text.charAt(0).toLocaleLowerCase(locale === 'ru' ? 'ru-RU' : 'en-US')}${text.slice(1)}` : text;
    };
    const inlineValue = (change, side) => {
      const ref = side === 'before' ? change.beforeRef : change.afterRef;
      const value = side === 'before' ? change.before : change.after;
      if (ref) {
        const statusKey = change.field === 'status' ? STATUS_TRANSLATION_KEYS[ref.label] : null;
        const label = statusKey ? t(statusKey, ref.label) : ref.label;
        const canOpen = canOpenReference(ref);
        return (
          <Text
            accessibilityRole={canOpen ? 'link' : undefined}
            onPress={canOpen ? () => openReference(ref) : undefined}
            style={canOpen ? styles.summaryLink : styles.summaryValue}
          >
            {label || t('order_activity_value_empty')}
          </Text>
        );
      }
      const display = formatValueText(change.field, value, change.valueType, event.context.currency || 'RUB');
      const shouldQuote = typeof value === 'string'
        && ['status', 'title', 'payment_status', 'payment_method', 'address_mode', 'creation_source', 'kind', 'calc_mode', 'visibility_scope', 'source', 'money_holder'].includes(change.field)
        && !/^\d{4}-\d{2}-\d{2}T/.test(value);
      return <Text style={styles.summaryValue}>{shouldQuote ? `«${display}»` : display}</Text>;
    };

    if (event.action === 'update' && meaningfulChanges.length > 1) {
      const objectKey = event.entityType === 'orders'
        ? 'order_activity_sentence_request_data'
        : event.entityType === 'order_finance_entries'
          ? 'order_activity_sentence_finance_entry'
          : 'order_activity_sentence_customer_payment';
      const title = event.entityType === 'order_finance_entries'
        ? String(event.context.title || '').trim()
        : '';
      const titleSuffix = title ? ` «${title}»` : '';
      if (!hasActor) return <Text style={styles.summaryText}>{`${t(passiveKey)}.`}</Text>;
      return <Text style={styles.summaryText}>{actorNode}{` ${verb('updated')} ${t(objectKey)}${titleSuffix}.`}</Text>;
    }

    const isPhotoChange = primaryChange?.valueType === 'media_count' || primaryChange?.field?.startsWith('media_file_');
    if (event.entityType === 'orders' && event.action === 'update' && primaryChange && isPhotoChange) {
      const beforeCount = Math.max(0, Number(primaryChange.before) || 0);
      const afterCount = Math.max(0, Number(primaryChange.after) || 0);
      const summaryCount = (count) => locale === 'ru'
        ? t('order_activity_photo_summary_count').replace('{count}', String(count))
        : formatValueText(primaryChange.field, count, 'media_count');
      if (!hasActor) {
        if (afterCount > beforeCount) {
          const passiveKey = afterCount - beforeCount === 1
            ? 'order_activity_sentence_photo_added_passive_one'
            : 'order_activity_sentence_photo_added_passive_many';
          return <Text style={styles.summaryText}>{`${t(passiveKey)}: ${t('order_activity_sentence_was')} ${summaryCount(beforeCount)}, ${t('order_activity_sentence_became')} ${summaryCount(afterCount)}.`}</Text>;
        }
        if (afterCount < beforeCount) {
          const passiveKey = beforeCount - afterCount === 1
            ? 'order_activity_sentence_photo_deleted_passive_one'
            : 'order_activity_sentence_photo_deleted_passive_many';
          return <Text style={styles.summaryText}>{`${t(passiveKey)}: ${t('order_activity_sentence_was')} ${summaryCount(beforeCount)}, ${t('order_activity_sentence_became')} ${summaryCount(afterCount)}.`}</Text>;
        }
        return <Text style={styles.summaryText}>{`${t('order_activity_sentence_photos_updated_passive')}. ${t('order_activity_sentence_photo_count')}: ${summaryCount(afterCount)}.`}</Text>;
      }
      if (!gender) {
        return <Text style={styles.summaryText}>{actorNode}{` — ${t('order_activity_sentence_photo_count_changed')}: ${t('order_activity_sentence_was')} ${summaryCount(beforeCount)}, ${t('order_activity_sentence_became')} ${summaryCount(afterCount)}.`}</Text>;
      }
      if (afterCount > beforeCount) {
        const photoKey = afterCount - beforeCount === 1
          ? 'order_activity_sentence_photo_one'
          : 'order_activity_sentence_photo_many';
        return <Text style={styles.summaryText}>{actorNode}{` ${verb('added')} ${t(photoKey)} ${t('order_activity_sentence_photo_to_request')}: ${t('order_activity_sentence_was')} ${summaryCount(beforeCount)}, ${t('order_activity_sentence_became')} ${summaryCount(afterCount)}.`}</Text>;
      }
      if (afterCount < beforeCount) {
        const photoKey = beforeCount - afterCount === 1
          ? 'order_activity_sentence_photo_one'
          : 'order_activity_sentence_photo_many';
        return <Text style={styles.summaryText}>{actorNode}{` ${verb('deleted')} ${t(photoKey)} ${t('order_activity_sentence_photo_from_request')}: ${t('order_activity_sentence_was')} ${summaryCount(beforeCount)}, ${t('order_activity_sentence_became')} ${summaryCount(afterCount)}.`}</Text>;
      }
      return <Text style={styles.summaryText}>{actorNode}{` ${verb('updated')} ${t('order_activity_sentence_photos_in_request')}. ${t('order_activity_sentence_photo_count')}: ${summaryCount(afterCount)}.`}</Text>;
    }

    if (event.entityType === 'order_finance_entries' && event.action === 'update' && primaryChange) {
      const entryTitle = String(event.context.title || '').trim();
      const entryTitleSuffix = entryTitle ? ` «${entryTitle}»` : '';
      const fieldLabel = t(FIELD_KEYS[primaryChange.field] || 'order_activity_field_other');
      const fieldKey = primaryChange.field === 'title'
        ? 'order_activity_sentence_field_finance_title'
        : ['input_amount', 'calculated_amount'].includes(primaryChange.field)
          ? 'order_activity_sentence_field_finance_amount'
          : SENTENCE_FIELD_KEYS[primaryChange.field];
      const field = fieldKey
        ? t(fieldKey)
        : t('order_activity_sentence_field_generic').replace('{field}', fieldLabel);
      const fieldAlreadyNamesEntry = ['title', 'kind', 'visibility_scope', 'is_system', 'finance_effect']
        .includes(primaryChange.field);
      const fieldWithEntry = entryTitle
        ? fieldAlreadyNamesEntry
          ? `${field}${entryTitleSuffix}`
          : `${field} ${t('order_activity_sentence_in_finance_entry')}${entryTitleSuffix}`
        : field;
      const subject = `${t('order_activity_sentence_finance_entry_subject')}${entryTitleSuffix}`;
      if (!hasActor) {
        if (primaryChange.redacted) {
          return <Text style={styles.summaryText}>{`${subject} — ${fieldLabel}. ${t('order_activity_value_redacted')}.`}</Text>;
        }
        if (valueLooksLong(primaryChange.before) || valueLooksLong(primaryChange.after)) {
          return <Text style={styles.summaryText}>{`${subject} — ${fieldLabel}.`}</Text>;
        }
        return <Text style={styles.summaryText}>{`${subject} — ${fieldLabel}: `}{inlineValue(primaryChange, 'before')}{' → '}{inlineValue(primaryChange, 'after')}{'.'}</Text>;
      }
      if (!gender) {
        return <Text style={styles.summaryText}>{actorNode}{` — ${fieldLabel.toLocaleLowerCase(locale === 'ru' ? 'ru-RU' : 'en-US')} ${t('order_activity_sentence_in_finance_entry')}${entryTitleSuffix}: `}{inlineValue(primaryChange, 'before')}{' → '}{inlineValue(primaryChange, 'after')}{'.'}</Text>;
      }
      if (primaryChange.redacted) {
        return <Text style={styles.summaryText}>{actorNode}{` ${verb('changed')} ${fieldWithEntry}. ${t('order_activity_value_redacted')}.`}</Text>;
      }
      if (valueLooksLong(primaryChange.before) || valueLooksLong(primaryChange.after)) {
        return <Text style={styles.summaryText}>{actorNode}{` ${verb('changed')} ${fieldWithEntry}.`}</Text>;
      }
      const beforeEmpty = isEmptyValue(primaryChange.before, primaryChange.beforeRef);
      const afterEmpty = isEmptyValue(primaryChange.after, primaryChange.afterRef);
      if (beforeEmpty && !afterEmpty) {
        return <Text style={styles.summaryText}>{actorNode}{` ${verb('set')} ${fieldWithEntry}: `}{inlineValue(primaryChange, 'after')}{'.'}</Text>;
      }
      if (!beforeEmpty && afterEmpty) {
        return <Text style={styles.summaryText}>{actorNode}{` ${verb('changed')} ${fieldWithEntry}: ${t('order_activity_sentence_now_not_set')}; ${t('order_activity_sentence_previously')} `}{inlineValue(primaryChange, 'before')}{'.'}</Text>;
      }
      return <Text style={styles.summaryText}>{actorNode}{` ${verb('changed')} ${fieldWithEntry} ${t('order_activity_sentence_from')} `}{inlineValue(primaryChange, 'before')}{` ${t('order_activity_sentence_to')} `}{inlineValue(primaryChange, 'after')}{'.'}</Text>;
    }

    if (event.entityType === 'order_customer_payments' && event.action === 'update' && primaryChange) {
      const fieldLabel = t(FIELD_KEYS[primaryChange.field] || 'order_activity_field_other');
      const field = SENTENCE_FIELD_KEYS[primaryChange.field]
        ? t(SENTENCE_FIELD_KEYS[primaryChange.field])
        : t('order_activity_sentence_field_generic').replace('{field}', fieldLabel);
      if (!hasActor) {
        if (primaryChange.redacted) {
          return <Text style={styles.summaryText}>{`${t(passiveKey)} — ${fieldLabel}. ${t('order_activity_value_redacted')}.`}</Text>;
        }
        if (valueLooksLong(primaryChange.before) || valueLooksLong(primaryChange.after)) {
          return <Text style={styles.summaryText}>{`${t(passiveKey)} — ${fieldLabel}.`}</Text>;
        }
        return <Text style={styles.summaryText}>{`${t(passiveKey)} — ${fieldLabel}: `}{inlineValue(primaryChange, 'before')}{' → '}{inlineValue(primaryChange, 'after')}{'.'}</Text>;
      }
      if (!gender) {
        return <Text style={styles.summaryText}>{actorNode}{` — ${fieldLabel}: `}{inlineValue(primaryChange, 'before')}{' → '}{inlineValue(primaryChange, 'after')}{'.'}</Text>;
      }
      if (primaryChange.redacted) {
        return <Text style={styles.summaryText}>{actorNode}{` ${verb('changed')} ${field}. ${t('order_activity_value_redacted')}.`}</Text>;
      }
      if (valueLooksLong(primaryChange.before) || valueLooksLong(primaryChange.after)) {
        return <Text style={styles.summaryText}>{actorNode}{` ${verb('changed')} ${field}.`}</Text>;
      }
      const beforeEmpty = isEmptyValue(primaryChange.before, primaryChange.beforeRef);
      const afterEmpty = isEmptyValue(primaryChange.after, primaryChange.afterRef);
      if (beforeEmpty && !afterEmpty) {
        return <Text style={styles.summaryText}>{actorNode}{` ${verb('set')} ${field}: `}{inlineValue(primaryChange, 'after')}{'.'}</Text>;
      }
      if (!beforeEmpty && afterEmpty) {
        return <Text style={styles.summaryText}>{actorNode}{` ${verb('changed')} ${field}: ${t('order_activity_sentence_now_not_set')}; ${t('order_activity_sentence_previously')} `}{inlineValue(primaryChange, 'before')}{'.'}</Text>;
      }
      return <Text style={styles.summaryText}>{actorNode}{` ${verb('changed')} ${field} ${t('order_activity_sentence_from')} `}{inlineValue(primaryChange, 'before')}{` ${t('order_activity_sentence_to')} `}{inlineValue(primaryChange, 'after')}{'.'}</Text>;
    }

    if (!hasActor && event.entityType === 'orders' && event.action === 'update' && primaryChange) {
      const fieldLabel = t(FIELD_KEYS[primaryChange.field] || 'order_activity_field_other');
      if (primaryChange.redacted) {
        return <Text style={styles.summaryText}>{`${t('order_activity_sentence_change_without_actor')} — ${fieldLabel}. ${t('order_activity_value_redacted')}.`}</Text>;
      }
      if (valueLooksLong(primaryChange.before) || valueLooksLong(primaryChange.after)) {
        return <Text style={styles.summaryText}>{`${t('order_activity_sentence_change_without_actor')} — ${fieldLabel}.`}</Text>;
      }
      return <Text style={styles.summaryText}>{`${t('order_activity_sentence_change_without_actor')} — ${fieldLabel}: `}{inlineValue(primaryChange, 'before')}{' → '}{inlineValue(primaryChange, 'after')}{'.'}</Text>;
    }

    if (!gender && hasActor) {
      if (event.entityType === 'orders' && event.action === 'update' && primaryChange && !primaryChange.redacted
        && !valueLooksLong(primaryChange.before) && !valueLooksLong(primaryChange.after)) {
        const fieldLabel = t(FIELD_KEYS[primaryChange.field] || 'order_activity_field_other');
        return (
          <Text style={styles.summaryText}>
            {actorNode}{` — ${fieldLabel}: `}{inlineValue(primaryChange, 'before')}{' → '}{inlineValue(primaryChange, 'after')}{'.'}
          </Text>
        );
      }
      return <Text style={styles.summaryText}>{actorNode}{` — ${lowerFirst(t(passiveKey))}.`}</Text>;
    }

    if (event.entityType === 'orders' && event.action === 'update' && primaryChange) {
      const fieldLabel = t(FIELD_KEYS[primaryChange.field] || 'order_activity_field_other');
      const field = SENTENCE_FIELD_KEYS[primaryChange.field]
        ? t(SENTENCE_FIELD_KEYS[primaryChange.field])
        : t('order_activity_sentence_field_generic').replace('{field}', fieldLabel);
      if (primaryChange.redacted) {
        return <Text style={styles.summaryText}>{actorNode}{` ${verb('changed')} ${field}. ${t('order_activity_value_redacted')}.`}</Text>;
      }
      if (valueLooksLong(primaryChange.before) || valueLooksLong(primaryChange.after)) {
        return <Text style={styles.summaryText}>{actorNode}{` ${verb('changed')} ${field}.`}</Text>;
      }
      const beforeEmpty = primaryChange.field === 'object_id'
        ? false
        : isEmptyValue(primaryChange.before, primaryChange.beforeRef);
      const afterEmpty = primaryChange.field === 'object_id'
        ? false
        : isEmptyValue(primaryChange.after, primaryChange.afterRef);
      if (beforeEmpty && !afterEmpty) {
        return <Text style={styles.summaryText}>{actorNode}{` ${verb('set')} ${field}: `}{inlineValue(primaryChange, 'after')}{'.'}</Text>;
      }
      if (!beforeEmpty && afterEmpty) {
        return <Text style={styles.summaryText}>{actorNode}{` ${verb('changed')} ${field}: ${t('order_activity_sentence_now_not_set')}; ${t('order_activity_sentence_previously')} `}{inlineValue(primaryChange, 'before')}{'.'}</Text>;
      }
      return <Text style={styles.summaryText}>{actorNode}{` ${verb('changed')} ${field} ${t('order_activity_sentence_from')} `}{inlineValue(primaryChange, 'before')}{` ${t('order_activity_sentence_to')} `}{inlineValue(primaryChange, 'after')}{'.'}</Text>;
    }

    const objectKey = event.entityType === 'orders'
      ? (event.action === 'insert' ? 'order_activity_sentence_request' : 'order_activity_sentence_request_data')
      : event.entityType === 'order_finance_entries'
        ? 'order_activity_sentence_finance_entry'
        : 'order_activity_sentence_customer_payment';
    const action = event.entityType === 'orders' && event.action === 'insert'
      ? 'created'
      : event.action === 'insert' ? 'added' : event.action === 'delete' ? 'deleted' : 'changed';
    const title = event.entityType === 'order_finance_entries' ? String(event.context.title || '').trim() : '';
    const amount = event.context.amount;
    const titleSuffix = title ? ` «${title}»` : '';
    const amountSuffix = amount === null || amount === undefined
      ? ''
      : ` ${t('order_activity_sentence_amount_connector')} ${formatValueText('amount', amount, 'scalar', event.context.currency || 'RUB')}`;
    const inlineNote = inlineFinanceNoteForEvent(event, event.changes);
    const ending = inlineNote ? `. ${t(FIELD_KEYS.note)}: «${inlineNote}».` : '.';
    if (!hasActor) return <Text style={styles.summaryText}>{`${t(passiveKey)}${titleSuffix}${amountSuffix}${ending}`}</Text>;
    return <Text style={styles.summaryText}>{actorNode}{` ${verb(action)} ${t(objectKey)}${titleSuffix}${amountSuffix}${ending}`}</Text>;
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('order_activity_refresh')}
          disabled={query.isRefetching || !canUseActivityNetwork}
          onPress={() => {
            if (canUseActivityNetwork) query.refetch();
          }}
          hitSlop={8}
          style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}
        >
          {query.isRefetching ? (
            <ActivityIndicator size="small" color={theme.colors.primary} />
          ) : (
            <Feather name="refresh-cw" size={17} color={theme.colors.primary} />
          )}
        </Pressable>
      </View>

      {query.isPending && canUseActivityNetwork ? <View style={styles.stateRow}><ActivityIndicator color={theme.colors.primary} /><Text style={styles.stateText}>{t('order_activity_loading')}</Text></View> : null}
      {query.isError && events.length === 0 ? <View style={styles.stateRow}><Text style={styles.errorText}>{t('order_activity_load_failed')}</Text><Button title={t('order_activity_retry')} variant="secondary" disabled={!canUseActivityNetwork} onPress={() => query.refetch()} /></View> : null}
      {!query.isPending && !query.isError && events.length === 0 ? <View style={styles.stateRow}><Text style={styles.emptyTitle}>{t('order_activity_empty')}</Text><Text style={styles.stateText}>{t('order_activity_empty_hint')}</Text></View> : null}

      {events.map((event, eventIndex) => {
        const meaningfulChanges = meaningfulChangesForEvent(event);
        const expandable = eventNeedsDisclosure(event, meaningfulChanges);
        const expanded = expandedEventIds.has(event.eventId);
        const primaryChange = primaryChangeForEvent(event, meaningfulChanges);
        const visibleChanges = expandable && expanded ? meaningfulChanges : [];
        const accentColor = event.entityType === 'order_customer_payments'
          ? theme.colors.success
          : event.entityType === 'order_finance_entries'
            ? theme.colors.warning
            : theme.colors.primary;

        return (
            <View key={event.eventId} style={styles.eventCard}>
              <View style={styles.eventRow}>
                <View style={styles.timelineRail}>
                  <View style={[styles.timelineDot, { backgroundColor: accentColor }]} />
                  {eventIndex < events.length - 1 ? <View style={styles.timelineLine} /> : null}
                </View>
                <View style={styles.eventBody}>
                  <Text style={styles.eventTime}>{formatEventDateTime(event.occurredAt, locale)}</Text>
                  {renderNarrative(event, primaryChange, meaningfulChanges)}
                  {visibleChanges.length > 0 ? <Text style={styles.detailsTitle}>{t('order_activity_change_details')}</Text> : null}
                  {visibleChanges.map((change, index) => renderChange(event, change, index, expandable && !expanded, event.context.currency || 'RUB'))}
                  {event.action === 'insert' && event.entityType === 'orders' ? <View style={styles.referenceChips}>{[event.context.client, event.context.object, event.context.assignee].filter(Boolean).map((ref) => <View key={`${ref.entityType}-${ref.entityId}`} style={styles.referenceChip}>{renderReference(ref, t('order_activity_value_empty'), true)}</View>)}</View> : null}
                  {expandable ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded }}
                      accessibilityLabel={expanded ? t('order_activity_collapse_details') : t('order_activity_expand_details')}
                      onPress={() => toggleEvent(event.eventId)}
                      style={({ pressed }) => [styles.disclosureButton, pressed && styles.pressed]}
                    >
                      <Text style={styles.disclosureText}>
                        {expanded
                          ? t('order_activity_hide_details')
                          : meaningfulChanges.length > 0
                            ? t('order_activity_show_changes').replace('{count}', String(meaningfulChanges.length))
                            : t('order_activity_show_details')}
                      </Text>
                      <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={17} color={theme.colors.primary} />
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </View>
        );
      })}
      {query.hasNextPage ? <Button title={query.isFetchingNextPage ? t('order_activity_loading') : t('order_activity_load_more')} variant="secondary" loading={query.isFetchingNextPage} disabled={!canUseActivityNetwork} onPress={() => query.fetchNextPage()} style={styles.moreButton} /> : null}
    </View>
  );
}

const createStyles = (theme) => StyleSheet.create({
  container: { paddingTop: theme.spacing.xs },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: theme.spacing.sm },
  refreshButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.65 },
  stateRow: { minHeight: 132, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, paddingVertical: theme.spacing.lg },
  stateText: { color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm, textAlign: 'center', lineHeight: 20 },
  errorText: { color: theme.colors.danger || '#DC2626', fontSize: theme.typography.sizes.sm, fontWeight: theme.typography.weight.semibold, textAlign: 'center' },
  emptyTitle: { color: theme.colors.text, fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weight.semibold },
  eventCard: { marginBottom: theme.spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.md },
  eventRow: { flexDirection: 'row', alignItems: 'stretch' },
  timelineRail: { width: 22, alignItems: 'center' },
  timelineDot: { width: 10, height: 10, marginTop: 5, borderRadius: 5, backgroundColor: theme.colors.primary },
  timelineLine: { width: StyleSheet.hairlineWidth, flex: 1, minHeight: 24, marginTop: 4, backgroundColor: theme.colors.border },
  eventBody: { flex: 1, minWidth: 0, paddingLeft: theme.spacing.sm },
  eventTime: { color: theme.colors.textSecondary, fontSize: theme.typography.sizes.xs, fontVariant: ['tabular-nums'] },
  summaryText: { marginTop: theme.spacing.xs, color: theme.colors.text, fontSize: theme.typography.sizes.sm, lineHeight: 21 },
  summaryActor: { color: theme.colors.text, fontWeight: theme.typography.weight.semibold },
  summaryValue: { color: theme.colors.text, fontWeight: theme.typography.weight.semibold },
  summaryLink: { color: theme.colors.primary, textDecorationLine: 'underline', fontWeight: theme.typography.weight.semibold },
  valueText: { color: theme.colors.text, fontSize: theme.typography.sizes.xs, lineHeight: 18 },
  emptyValue: { color: theme.colors.textSecondary, fontSize: theme.typography.sizes.xs, lineHeight: 18 },
  linkText: { color: theme.colors.primary, textDecorationLine: 'underline', fontWeight: theme.typography.weight.semibold },
  detailsTitle: { marginTop: theme.spacing.md, paddingTop: theme.spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border, color: theme.colors.textSecondary, fontSize: theme.typography.sizes.xs, fontWeight: theme.typography.weight.semibold, textTransform: 'uppercase', letterSpacing: 0.4 },
  changeRow: { marginTop: theme.spacing.sm },
  changeLabel: { color: theme.colors.textSecondary, fontSize: theme.typography.sizes.xs, fontWeight: theme.typography.weight.semibold, marginBottom: 2 },
  valuesRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
  valueSide: { flex: 1, minWidth: 0 },
  objectAddressText: { marginTop: 2, color: theme.colors.textSecondary, fontSize: theme.typography.sizes.xs, lineHeight: 18 },
  redactedText: { color: theme.colors.textSecondary, fontSize: theme.typography.sizes.xs, fontStyle: 'italic' },
  referenceChips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs, marginTop: theme.spacing.sm },
  referenceChip: { borderRadius: theme.radii.md, backgroundColor: theme.colors.background, paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xs },
  disclosureButton: { minHeight: 44, marginTop: theme.spacing.sm, paddingTop: theme.spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm },
  disclosureText: { flex: 1, color: theme.colors.primary, fontSize: theme.typography.sizes.xs, fontWeight: theme.typography.weight.semibold },
  moreButton: { marginTop: theme.spacing.md },
});
