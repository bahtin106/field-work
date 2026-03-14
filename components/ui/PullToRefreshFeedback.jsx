import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Animated, Easing, Platform, RefreshControl, StyleSheet, View } from 'react-native';
import { useTranslation } from '../../src/i18n/useTranslation';
import { withAlpha } from '../../theme/colors';
import { useTheme } from '../../theme/ThemeProvider';
import { useToast } from './ToastProvider';

function RefreshFeedbackOverlay({ topOffset = 0, successValue }) {
  const { theme } = useTheme();
  const size = theme.components?.refreshFeedback?.size ?? 30;
  const iconSize = theme.components?.refreshFeedback?.iconSize ?? 16;
  const checkScale = successValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0.72, 1],
  });
  const containerScale = successValue.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.06],
  });
  const backgroundColor =
    withAlpha(theme.colors.success, 0.16);
  const borderColor = withAlpha(theme.colors.success, 0.28);

  return (
    <View pointerEvents="none" style={[styles.overlay, { top: topOffset }]}>
      <Animated.View
        style={[
          styles.badge,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor,
            borderColor,
            transform: [{ scale: containerScale }],
          },
          theme.shadows?.card?.[Platform.OS] || null,
        ]}
      >
        <Animated.View
          style={[
            styles.iconLayer,
            {
              opacity: successValue,
              transform: [{ scale: checkScale }],
            },
          ]}
        >
          <Feather name="check" size={iconSize} color={theme.colors.success} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

export function ThemedRefreshControl({
  nativeIndicatorVisible = true,
  tintColor,
  colors,
  progressBackgroundColor,
  ...props
}) {
  const { theme } = useTheme();
  const shouldShowNativeIndicator = nativeIndicatorVisible && Boolean(props.refreshing);
  const resolvedTintColor = shouldShowNativeIndicator ? (tintColor ?? theme.colors.primary) : 'transparent';
  const resolvedColors = shouldShowNativeIndicator
    ? colors ?? (Platform.OS === 'android' ? [theme.colors.primary] : undefined)
    : Platform.OS === 'android'
      ? ['transparent']
      : undefined;

  const resolvedProgressBackgroundColor = shouldShowNativeIndicator
    ? progressBackgroundColor
    : undefined;

  return (
    <RefreshControl
      {...props}
      tintColor={resolvedTintColor}
      colors={resolvedColors}
      progressBackgroundColor={resolvedProgressBackgroundColor}
    />
  );
}

export function usePullToRefreshFeedback(refreshing, options = {}) {
  const { theme } = useTheme();
  const successDurationMs =
    options.successDurationMs ?? theme.components?.refreshFeedback?.successDurationMs ?? 820;
  const topOffset = options.topOffset ?? theme.components?.refreshFeedback?.topOffset ?? theme.spacing.sm;
  const didSucceed = options.didSucceed !== false;
  const visibleValue = React.useRef(new Animated.Value(0)).current;
  const successValue = React.useRef(new Animated.Value(0)).current;
  const [phase, setPhase] = React.useState('idle');
  const successTimerRef = React.useRef(null);
  const prevRefreshingRef = React.useRef(Boolean(refreshing));

  React.useEffect(() => {
    return () => {
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    const wasRefreshing = prevRefreshingRef.current;
    prevRefreshingRef.current = Boolean(refreshing);

    if (refreshing) {
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current);
        successTimerRef.current = null;
      }
      successValue.setValue(0);
      visibleValue.setValue(0);
      setPhase('idle');
      return;
    }

    if (wasRefreshing && didSucceed) {
      setPhase('success');
      successValue.setValue(0);
      visibleValue.setValue(1);
      Animated.sequence([
        Animated.timing(successValue, {
          toValue: 1,
          duration: 180,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(successDurationMs),
      ]).start(() => {
        Animated.timing(visibleValue, {
          toValue: 0,
          duration: 180,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }).start(() => {
          successValue.setValue(0);
          setPhase('idle');
        });
      });
      return;
    }

    Animated.timing(visibleValue, {
      toValue: 0,
      duration: 120,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      successValue.setValue(0);
      setPhase('idle');
    });
  }, [didSucceed, refreshing, successDurationMs, successValue, visibleValue]);

  const indicator =
    phase !== 'success' ? null : (
      <Animated.View pointerEvents="none" style={[styles.overlayFill, { opacity: visibleValue }]}>
        <RefreshFeedbackOverlay topOffset={topOffset} successValue={successValue} />
      </Animated.View>
    );

  return {
    indicator,
  };
}

function getErrorMessage(error) {
  return String(error?.message || error?.error || error?.details || error?.hint || '');
}

function isNetworkLikeError(error) {
  return /network|timeout|timed?out|failed to fetch|network request failed|econn|ehostunreach/i.test(
    getErrorMessage(error),
  );
}

export function useManagedRefresh(refreshAction, options = {}) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const timeoutMs = options.timeoutMs ?? theme.timings?.requestTimeoutMs ?? 12000;
  const slowWarningMs = options.slowWarningMs ?? 4000;
  const slowMessage = options.slowMessage ?? t('refresh_slow', 'Refreshing is taking longer than usual');
  const timeoutMessage =
    options.timeoutMessage ?? t('refresh_timeout', 'Could not refresh the data. Check your connection and try again');
  const failedMessage = options.failedMessage ?? t('refresh_failed', 'Could not refresh the data');

  const [refreshing, setRefreshing] = React.useState(false);
  const [didSucceed, setDidSucceed] = React.useState(true);
  const inFlightRef = React.useRef(false);
  const slowTimerRef = React.useRef(null);

  React.useEffect(() => {
    return () => {
      if (slowTimerRef.current) {
        clearTimeout(slowTimerRef.current);
      }
    };
  }, []);

  const onRefresh = React.useCallback(async () => {
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    setRefreshing(true);
    setDidSucceed(false);

    if (slowTimerRef.current) {
      clearTimeout(slowTimerRef.current);
      slowTimerRef.current = null;
    }

    slowTimerRef.current = setTimeout(() => {
      toast.info(slowMessage);
    }, slowWarningMs);

    let timeoutId = null;
    try {
      await Promise.race([
        Promise.resolve().then(() => refreshAction()),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            const error = new Error('Refresh timeout');
            error.code = 'REFRESH_TIMEOUT';
            reject(error);
          }, timeoutMs);
        }),
      ]);
      setDidSucceed(true);
    } catch (error) {
      setDidSucceed(false);
      if (error?.code === 'REFRESH_TIMEOUT') {
        toast.error(timeoutMessage);
      } else if (isNetworkLikeError(error)) {
        toast.error(t('errors_network', 'No connection to the server'));
      } else {
        toast.error(getErrorMessage(error) || failedMessage);
      }
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (slowTimerRef.current) {
        clearTimeout(slowTimerRef.current);
        slowTimerRef.current = null;
      }
      setRefreshing(false);
      inFlightRef.current = false;
    }
  }, [failedMessage, refreshAction, slowMessage, slowWarningMs, t, timeoutMessage, timeoutMs, toast]);

  return {
    refreshing,
    didSucceed,
    onRefresh,
  };
}

const styles = StyleSheet.create({
  overlayFill: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
  },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  iconLayer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
