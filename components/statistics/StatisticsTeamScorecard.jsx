import Feather from '@expo/vector-icons/Feather';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import EmptyListState from '../ui/EmptyListState';
import { useTheme } from '../../theme/ThemeProvider';
import { withAlpha } from '../../theme/colors';

const METRICS = Object.freeze([
  { id: 'profit', labelKey: 'stats_team_metric_profit' },
  { id: 'revenue', labelKey: 'stats_team_metric_revenue' },
  { id: 'completed', labelKey: 'stats_team_metric_completed' },
]);

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function replaceVariables(message, variables) {
  return Object.entries(variables).reduce(
    (result, [key, value]) => result.split(`{${key}}`).join(String(value ?? '')),
    message,
  );
}

function hasActivity(employee) {
  return ['registered', 'completed', 'revenue', 'profit', 'earnings'].some(
    (key) => asNumber(employee?.[key]) !== 0,
  );
}

export default function StatisticsTeamScorecard({
  employees = [],
  metric = 'profit',
  onMetricChange,
  onEmployeePress,
  formatMoney,
  formatCount,
  maxRows = 5,
  t,
}) {
  const { theme } = useTheme();
  const s = React.useMemo(() => styles(theme), [theme]);
  const ranked = React.useMemo(() => {
    const rows = (Array.isArray(employees) ? employees : []).filter(hasActivity);
    return rows
      .sort((left, right) => {
        const primary = asNumber(right?.[metric]) - asNumber(left?.[metric]);
        if (primary !== 0) return primary;
        const revenue = asNumber(right?.revenue) - asNumber(left?.revenue);
        if (revenue !== 0) return revenue;
        return String(left?.name || '').localeCompare(String(right?.name || ''));
      })
      .slice(0, Math.max(1, maxRows));
  }, [employees, maxRows, metric]);
  const maximum = Math.max(1, ...ranked.map((employee) => Math.max(0, asNumber(employee?.[metric]))));

  const valueFor = React.useCallback(
    (employee) => metric === 'completed'
      ? formatCount(employee?.completed)
      : formatMoney(employee?.[metric]),
    [formatCount, formatMoney, metric],
  );
  const secondaryFor = React.useCallback((employee) => {
    const completed = formatCount(employee?.completed);
    if (metric === 'profit') {
      return replaceVariables(t('stats_team_row_revenue_completed'), {
        revenue: formatMoney(employee?.revenue),
        count: completed,
      });
    }
    if (metric === 'revenue') {
      return replaceVariables(t('stats_team_row_profit_completed'), {
        profit: formatMoney(employee?.profit),
        count: completed,
      });
    }
    const average = asNumber(employee?.completed) > 0
      ? asNumber(employee?.revenue) / asNumber(employee?.completed)
      : 0;
    return replaceVariables(t('stats_team_row_revenue_average'), {
      revenue: formatMoney(employee?.revenue),
      average: formatMoney(average),
    });
  }, [formatCount, formatMoney, metric, t]);

  return (
    <View>
      <View style={s.segmentedControl} accessibilityRole="tablist">
        {METRICS.map((item) => {
          const active = item.id === metric;
          return (
            <Pressable
              key={item.id}
              onPress={() => onMetricChange?.(item.id)}
              style={({ pressed }) => [
                s.segment,
                active && s.segmentActive,
                pressed && s.pressed,
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[s.segmentText, active && s.segmentTextActive]} numberOfLines={1}>
                {t(item.labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {ranked.length === 0 ? (
        <EmptyListState message={t('stats_no_team_activity')} />
      ) : (
        <View style={s.list}>
          {ranked.map((employee, index) => {
            const rawValue = asNumber(employee?.[metric]);
            const positiveWidth = rawValue > 0
              ? `${Math.max(4, (rawValue / maximum) * 100)}%`
              : '0%';
            const nonPositive = metric === 'profit' && rawValue <= 0;
            const negative = metric === 'profit' && rawValue < 0;
            return (
              <Pressable
                key={employee.id || `${employee.name}-${index}`}
                onPress={() => onEmployeePress?.(employee)}
                style={({ pressed }) => [s.row, pressed && s.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`${employee.name}: ${valueFor(employee)}`}
              >
                <View style={s.rankWrap}>
                  <Text style={s.rank}>{index + 1}</Text>
                </View>
                <View style={s.employeeContent}>
                  <View style={s.rowHeading}>
                    <View style={s.employeeNameWrap}>
                      <Text style={s.employeeName} numberOfLines={1}>{employee.name}</Text>
                      {employee.department_name ? (
                        <Text style={s.department} numberOfLines={1}>{employee.department_name}</Text>
                      ) : null}
                    </View>
                    <Text style={[s.value, nonPositive && s.negativeValue]} numberOfLines={1}>
                      {valueFor(employee)}
                    </Text>
                    <Feather
                      name="chevron-right"
                      size={theme.icons.sm}
                      color={theme.colors.textSecondary}
                    />
                  </View>
                  <Text style={s.secondary} numberOfLines={1}>{secondaryFor(employee)}</Text>
                  <View style={s.track}>
                    {rawValue > 0 ? (
                      <View
                        style={[
                          s.fill,
                          {
                            width: positiveWidth,
                            backgroundColor: metric === 'profit'
                              ? theme.colors.success
                              : metric === 'revenue'
                                ? theme.colors.primary
                                : theme.colors.info,
                          },
                        ]}
                      />
                    ) : null}
                    {negative ? <View style={s.negativeTrack} /> : null}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = (theme) => StyleSheet.create({
  segmentedControl: {
    flexDirection: 'row',
    padding: theme.spacing.xs,
    gap: theme.spacing.xs,
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.button.secondaryBg,
    marginBottom: theme.spacing.md,
  },
  segment: {
    flex: 1,
    minWidth: 0,
    minHeight: theme.components.button.sizes.sm.h,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.md,
    paddingHorizontal: theme.spacing.xs,
  },
  segmentActive: { backgroundColor: theme.colors.primary },
  segmentText: {
    color: theme.colors.textSecondary,
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weight.semibold,
  },
  segmentTextActive: { color: theme.colors.onPrimary },
  list: { gap: theme.spacing.xs },
  row: {
    minHeight: theme.components.listItem.height + theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
  },
  rankWrap: {
    width: theme.spacing.xxl,
    height: theme.spacing.xxl,
    borderRadius: theme.radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(theme.colors.primary, 0.1),
  },
  rank: {
    color: theme.colors.primary,
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weight.bold,
  },
  employeeContent: { flex: 1, minWidth: 0 },
  rowHeading: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  employeeNameWrap: { flex: 1, minWidth: 0 },
  employeeName: {
    color: theme.colors.text,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weight.semibold,
  },
  department: {
    color: theme.colors.textSecondary,
    fontSize: theme.typography.sizes.xs,
    marginTop: theme.spacing.xs / 2,
  },
  value: {
    color: theme.colors.text,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weight.bold,
    textAlign: 'right',
    maxWidth: '38%',
  },
  negativeValue: { color: theme.colors.danger },
  secondary: {
    color: theme.colors.textSecondary,
    fontSize: theme.typography.sizes.xs,
    marginTop: theme.spacing.xs,
  },
  track: {
    height: theme.spacing.xs,
    borderRadius: theme.radii.pill,
    overflow: 'hidden',
    backgroundColor: theme.colors.button.secondaryBg,
    marginTop: theme.spacing.sm,
  },
  fill: { height: '100%', borderRadius: theme.radii.pill },
  negativeTrack: {
    width: '100%',
    height: '100%',
    backgroundColor: withAlpha(theme.colors.danger, 0.5),
  },
  pressed: { opacity: theme.components.interactive?.pressedOpacity ?? 0.72 },
});
