import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../../theme';
import UIButton from '../Button';

export default function ModalActionsRow({ actions = [] }) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const visibleActions = Array.isArray(actions) ? actions.filter(Boolean) : [];
  const isSingle = visibleActions.length <= 1;

  return (
    <View style={isSingle ? styles.singleRow : styles.row}>
      {visibleActions.map((action, index) => (
        <View
          key={String(action.key || action.title || index)}
          style={isSingle ? styles.singleSlot : styles.slot}
        >
          <UIButton
            title={action.title}
            variant={action.variant || 'secondary'}
            onPress={action.onPress}
            loading={!!action.loading}
            disabled={!!action.disabled}
          />
        </View>
      ))}
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      gap: theme.spacing.md,
    },
    singleRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
    },
    slot: {
      flex: 1,
      minWidth: 0,
    },
    singleSlot: {
      minWidth: 160,
      maxWidth: 220,
      width: '100%',
    },
  });
}
