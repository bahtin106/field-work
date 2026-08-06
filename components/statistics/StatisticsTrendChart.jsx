import Feather from '@expo/vector-icons/Feather';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Line, Path, Stop } from 'react-native-svg';

import { fromLocalISODate } from '../../src/features/statistics/model';
import { useTheme } from '../../theme/ThemeProvider';
import { withAlpha } from '../../theme/colors';

const CHART_HEIGHT_SPACING_UNITS = 12;
const MIN_BUCKET_WIDTH_SPACING_UNITS = 4;
const AXIS_TARGET_INTERVALS = 4;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function niceStep(value) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const power = 10 ** exponent;
  const fraction = value / power;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * power;
}

function buildAxisScale(series, showSecondary, wholeNumbers) {
  const values = series.flatMap((row) => [
    row.primary,
    ...(showSecondary ? [row.secondary] : []),
  ]);
  const rawMinimum = Math.min(0, ...values);
  const rawMaximum = Math.max(0, ...values);
  const rawRange = Math.max(wholeNumbers ? 1 : Number.EPSILON, rawMaximum - rawMinimum);
  const step = Math.max(wholeNumbers ? 1 : Number.EPSILON, niceStep(rawRange / AXIS_TARGET_INTERVALS));
  const minimum = rawMinimum < 0 ? Math.floor(rawMinimum / step) * step : 0;
  let maximum = Math.ceil(rawMaximum / step) * step;
  if (maximum <= minimum) maximum = minimum + step;
  const intervals = Math.max(1, Math.round((maximum - minimum) / step));
  const ticks = Array.from({ length: intervals + 1 }, (_, index) => maximum - index * step);
  return { maximum, minimum, ticks };
}

function formatAxisValue(value, locale, divisor = 1, useCompactNotation = false) {
  const normalized = Math.abs(value) < Number.EPSILON ? 0 : value;
  try {
    return new Intl.NumberFormat(locale || undefined, {
      notation: useCompactNotation && Math.abs(normalized) >= 1000 ? 'compact' : 'standard',
      maximumFractionDigits: 1,
    }).format(normalized / divisor);
  } catch {
    return String(normalized / divisor);
  }
}

function resolveCurrencyMark(formatMoney) {
  return String(formatMoney?.(0) || '')
    .replace(/[\d\s.,\-+\u00A0\u202F]/g, '')
    .trim();
}

function buildSmoothPath(points) {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  return points.slice(0, -1).reduce((path, point, index) => {
    const previous = points[Math.max(0, index - 1)];
    const next = points[index + 1];
    const following = points[Math.min(points.length - 1, index + 2)];
    const controlOneX = point.x + (next.x - previous.x) / 6;
    const segmentMinimumY = Math.min(point.y, next.y);
    const segmentMaximumY = Math.max(point.y, next.y);
    const controlOneY = clamp(
      point.y + (next.y - previous.y) / 6,
      segmentMinimumY,
      segmentMaximumY,
    );
    const controlTwoX = next.x - (following.x - point.x) / 6;
    const controlTwoY = clamp(
      next.y - (following.y - point.y) / 6,
      segmentMinimumY,
      segmentMaximumY,
    );
    return `${path} C ${controlOneX} ${controlOneY}, ${controlTwoX} ${controlTwoY}, ${next.x} ${next.y}`;
  }, `M ${points[0].x} ${points[0].y}`);
}

function buildAreaPath(points, linePath, baselineY) {
  if (points.length === 0 || !linePath) return '';
  const first = points[0];
  const last = points[points.length - 1];
  return `${linePath} L ${last.x} ${baselineY} L ${first.x} ${baselineY} Z`;
}

function formatBucketLabel(row, locale, granularity) {
  const date = fromLocalISODate(row?.from);
  if (!Number.isFinite(date.getTime())) return '';
  if (granularity === 'month') {
    return new Intl.DateTimeFormat(locale || undefined, { month: 'short' }).format(date);
  }
  return new Intl.DateTimeFormat(locale || undefined, { day: '2-digit', month: '2-digit' }).format(date);
}

export default function StatisticsTrendChart({
  rows = [],
  mode = 'orders',
  onModeChange,
  locale,
  granularity,
  formatMoney,
  t,
  personal = false,
}) {
  const { theme } = useTheme();
  const s = React.useMemo(() => styles(theme), [theme]);
  const [visualization, setVisualization] = React.useState('bars');
  const [viewportWidth, setViewportWidth] = React.useState(0);
  const gradientSeed = React.useId().replace(/:/g, '');
  const chartHeight = theme.spacing.md * CHART_HEIGHT_SPACING_UNITS;
  const axisLabelHeight = Math.round(
    theme.typography.sizes.xs * theme.typography.lineHeights.normal,
  );
  const minimumBucketWidth = theme.spacing.md * MIN_BUCKET_WIDTH_SPACING_UNITS;
  const isMoney = mode === 'money';
  const series = React.useMemo(
    () =>
      (Array.isArray(rows) ? rows : []).map((row) => ({
        ...row,
        primary: Number(isMoney ? (personal ? row.personal_earnings : row.revenue) : row.registered) || 0,
        secondary: Number(isMoney ? (personal ? 0 : row.profit) : row.completed) || 0,
      })),
    [isMoney, personal, rows],
  );
  const showSecondary = !isMoney || !personal;
  const axis = React.useMemo(
    () => buildAxisScale(series, showSecondary, !isMoney),
    [isMoney, series, showSecondary],
  );
  const axisPresentation = React.useMemo(() => {
    if (!isMoney) return { divisor: 1, unit: '', useCompactNotation: true };
    const magnitude = Math.max(Math.abs(axis.minimum), Math.abs(axis.maximum));
    const scale = magnitude >= 1_000_000_000
      ? { divisor: 1_000_000_000, label: t('stats_chart_axis_billions') }
      : magnitude >= 1_000_000
        ? { divisor: 1_000_000, label: t('stats_chart_axis_millions') }
        : magnitude >= 1_000
          ? { divisor: 1_000, label: t('stats_chart_axis_thousands') }
          : { divisor: 1, label: '' };
    const currencyMark = resolveCurrencyMark(formatMoney);
    return {
      divisor: scale.divisor,
      unit: [scale.label, currencyMark].filter(Boolean).join(' '),
      useCompactNotation: false,
    };
  }, [axis.maximum, axis.minimum, formatMoney, isMoney, t]);
  const axisWidth = isMoney
    ? theme.spacing.xxl + theme.spacing.xl
    : theme.spacing.xxl + theme.spacing.xs;
  const chartWidth = Math.max(viewportWidth, axisWidth + series.length * minimumBucketWidth);
  const plotGeometry = React.useMemo(() => {
    const top = axisPresentation.unit ? theme.spacing.xxl : theme.spacing.sm;
    const bottom = chartHeight - theme.spacing.sm;
    const range = Math.max(Number.EPSILON, axis.maximum - axis.minimum);
    const toY = (value) => top + ((axis.maximum - value) / range) * (bottom - top);
    return {
      baselineY: toY(0),
      bottom,
      tickPositions: axis.ticks.map((value) => ({ value, y: toY(value) })),
      top,
      toY,
    };
  }, [axis, axisPresentation.unit, chartHeight, theme.spacing.sm, theme.spacing.xxl]);
  const lineChart = React.useMemo(() => {
    const plotWidth = Math.max(0, chartWidth - axisWidth);
    const bucketWidth = plotWidth / Math.max(1, series.length);
    const pointX = (index) => axisWidth + bucketWidth * (index + 0.5);
    const primaryPoints = series.map((row, index) => ({
      x: pointX(index),
      y: plotGeometry.toY(row.primary),
    }));
    const secondaryPoints = showSecondary
      ? series.map((row, index) => ({ x: pointX(index), y: plotGeometry.toY(row.secondary) }))
      : [];
    const primaryPath = buildSmoothPath(primaryPoints);
    const secondaryPath = buildSmoothPath(secondaryPoints);
    return {
      primaryArea: buildAreaPath(primaryPoints, primaryPath, plotGeometry.baselineY),
      primaryPath,
      primaryPoints,
      secondaryArea: buildAreaPath(secondaryPoints, secondaryPath, plotGeometry.baselineY),
      secondaryPath,
      secondaryPoints,
    };
  }, [axisWidth, chartWidth, plotGeometry, series, showSecondary]);
  const isLineChart = visualization === 'line';
  const toggleVisualization = React.useCallback(() => {
    setVisualization((current) => (current === 'bars' ? 'line' : 'bars'));
  }, []);
  const switchLabel = t(isLineChart ? 'stats_chart_switch_to_bars' : 'stats_chart_switch_to_line');

  return (
    <View>
      <View style={s.modeRow}>
        {[
          { id: 'orders', label: t('stats_chart_requests'), icon: 'clipboard' },
          { id: 'money', label: t('stats_chart_money'), icon: 'credit-card' },
        ].map((item) => {
          const active = item.id === mode;
          return (
            <Pressable
              key={item.id}
              onPress={() => onModeChange?.(item.id)}
              style={({ pressed }) => [
                s.modeButton,
                active && s.modeButtonActive,
                pressed && s.pressed,
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Feather
                name={item.icon}
                size={theme.icons.sm}
                color={active ? theme.colors.onPrimary : theme.colors.textSecondary}
              />
              <Text style={[s.modeText, active && s.modeTextActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={s.legendRow}>
        <View style={s.legendItem}>
          <View style={[s.legendDot, { backgroundColor: theme.colors.primary }]} />
          <Text style={s.legendText}>
            {t(isMoney ? (personal ? 'stats_earnings_accrued' : 'stats_completed_revenue') : 'stats_registered')}
          </Text>
        </View>
        {!isMoney || !personal ? (
          <View style={s.legendItem}>
            <View style={[s.legendDot, { backgroundColor: theme.colors.success }]} />
            <Text style={s.legendText}>{t(isMoney ? 'stats_job_profit' : 'stats_completed')}</Text>
          </View>
        ) : null}
      </View>

      <View
        style={s.chartViewport}
        onLayout={(event) => setViewportWidth(Math.round(event.nativeEvent.layout.width))}
      >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.chartScrollContent}
          >
            <Pressable
              onPress={toggleVisualization}
              style={({ pressed }) => [
                s.visualizationSurface,
                { width: chartWidth },
                pressed && s.chartPressed,
              ]}
              accessible={false}
            >
              {isLineChart ? (
                <View>
                  <Svg width={chartWidth} height={chartHeight}>
                  <Defs>
                    <LinearGradient id={`${gradientSeed}Primary`} x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0" stopColor={theme.colors.primary} stopOpacity="0.28" />
                      <Stop offset="1" stopColor={theme.colors.primary} stopOpacity="0.02" />
                    </LinearGradient>
                    <LinearGradient id={`${gradientSeed}Secondary`} x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0" stopColor={theme.colors.success} stopOpacity="0.2" />
                      <Stop offset="1" stopColor={theme.colors.success} stopOpacity="0.01" />
                    </LinearGradient>
                  </Defs>
                  {plotGeometry.tickPositions.map((tick) => (
                      <Line
                        key={`grid-${tick.value}`}
                        x1={axisWidth}
                        x2={chartWidth}
                        y1={tick.y}
                        y2={tick.y}
                        stroke={tick.value === 0
                          ? withAlpha(theme.colors.textSecondary, 0.5)
                          : withAlpha(theme.colors.border, 0.72)}
                        strokeWidth={tick.value === 0 ? 1 : StyleSheet.hairlineWidth}
                        strokeDasharray={tick.value === 0 ? undefined : "4 6"}
                      />
                  ))}
                  {lineChart.secondaryArea ? (
                    <Path d={lineChart.secondaryArea} fill={`url(#${gradientSeed}Secondary)`} />
                  ) : null}
                  {lineChart.primaryArea ? (
                    <Path d={lineChart.primaryArea} fill={`url(#${gradientSeed}Primary)`} />
                  ) : null}
                  {lineChart.secondaryPath ? (
                    <Path
                      d={lineChart.secondaryPath}
                      fill="none"
                      stroke={theme.colors.success}
                      strokeWidth={theme.spacing.xs / 2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : null}
                  {lineChart.primaryPath ? (
                    <Path
                      d={lineChart.primaryPath}
                      fill="none"
                      stroke={theme.colors.primary}
                      strokeWidth={theme.spacing.xs / 2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : null}
                  {lineChart.secondaryPoints.map((point, index) => (
                    <React.Fragment key={`secondary-point-${series[index]?.from || index}`}>
                      <Circle cx={point.x} cy={point.y} r={theme.spacing.xs} fill={withAlpha(theme.colors.success, 0.16)} />
                      <Circle
                        cx={point.x}
                        cy={point.y}
                        r={theme.spacing.xs / 2}
                        fill={theme.colors.surface}
                        stroke={theme.colors.success}
                        strokeWidth={theme.spacing.xs / 2}
                      />
                    </React.Fragment>
                  ))}
                  {lineChart.primaryPoints.map((point, index) => (
                    <React.Fragment key={`primary-point-${series[index]?.from || index}`}>
                      <Circle cx={point.x} cy={point.y} r={theme.spacing.xs} fill={withAlpha(theme.colors.primary, 0.16)} />
                      <Circle
                        cx={point.x}
                        cy={point.y}
                        r={theme.spacing.xs / 2}
                        fill={theme.colors.surface}
                        stroke={theme.colors.primary}
                        strokeWidth={theme.spacing.xs / 2}
                      />
                    </React.Fragment>
                  ))}
                  </Svg>
                  <View style={[s.lineLabels, { width: chartWidth, paddingLeft: axisWidth }]}>
                  {series.map((row) => (
                    <Text
                      key={`${row.from}-${row.to}`}
                      style={[
                        s.bucketLabel,
                        { width: (chartWidth - axisWidth) / Math.max(1, series.length) },
                      ]}
                      numberOfLines={1}
                      accessible
                      accessibilityLabel={`${formatBucketLabel(row, locale, granularity)}: ${
                        isMoney
                          ? personal
                            ? formatMoney(row.primary)
                            : `${formatMoney(row.primary)}, ${formatMoney(row.secondary)}`
                          : `${row.primary}, ${row.secondary}`
                      }`}
                    >
                      {formatBucketLabel(row, locale, granularity)}
                    </Text>
                  ))}
                  </View>
                </View>
              ) : (
                <View>
                  <View style={[s.barPlot, s.chartHeight]}>
                    {plotGeometry.tickPositions.map((tick) => (
                      <View
                        key={`bar-grid-${tick.value}`}
                        style={[
                          s.barGridLine,
                          { top: tick.y, left: axisWidth },
                          tick.value === 0 && s.barZeroLine,
                        ]}
                      />
                    ))}
                    <View style={[s.barBuckets, { left: axisWidth }]}>
                      {series.map((row) => {
                        const getBarMetrics = (value) => {
                          if (value === 0) return { height: 0, top: plotGeometry.baselineY };
                          const valueY = plotGeometry.toY(value);
                          const height = Math.max(theme.spacing.xs, Math.abs(valueY - plotGeometry.baselineY));
                          return {
                            height,
                            top: value > 0 ? plotGeometry.baselineY - height : plotGeometry.baselineY,
                          };
                        };
                        const primaryMetrics = getBarMetrics(row.primary);
                        const secondaryMetrics = getBarMetrics(row.secondary);
                  const accessibilityValue = isMoney
                    ? personal
                      ? formatMoney(row.primary)
                      : `${formatMoney(row.primary)}, ${formatMoney(row.secondary)}`
                    : `${row.primary}, ${row.secondary}`;
                        return (
                          <View
                            key={`${row.from}-${row.to}`}
                            style={s.barBucket}
                            accessible
                            accessibilityLabel={`${formatBucketLabel(row, locale, granularity)}: ${accessibilityValue}`}
                          >
                            <View style={s.barPair}>
                              <View style={s.barColumn}>
                                <View
                                  style={[
                                    s.bar,
                                    primaryMetrics,
                                    row.primary < 0 ? s.barNegative : s.barPositive,
                                    { backgroundColor: theme.colors.primary },
                                  ]}
                                />
                              </View>
                              {showSecondary ? (
                                <View style={s.barColumn}>
                                  <View
                                    style={[
                                      s.bar,
                                      secondaryMetrics,
                                      row.secondary < 0 ? s.barNegative : s.barPositive,
                                      { backgroundColor: theme.colors.success },
                                    ]}
                                  />
                                </View>
                              ) : null}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                  <View style={[s.lineLabels, { width: chartWidth, paddingLeft: axisWidth }]}>
                    {series.map((row) => (
                      <Text
                        key={`${row.from}-${row.to}`}
                        style={[
                          s.bucketLabel,
                          { width: (chartWidth - axisWidth) / Math.max(1, series.length) },
                        ]}
                        numberOfLines={1}
                      >
                        {formatBucketLabel(row, locale, granularity)}
                      </Text>
                    ))}
                  </View>
                </View>
              )}
            </Pressable>
          </ScrollView>
          <View
            pointerEvents="none"
            style={[s.yAxisOverlay, { width: axisWidth, height: chartHeight }]}
          >
            {axisPresentation.unit ? (
              <Text style={s.axisUnit} numberOfLines={1}>
                {axisPresentation.unit}
              </Text>
            ) : null}
            {plotGeometry.tickPositions.map((tick) => (
              <Text
                key={`axis-${tick.value}`}
                style={[s.yAxisLabel, { top: tick.y - axisLabelHeight / 2 }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
                accessibilityElementsHidden
                importantForAccessibility="no"
              >
                {formatAxisValue(
                  tick.value,
                  locale,
                  axisPresentation.divisor,
                  axisPresentation.useCompactNotation,
                )}
              </Text>
            ))}
          </View>
        </View>

      <Pressable
        onPress={toggleVisualization}
        style={({ pressed }) => [s.visualizationHint, pressed && s.pressed]}
        accessibilityRole="button"
        accessibilityLabel={switchLabel}
      >
        <Feather
          name={isLineChart ? 'bar-chart-2' : 'activity'}
          size={theme.icons.sm}
          color={theme.colors.textSecondary}
        />
        <Text style={s.visualizationHintText}>{switchLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = (theme) => {
  const chartHeight = theme.spacing.md * CHART_HEIGHT_SPACING_UNITS;
  return StyleSheet.create({
    modeRow: {
      flexDirection: 'row',
      padding: theme.spacing.xs,
      borderRadius: theme.radii.lg,
      backgroundColor: theme.colors.button.secondaryBg,
      gap: theme.spacing.xs,
    },
    modeButton: {
      flex: 1,
      minHeight: theme.components.input.height,
      borderRadius: theme.radii.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
    },
    modeButtonActive: { backgroundColor: theme.colors.primary },
    modeText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.semibold,
    },
    modeTextActive: { color: theme.colors.onPrimary },
    pressed: { opacity: theme.components.interactive?.pressedOpacity ?? 0.72 },
    legendRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.md,
      marginTop: theme.spacing.md,
    },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
    legendDot: { width: theme.spacing.sm, height: theme.spacing.sm, borderRadius: theme.radii.pill },
    legendText: { color: theme.colors.textSecondary, fontSize: theme.typography.sizes.xs },
    axisUnit: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: theme.spacing.xs,
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.xs,
      fontWeight: theme.typography.weight.medium,
      textAlign: 'right',
    },
    yAxisOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      zIndex: 2,
      backgroundColor: theme.colors.surface,
    },
    yAxisLabel: {
      position: 'absolute',
      left: 0,
      right: theme.spacing.xs,
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.xs,
      lineHeight: Math.round(theme.typography.sizes.xs * theme.typography.lineHeights.normal),
      textAlign: 'right',
    },
    chartViewport: {
      width: '100%',
      position: 'relative',
    },
    chartScrollContent: {
      minWidth: '100%',
    },
    visualizationSurface: {
      minWidth: '100%',
      paddingBottom: theme.spacing.xs,
    },
    chartPressed: {
      opacity: theme.components.interactive?.pressedOpacity ?? 0.84,
    },
    chartHeight: { height: chartHeight },
    barPlot: {
      position: 'relative',
    },
    barGridLine: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: StyleSheet.hairlineWidth,
      backgroundColor: withAlpha(theme.colors.border, 0.72),
    },
    barZeroLine: {
      height: 1,
      backgroundColor: withAlpha(theme.colors.textSecondary, 0.5),
    },
    barBuckets: {
      ...StyleSheet.absoluteFillObject,
      flexDirection: 'row',
    },
    barBucket: {
      minWidth: theme.spacing.md * MIN_BUCKET_WIDTH_SPACING_UNITS,
      flex: 1,
    },
    barPair: {
      height: '100%',
      flexDirection: 'row',
      justifyContent: 'center',
      gap: theme.spacing.xs,
    },
    barColumn: {
      width: theme.spacing.sm,
      height: '100%',
      position: 'relative',
    },
    bar: {
      position: 'absolute',
      width: '100%',
      minHeight: 0,
    },
    barPositive: {
      borderTopLeftRadius: theme.radii.xs,
      borderTopRightRadius: theme.radii.xs,
    },
    barNegative: {
      borderBottomLeftRadius: theme.radii.xs,
      borderBottomRightRadius: theme.radii.xs,
    },
    bucketLabel: {
      marginTop: theme.spacing.xs,
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.xs,
      flexShrink: 0,
      textAlign: 'center',
    },
    lineLabels: {
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    visualizationHint: {
      minHeight: theme.components.button.sizes.sm.h,
      marginTop: theme.spacing.xs,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.xs,
    },
    visualizationHintText: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.xs,
    },
  });
};
