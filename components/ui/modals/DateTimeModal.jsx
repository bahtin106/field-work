
// components/ui/modals/DateTimeModal.jsx
import React from "react";
import { View, Text, Pressable, Platform, Switch } from "react-native";
import { useTheme } from "../../../theme";
import UIButton from "../Button";
import BaseModal, { withAlpha } from "./BaseModal";
import Wheel, { ITEM_HEIGHT_DP, VISIBLE_COUNT_DP } from "./Wheel";
import { t as T } from '../../../src/i18n';

export default function DateTimeModal({
  visible,
  onClose,
  onApply,
  initial = null,
  mode = 'datetime',
  minuteStep = 5,
  allowOmitYear = false,
  omitYearDefault = true,
  omitYearLabel = T('datetime_omit_year'),
}) {
  const modalRef = React.useRef(null);
  const { theme } = useTheme();
  const [contentW, setContentW] = React.useState(0);

  const clampStep = (n, step) => Math.max(1, Math.min(30, Math.floor(step || 5)));
  const step = clampStep(minuteStep, minuteStep);
  const range = (a,b) => { const r=[]; for(let i=a;i<=b;i++) r.push(i); return r; };
  const pad2 = (n) => String(n).padStart(2,'0');

  const parseInitial = (v) => {
  try {
    if (v instanceof Date && !isNaN(v)) {
      return new Date(v.getFullYear(), v.getMonth(), v.getDate(), v.getHours(), v.getMinutes(), 0, 0);
    }
    if (typeof v === 'string') {
      const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) {
        const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
        return new Date(y, mo - 1, d, 12, 0, 0, 0);
      }
    }
    if (typeof v === 'number') {
      const d = new Date(v);
      return isNaN(d) ? new Date() : d;
    }
    const d = new Date(v);
    return isNaN(d) ? new Date() : d;
  } catch { return new Date(); }
};
  const baseDate = parseInitial(initial);

  const MONTHS_ABBR = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i, 1).toLocaleString(undefined, { month: 'short' })
);
  const MONTHS_GEN = Array.from({ length: 12 }, (_, i) =>
  new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long' })
    .format(new Date(2000, i, 1))
    .replace(/^\d+\s*/, '')
);

  const daysInMonth = (m, yNullable) => {
    // Robust: month 0..11, when year is omitted use leap year 2000 to allow Feb 29,
    // and always compute via JS Date to avoid off-by-one.
    const month = Number.isFinite(m) ? Number(m) : 0;
    const year = (yNullable == null) ? 2000 : Number(yNullable);
    return new Date(year, month + 1, 0).getDate();
  };
  const years = React.useMemo(() => { const y = new Date().getFullYear(); return range(1900, y+10); }, []);
  const [dYearIdx, setDYearIdx] = React.useState(0);
  const [dMonthIdx, setDMonthIdx] = React.useState(0);
  const [dDayIdx, setDDayIdx] = React.useState(0);

  const [withYear, setWithYear] = React.useState(omitYearDefault);
  const days = React.useMemo(() => {
    const selMonth = Math.max(0, Math.min(11, Number(dMonthIdx) || 0));
    const selYear = withYear ? (Number(years[dYearIdx]) || baseDate.getFullYear()) : null;
    return range(1, daysInMonth(selMonth, selYear));
  }, [dMonthIdx, dYearIdx, years, withYear]);

  const minutesData = React.useMemo(() => range(0, 59).filter(m => m % step === 0), [step]);
  const [tHourIdx, setTHourIdx] = React.useState(0);
  const [tMinuteIdx, setTMinuteIdx] = React.useState(0);

  const [tab, setTab] = React.useState('date');

  React.useEffect(() => {
    if (!visible) return;
    const y = years.indexOf(baseDate.getFullYear()); setDYearIdx(y >= 0 ? y : 0);
    setWithYear(allowOmitYear ? omitYearDefault : true);
    setDMonthIdx(baseDate.getMonth());
    const maxD = daysInMonth(baseDate.getMonth(), baseDate.getFullYear());
    setDDayIdx(Math.max(0, Math.min(baseDate.getDate()-1, maxD-1)));
    setTHourIdx(baseDate.getHours());
    const mi = Math.round(baseDate.getMinutes() / step);
    const minuteVal = Math.min(59, mi*step);
    const mIdx = minutesData.indexOf(minuteVal);
    setTMinuteIdx(mIdx >= 0 ? mIdx : 0);
    setTab('date');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const header = React.useMemo(() => {
    const d = (dDayIdx+1), mName = MONTHS_GEN[dMonthIdx] || '', y = years[dYearIdx] || baseDate.getFullYear();
    const hh = pad2(tHourIdx), mm = pad2(minutesData[tMinuteIdx] ?? 0);
    if (mode === 'date') return withYear ? `${d} ${mName} ${y}` : `${d} ${mName}`;
    if (mode === 'time') return `${hh}:${mm}`;
    return withYear ? `${d} ${mName} ${y}, ${hh}:${mm}` : `${d} ${mName}, ${hh}:${mm}`;
  }, [mode, dDayIdx, dMonthIdx, dYearIdx, years, tHourIdx, tMinuteIdx, minutesData]);

  const innerGap = (theme.components?.datetimeModal?.innerGap ?? theme.spacing?.sm ?? 8);
  const minWheelWidth = (theme.components?.datetimeModal?.wheelMinWidth ?? 64);
  const W3 = Math.max(minWheelWidth, contentW > 0 ? (contentW - innerGap * 2) / 3 : 0);
  const W2 = Math.max(minWheelWidth, contentW > 0 ? (contentW - innerGap) / 2 : 0);

  const handleApply = () => {
    const year  = years[dYearIdx] || baseDate.getFullYear();
    const month = dMonthIdx;
    const day   = dDayIdx + 1;
    const hour  = tHourIdx;
    const min   = minutesData[tMinuteIdx] ?? 0;
    let out;
    if (mode === 'date') out = new Date(year, month, day, 12, 0, 0, 0);
    else if (mode === 'time') {
      const now = new Date();
      out = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, min, 0, 0);
    } else {
      out = new Date(year, month, day, hour, min, 0, 0);
    }
    onApply?.(out, { withYear, day: dDayIdx + 1, month: dMonthIdx, year: withYear ? (years[dYearIdx] || baseDate.getFullYear()) : null });
    onClose?.();
  };

  const footer = (
    <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
      <Pressable
        onPress={() => modalRef.current?.close()}
        style={({ pressed }) => [
          {
            paddingVertical: 12,
            paddingHorizontal: 16,
            borderRadius: 10,
            alignItems: 'center',
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: 'transparent',
            flex: 1,
          },
          pressed && Platform.OS === 'ios' ? { backgroundColor: theme.colors.ripple } : null,
        ]}
      >
        <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '500' }}>{T('btn_cancel')}</Text>
      </Pressable>
      <UIButton variant="primary" size="md" onPress={handleApply} title={T('btn_ok')} />
    </View>
  );

  const Segmented = () => (
    <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, overflow: 'hidden', marginBottom: theme.spacing.sm }}>
      {['date','time'].map((k) => {
        const active = tab === k;
        return (
          <Pressable
            key={k}
            onPress={() => setTab(k)}
            style={({ pressed }) => [
              { flex: 1, paddingVertical: 8, alignItems: 'center', backgroundColor: active ? withAlpha(theme.colors.primary, 0.12) : theme.colors.surface },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={{ color: active ? theme.colors.primary : theme.colors.textSecondary, fontWeight: active ? '700' : '500' }}>
              {k === 'date' ? T('datetime_tab_date') : T('datetime_tab_time')}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <BaseModal ref={modalRef} visible={visible} onClose={onClose} title={header} maxHeightRatio={0.65} footer={footer}>
      <View onLayout={(e)=>setContentW(e.nativeEvent.layout.width)}>
        {mode === 'datetime' ? <Segmented /> : null}

        {(mode === 'date' || (mode === 'datetime' && tab === 'date')) ? (
          <>
            <View style={{ position:'relative', marginBottom: 10 }}>
              <View style={{ flexDirection:'row', justifyContent:'space-between', gap: innerGap, height: ITEM_HEIGHT_DP * VISIBLE_COUNT_DP }}>
                <Wheel
                  data={days.map(String)}
                  activeColor={theme.colors.primary}
                  inactiveColor={theme.colors.textSecondary}
                  index={dDayIdx}
                  onIndexChange={setDDayIdx}
                  width={W3}
                />
                <Wheel
                  data={MONTHS_ABBR}
                  activeColor={theme.colors.primary}
                  inactiveColor={theme.colors.textSecondary}
                  index={dMonthIdx}
                  onIndexChange={(i) => {
                    setDMonthIdx(i);
                    setDDayIdx((d) => {
                      const selYear = withYear ? (Number(years[dYearIdx]) || baseDate.getFullYear()) : null;
                      return Math.min(d, daysInMonth(i, selYear) - 1);
                    });
                  }}
                  width={W3}
                />
                <Wheel
                  data={years.map(String)}
                  activeColor={theme.colors.primary}
                  inactiveColor={theme.colors.textSecondary}
                  index={dYearIdx}
                  onIndexChange={setDYearIdx}
                  width={W3}
                  enabled={withYear}
                />
              </View>
              <View pointerEvents="none" style={{ position:'absolute', left:0, right:0, top:(ITEM_HEIGHT_DP*(VISIBLE_COUNT_DP-1))/2, height:ITEM_HEIGHT_DP, backgroundColor: withAlpha(theme.colors.primary, 0.06), borderWidth:1, borderColor: withAlpha(theme.colors.primary, 0.22), borderRadius:12 }} />
            </View>

            {(allowOmitYear && (mode === 'date' || (mode === 'datetime' && tab === 'date'))) ? (
              <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginTop: theme.spacing.sm, paddingHorizontal: 4, paddingLeft: 12, paddingVertical: 6 }}>
                <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '600' }}>{omitYearLabel}</Text>
                <View style={{ width: 12 }} />
                <Switch value={withYear} onValueChange={setWithYear} />
              </View>
            ) : null}
          </>
        ) : null}

        {(mode === 'time' || (mode === 'datetime' && tab === 'time')) ? (
          <>
            <View style={{ position:'relative', marginBottom: 10 }}>
              <View style={{ flexDirection:'row', justifyContent:'space-between', gap: innerGap, height: ITEM_HEIGHT_DP * VISIBLE_COUNT_DP }}>
                <Wheel
                  data={Array.from({length:24},(_,n)=>String(n).padStart(2,'0'))}
                  activeColor={theme.colors.primary}
                  inactiveColor={theme.colors.textSecondary}
                  index={tHourIdx}
                  onIndexChange={setTHourIdx}
                  width={W2}
                />
                <Wheel
                  data={minutesData.map((n)=>String(n).padStart(2,'0'))}
                  activeColor={theme.colors.primary}
                  inactiveColor={theme.colors.textSecondary}
                  index={tMinuteIdx}
                  onIndexChange={setTMinuteIdx}
                  width={W2}
                />
              </View>
              <View pointerEvents="none" style={{ position:'absolute', left:0, right:0, top:(ITEM_HEIGHT_DP*(VISIBLE_COUNT_DP-1))/2, height:ITEM_HEIGHT_DP, backgroundColor: withAlpha(theme.colors.primary, 0.06), borderWidth:1, borderColor: withAlpha(theme.colors.primary, 0.22), borderRadius:12 }} />
            </View>
          </>
        ) : null}
      </View>
    </BaseModal>
  );
}
