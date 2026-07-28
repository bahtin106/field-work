// components/ui/modals/DateTimeModal.jsx
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { t as T, getDict } from '../../../src/i18n';
import { useTheme } from '../../../theme';
import ThemedSwitch from '../ThemedSwitch';
import BaseModal, { withAlpha } from './BaseModal';
import ModalActionsRow from './ModalActionsRow';
import Wheel, { ITEM_HEIGHT_DP, VISIBLE_COUNT_DP } from './Wheel';

function parseInitialDate(value) {
  try {
    if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
      return new Date();
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return new Date(
        value.getFullYear(),
        value.getMonth(),
        value.getDate(),
        value.getHours(),
        value.getMinutes(),
        0,
        0,
      );
    }
    if (typeof value === 'string') {
      const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (match) {
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        return new Date(year, month - 1, day, 12, 0, 0, 0);
      }
    }
    if (typeof value === 'number') {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? new Date() : date;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  } catch {
    return new Date();
  }
}

export default function DateTimeModal({
  visible,
  onClose,
  onDismiss,
  onApply,
  initial = null,
  mode = 'datetime',
  minuteStep = 5,
  allowOmitYear = false,
  omitYearDefault = true,
  omitYearLabel = T('datetime_omit_year'),
  allowFutureDates = false,
  allowPastDates = true,
}) {
  const modalRef = React.useRef(null);
  const { theme } = useTheme();

  const clampStep = (n, step) => Math.max(1, Math.min(30, Math.floor(step || 5)));
  const step = clampStep(minuteStep, minuteStep);
  const range = (a, b) => {
    const r = [];
    for (let i = a; i <= b; i++) r.push(i);
    return r;
  };
  const pad2 = (n) => String(n).padStart(2, '0');

  const initialValue = initial instanceof Date ? initial.getTime() : initial;
  const baseDate = React.useMemo(
    () => parseInitialDate(initialValue),
    // Keep the resolved date stable while the user is interacting with the wheels.
    [initialValue],
  );

  const _dict = React.useMemo(() => getDict?.() || {}, []);
  const _srcShort = Array.from({ length: 12 }, (_, i) => T(`months_short_${i}`));
  const _srcGen = Array.from({ length: 12 }, (_, i) => T(`months_genitive_${i}`));
  const _offset = Number(_dict.month_label_offset ?? 0) || 0;
  const rotate = (arr, off) => Array.from({ length: 12 }, (_, i) => arr[(i + off + 12) % 12]);
  const MONTHS_ABBR = rotate(_srcShort, _offset);
  const MONTHS_GEN = rotate(_srcGen, _offset);

  const daysInMonth = React.useCallback(
    (m, yNullable) => {
      // when year is omitted (yNullable == null) allow february 29
      if (yNullable == null) return m === 1 ? 29 : new Date(baseDate.getFullYear(), m + 1, 0).getDate();
      const y = yNullable ?? baseDate.getFullYear();
      return new Date(y, m + 1, 0).getDate();
    },
    [baseDate],
  );

  const today = React.useMemo(() => new Date(), []);
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();
  const currentDay = today.getDate();

  const years = React.useMemo(() => {
    const y = currentYear;
    const minYear = allowPastDates ? 1900 : y;
    const maxYear = allowFutureDates ? y + 10 : y;
    return range(minYear, maxYear);
  }, [allowFutureDates, allowPastDates, currentYear]);

  const clampMonthForYear = React.useCallback(
    (month, year) => {
      // when year is omitted (null) do not constrain months
      if (year == null) return Math.max(0, Math.min(month, 11));
      const currentYearSelected = year === currentYear;
      const minMonth = !allowPastDates && currentYearSelected ? currentMonth : 0;
      const maxMonth = !allowFutureDates && currentYearSelected ? currentMonth : 11;
      return Math.max(minMonth, Math.min(month, maxMonth));
    },
    [allowPastDates, allowFutureDates, currentYear, currentMonth],
  );

  const clampDayForYearMonth = React.useCallback(
    (day, month, year) => {
      const maxDayInMonth = daysInMonth(month, year == null ? null : year);
      // when year is omitted, do not constrain by current date
      const currentYearMonth = year != null && year === currentYear && month === currentMonth;
      const minDay = !allowPastDates && currentYearMonth ? currentDay : 1;
      const maxDay = !allowFutureDates && currentYearMonth ? Math.min(maxDayInMonth, currentDay) : maxDayInMonth;
      return Math.max(minDay, Math.min(day, maxDay));
    },
    [allowPastDates, allowFutureDates, currentYear, currentMonth, currentDay, daysInMonth],
  );

  const getDayRange = React.useCallback(
    (year, month) => {
      const maxDay = daysInMonth(month, year == null ? null : year);
      const minDay = !allowPastDates && year != null && year === currentYear && month === currentMonth ? currentDay : 1;
      const maxAllowed =
        !allowFutureDates && year != null && year === currentYear && month === currentMonth
          ? Math.min(maxDay, currentDay)
          : maxDay;
      return range(minDay, maxAllowed);
    },
    [allowPastDates, allowFutureDates, currentYear, currentMonth, currentDay, daysInMonth],
  );

  const minutesData = React.useMemo(
    () => range(0, 59).filter((minute) => minute % step === 0),
    [step],
  );
  const initialSelection = React.useMemo(() => {
    let yearIdx = years.indexOf(baseDate.getFullYear());
    if (yearIdx < 0) yearIdx = 0;

    const initialWithYear = allowOmitYear ? omitYearDefault : true;
    if (allowOmitYear && !omitYearDefault && baseDate.getFullYear() === currentYear) {
      const preferredYear = Math.max(years[0] || 1900, currentYear - 30);
      const preferredYearIdx = years.indexOf(preferredYear);
      if (preferredYearIdx >= 0) yearIdx = preferredYearIdx;
    }

    const yearForBounds = initialWithYear ? years[yearIdx] || currentYear : null;
    const month = clampMonthForYear(baseDate.getMonth(), yearForBounds);
    const day = clampDayForYearMonth(baseDate.getDate(), month, yearForBounds);
    const initialDays = getDayRange(yearForBounds, month);
    const dayIdx = Math.max(0, initialDays.indexOf(day));
    const roundedMinute = Math.min(59, Math.round(baseDate.getMinutes() / step) * step);
    const minuteIdx = Math.max(0, minutesData.indexOf(roundedMinute));

    return {
      yearIdx,
      month,
      dayIdx,
      withYear: initialWithYear,
      hourIdx: baseDate.getHours(),
      minuteIdx,
    };
  }, [
    allowOmitYear,
    baseDate,
    clampDayForYearMonth,
    clampMonthForYear,
    currentYear,
    getDayRange,
    minutesData,
    omitYearDefault,
    step,
    years,
  ]);

  const [dYearIdx, setDYearIdx] = React.useState(initialSelection.yearIdx);
  const [dMonthIdx, setDMonthIdx] = React.useState(initialSelection.month);
  const [dDayIdx, setDDayIdx] = React.useState(initialSelection.dayIdx);
  const [withYear, setWithYear] = React.useState(initialSelection.withYear);

  const availableMonths = React.useMemo(() => {
    const year = withYear ? years[dYearIdx] || baseDate.getFullYear() : null;
    if (year == null) return range(0, 11);
    const minMonth = !allowPastDates && year === currentYear ? currentMonth : 0;
    const maxMonth = !allowFutureDates && year === currentYear ? currentMonth : 11;
    return range(minMonth, maxMonth);
  }, [dYearIdx, years, withYear, baseDate, allowPastDates, allowFutureDates, currentYear, currentMonth]);

  const days = React.useMemo(() => {
    const year = withYear ? years[dYearIdx] || baseDate.getFullYear() : null;
    const month = clampMonthForYear(dMonthIdx, year);
    return getDayRange(year, month);
  }, [
    dMonthIdx,
    dYearIdx,
    years,
    withYear,
    baseDate,
    clampMonthForYear,
    getDayRange,
  ]);

  const [tHourIdx, setTHourIdx] = React.useState(initialSelection.hourIdx);
  const [tMinuteIdx, setTMinuteIdx] = React.useState(initialSelection.minuteIdx);
  const [tab, setTab] = React.useState('date');
  const previousVisibleRef = React.useRef(false);

  React.useLayoutEffect(() => {
    const wasVisible = previousVisibleRef.current;
    previousVisibleRef.current = visible;
    if (wasVisible) return;

    setDYearIdx(initialSelection.yearIdx);
    setWithYear(initialSelection.withYear);
    setDMonthIdx(initialSelection.month);
    setDDayIdx(initialSelection.dayIdx);
    setTHourIdx(initialSelection.hourIdx);
    setTMinuteIdx(initialSelection.minuteIdx);
    setTab('date');
  }, [initialSelection, visible]);

  // Когда пользователь включает переключатель года (с false → true),
  // если год заранее был подставлен в текущий год (sentinel flow),
  // сдвинем позицию колеса к более вероятному значению (currentYear - 30).
  const prevWithYearRef = React.useRef(withYear);
  React.useEffect(() => {
    if (!visible) {
      prevWithYearRef.current = withYear;
      return;
    }
    if (!prevWithYearRef.current && withYear) {
      // just turned on
      const currentYearIdx = years.indexOf(currentYear);
      const isAtCurrentYear = dYearIdx === currentYearIdx || baseDate.getFullYear() === currentYear;
      if (isAtCurrentYear) {
        const preferredYear = Math.max(years[0] || 1900, currentYear - 30);
        const prefIdx = years.indexOf(preferredYear);
        if (prefIdx >= 0) setDYearIdx(prefIdx);
      }
    }
    prevWithYearRef.current = withYear;
  }, [withYear, visible, years, dYearIdx, baseDate, currentYear]);

  React.useEffect(() => {
    setDDayIdx((idx) => Math.max(0, Math.min(idx, Math.max(0, days.length - 1))));
  }, [days]);

  const header = React.useMemo(() => {
    const d = days[dDayIdx] ?? days[0] ?? 1;
    const mName = MONTHS_GEN[dMonthIdx] || '';
    const y = years[dYearIdx] || baseDate.getFullYear();
    const hh = pad2(tHourIdx);
    const mm = pad2(minutesData[tMinuteIdx] ?? 0);
    if (mode === 'date') return withYear ? `${d} ${mName} ${y}` : `${d} ${mName}`;
    if (mode === 'time') return `${hh}:${mm}`;
    return withYear ? `${d} ${mName} ${y}, ${hh}:${mm}` : `${d} ${mName}, ${hh}:${mm}`;
  }, [mode, dDayIdx, dMonthIdx, dYearIdx, years, tHourIdx, tMinuteIdx, minutesData, MONTHS_GEN, baseDate, withYear, days]);

  const modalTokens = theme.components.datetimeModal;
  const innerGap = modalTokens.innerGap;

  const handleApply = () => {
    const selectedMonth = dMonthIdx;
    const selectedDay = days[dDayIdx] ?? days[0] ?? 1;
    const hour = tHourIdx;
    const min = minutesData[tMinuteIdx] ?? 0;
    // When year is omitted, construct Date using a safe leap-year to preserve Feb 29
    const dateYearForObject = withYear ? years[dYearIdx] || baseDate.getFullYear() : 1900;
    let out;
    if (mode === 'date') out = new Date(dateYearForObject, selectedMonth, selectedDay, 12, 0, 0, 0);
    else if (mode === 'time') {
      const now = new Date();
      out = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, min, 0, 0);
    } else {
      out = new Date(dateYearForObject, selectedMonth, selectedDay, hour, min, 0, 0);
    }
    onApply?.(out, {
      withYear,
      day: selectedDay,
      monthOneBased: selectedMonth + 1,
      monthIndex: selectedMonth,
      year: withYear ? years[dYearIdx] || baseDate.getFullYear() : null,
    });
    onClose?.();
  };

  const footer = (
    <ModalActionsRow
      actions={[
        {
          key: 'cancel',
          title: T('btn_cancel'),
          variant: 'secondary',
          onPress: () => modalRef.current?.close(),
        },
        {
          key: 'confirm',
          title: T('btn_ok'),
          variant: 'primary',
          onPress: handleApply,
        },
      ]}
    />
  );

  const Segmented = () => (
    <View
      style={{
        flexDirection: 'row',
        borderWidth: modalTokens.segmentedBorderWidth,
        borderColor: theme.colors.border,
        borderRadius: modalTokens.segmentedRadius,
        overflow: 'hidden',
        marginBottom: theme.spacing.sm,
      }}
    >
      {['date', 'time'].map((k) => {
        const active = tab === k;
        return (
          <Pressable
            key={k}
            onPress={() => setTab(k)}
            style={({ pressed }) => [
              {
                flex: 1,
                paddingVertical: modalTokens.segmentedPaddingY,
                alignItems: 'center',
                backgroundColor: active
                  ? withAlpha(theme.colors.primary, modalTokens.segmentedActiveAlpha)
                  : theme.colors.surface,
              },
              pressed && { opacity: modalTokens.segmentedPressedOpacity },
            ]}
          >
            <Text
              style={{
                color: active ? theme.colors.primary : theme.colors.textSecondary,
                fontWeight: active
                  ? theme.typography.weight.bold
                  : theme.typography.weight.medium,
              }}
            >
              {k === 'date' ? T('datetime_tab_date') : T('datetime_tab_time')}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <BaseModal
      ref={modalRef}
      visible={visible}
      onClose={onClose}
      onDismiss={onDismiss}
      title={header}
      maxHeightRatio={modalTokens.maxHeightRatio}
      presentation="sheet"
      footer={footer}
    >
      <View>
        {mode === 'datetime' ? <Segmented /> : null}

        {mode === 'date' || (mode === 'datetime' && tab === 'date') ? (
          <>
            <View style={{ position: 'relative', marginBottom: modalTokens.wheelSectionGap }}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  gap: innerGap,
                  height: ITEM_HEIGHT_DP * VISIBLE_COUNT_DP,
                }}
              >
                <Wheel
                  data={days.map(String)}
                  activeColor={theme.colors.primary}
                  inactiveColor={theme.colors.textSecondary}
                  index={Math.max(0, Math.min(dDayIdx, days.length - 1))}
                  onIndexChange={setDDayIdx}
                />
                <Wheel
                  data={availableMonths.map((m) => MONTHS_ABBR[m])}
                  activeColor={theme.colors.primary}
                  inactiveColor={theme.colors.textSecondary}
                  index={Math.max(0, availableMonths.indexOf(dMonthIdx))}
                  onIndexChange={(i) => {
                    const newMonth = availableMonths[i];
                    setDMonthIdx(newMonth);
                    setDDayIdx((d) => {
                      const prevDay = days[d] ?? days[0] ?? 1;
                      const year = withYear ? years[dYearIdx] || baseDate.getFullYear() : null;
                      const clampedDay = clampDayForYearMonth(prevDay, newMonth, year);
                      const nextDays = getDayRange(year, newMonth);
                      const nextIdx = nextDays.indexOf(clampedDay);
                      return Math.max(0, nextIdx);
                    });
                  }}
                />
                {withYear ? (
                  <Wheel
                    data={years.map(String)}
                    activeColor={theme.colors.primary}
                    inactiveColor={theme.colors.textSecondary}
                    index={dYearIdx}
                    onIndexChange={(i) => {
                      setDYearIdx(i);
                      const newYear = years[i] || currentYear;
                      const safeMonth = clampMonthForYear(dMonthIdx, newYear);
                      if (safeMonth !== dMonthIdx) setDMonthIdx(safeMonth);
                      setDDayIdx((d) => {
                        const prevDay = days[d] ?? days[0] ?? 1;
                        const clampedDay = clampDayForYearMonth(prevDay, safeMonth, newYear);
                        const nextDays = getDayRange(newYear, safeMonth);
                        const nextIdx = nextDays.indexOf(clampedDay);
                        return Math.max(0, nextIdx);
                      });
                    }}
                    enabled={withYear}
                  />
                ) : (
                  <View
                    style={{
                      flex: 1,
                      flexBasis: 0,
                      minWidth: 0,
                      justifyContent: 'center',
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: theme.colors.textSecondary, fontSize: theme.typography.sizes.md }}>---</Text>
                  </View>
                )}
              </View>
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: (ITEM_HEIGHT_DP * (VISIBLE_COUNT_DP - 1)) / 2,
                  height: ITEM_HEIGHT_DP,
                  backgroundColor: withAlpha(
                    theme.colors.primary,
                    modalTokens.selectionBackgroundAlpha,
                  ),
                  borderWidth: modalTokens.selectionBorderWidth,
                  borderColor: withAlpha(
                    theme.colors.primary,
                    modalTokens.selectionBorderAlpha,
                  ),
                  borderRadius: modalTokens.selectionRadius,
                }}
              />
            </View>

            {allowOmitYear && (mode === 'date' || (mode === 'datetime' && tab === 'date')) ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: theme.spacing.sm,
                  paddingHorizontal: modalTokens.omitYearPaddingX,
                  paddingLeft: modalTokens.omitYearPaddingLeft,
                  paddingVertical: modalTokens.omitYearPaddingY,
                }}
              >
                <Text
                  style={{
                    color: theme.colors.text,
                    fontSize: modalTokens.omitYearTextSize,
                    fontWeight: theme.typography.weight.semibold,
                  }}
                >
                  {omitYearLabel}
                </Text>
                <View style={{ width: modalTokens.omitYearSpacerWidth }} />
                <ThemedSwitch value={withYear} onValueChange={setWithYear} />
              </View>
            ) : null}
          </>
        ) : null}

        {mode === 'time' || (mode === 'datetime' && tab === 'time') ? (
          <>
            <View style={{ position: 'relative', marginBottom: modalTokens.wheelSectionGap }}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  gap: innerGap,
                  height: ITEM_HEIGHT_DP * VISIBLE_COUNT_DP,
                }}
              >
                <Wheel
                  data={Array.from({ length: 24 }, (_, n) => String(n).padStart(2, '0'))}
                  activeColor={theme.colors.primary}
                  inactiveColor={theme.colors.textSecondary}
                  index={tHourIdx}
                  onIndexChange={setTHourIdx}
                />
                <Wheel
                  data={minutesData.map((n) => String(n).padStart(2, '0'))}
                  activeColor={theme.colors.primary}
                  inactiveColor={theme.colors.textSecondary}
                  index={tMinuteIdx}
                  onIndexChange={setTMinuteIdx}
                />
              </View>
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: (ITEM_HEIGHT_DP * (VISIBLE_COUNT_DP - 1)) / 2,
                  height: ITEM_HEIGHT_DP,
                  backgroundColor: withAlpha(
                    theme.colors.primary,
                    modalTokens.selectionBackgroundAlpha,
                  ),
                  borderWidth: modalTokens.selectionBorderWidth,
                  borderColor: withAlpha(
                    theme.colors.primary,
                    modalTokens.selectionBorderAlpha,
                  ),
                  borderRadius: modalTokens.selectionRadius,
                }}
              />
            </View>
          </>
        ) : null}
      </View>
    </BaseModal>
  );
}
