import React from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from '../../lib/keyboardControllerCompat';
import { FormAutoScrollProvider } from '../../src/shared/forms/FormAutoScrollContext';
import { useTheme } from '../../theme/ThemeProvider';
import DismissKeyboardArea from './DismissKeyboardArea';
import AppHeader from '../navigation/AppHeader';

export default function EditScreenTemplate({
  title,
  rightTextLabel,
  onRightPress,
  onBack,
  headerOptions,
  children,
  scrollRef,
  contentContainerStyle,
  onScroll,
  scrollEventThrottle = 16,
  scrollEnabled = true,
  dismissKeyboardOnPress = true,
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const internalScrollRef = React.useRef(null);
  const internalScrollYRef = React.useRef(0);
  const resolvedScrollRef = scrollRef || internalScrollRef;
  const headerHeight = theme.components?.header?.height ?? theme.sizes?.header ?? 56;

  const basePaddingBottom = Math.max(
    24,
    (theme.components?.scrollView?.paddingBottom ?? 24) + (insets?.bottom ?? 0),
  );
  const keyboardBottomOffset = theme.components?.keyboardAware?.bottomOffset ?? 40;
  const extraKeyboardSpace = theme.components?.keyboardAware?.extraKeyboardSpace ?? 0;

  const mergedOptions = {
    headerTitleAlign: 'left',
    title,
    rightTextLabel,
    onRightPress,
    ...(headerOptions || {}),
  };

  // Если передан onBack, добавляем его в headerOptions
  if (onBack) {
    mergedOptions.headerLeft = () => null; // Будет обработан в AppHeader через onBackPress
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      edges={['left', 'right']}
    >
      <FormAutoScrollProvider
        enabled={scrollEnabled}
        scrollRef={resolvedScrollRef}
        scrollYRef={internalScrollYRef}
        insetsBottom={insets.bottom}
        headerHeight={headerHeight}
      >
        <AppHeader back options={mergedOptions} onBackPress={onBack} />
        <KeyboardAwareScrollView
          ref={resolvedScrollRef}
          contentContainerStyle={[
            {
              paddingHorizontal: theme.spacing?.lg ?? 16,
              flexGrow: 1,
              paddingBottom: basePaddingBottom,
            },
            contentContainerStyle,
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          showsVerticalScrollIndicator={false}
          contentInsetAdjustmentBehavior={Platform.OS === 'ios' ? 'always' : 'automatic'}
          scrollEnabled={scrollEnabled}
          bottomOffset={keyboardBottomOffset}
          extraKeyboardSpace={extraKeyboardSpace}
          onScroll={(event) => {
            internalScrollYRef.current = event?.nativeEvent?.contentOffset?.y || 0;
            onScroll?.(event);
          }}
          scrollEventThrottle={scrollEventThrottle}
        >
          {dismissKeyboardOnPress ? (
            <DismissKeyboardArea>
              <View>{children}</View>
            </DismissKeyboardArea>
          ) : (
            <View>{children}</View>
          )}
        </KeyboardAwareScrollView>
      </FormAutoScrollProvider>
    </SafeAreaView>
  );
}

export function useEditFormStyles() {
  const { theme } = useTheme();
  return React.useMemo(
    () => ({
      card: {
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radii.lg,
        padding: theme.spacing.md,
        borderColor: theme.colors.border,
        borderWidth: theme.components.card.borderWidth,
        marginBottom: theme.spacing.md,
      },
      field: {
        marginHorizontal: 0,
        marginVertical: theme.components?.input?.fieldSpacing ?? theme.spacing.sm,
      },
    }),
    [theme],
  );
}
