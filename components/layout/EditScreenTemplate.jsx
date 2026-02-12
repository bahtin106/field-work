import React from 'react';
import { Keyboard, Platform, TouchableWithoutFeedback, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeProvider';
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

  const basePaddingBottom = Math.max(
    24,
    (theme.components?.scrollView?.paddingBottom ?? 24) + (insets?.bottom ?? 0),
  );

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
      <AppHeader back options={mergedOptions} onBackPress={onBack} />
      <KeyboardAwareScrollView
        ref={scrollRef}
        contentContainerStyle={[
          {
            paddingHorizontal: theme.spacing?.lg ?? 16,
            flexGrow: 1,
            paddingBottom: basePaddingBottom,
          },
          contentContainerStyle,
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior={Platform.OS === 'ios' ? 'always' : 'automatic'}
        scrollEnabled={scrollEnabled}
        bottomOffset={40}
        onScroll={onScroll}
        scrollEventThrottle={scrollEventThrottle}
      >
        {dismissKeyboardOnPress ? (
          <TouchableWithoutFeedback
            accessible={false}
            onPress={() => {
              try {
                Keyboard.dismiss();
              } catch {}
            }}
          >
            <View>{children}</View>
          </TouchableWithoutFeedback>
        ) : (
          <View>{children}</View>
        )}
      </KeyboardAwareScrollView>
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
