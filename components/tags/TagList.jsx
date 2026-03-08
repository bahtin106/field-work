import React from 'react';
import { StyleSheet, View } from 'react-native';
import TagCapsule from './TagCapsule';
import { useTheme } from '../../theme/ThemeProvider';

export default function TagList({
  tags = [],
  onPressTag,
  onDeleteTag,
  compact = false,
  align = 'start',
  style,
}) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  if (!Array.isArray(tags) || tags.length === 0) return null;

  return (
    <View style={[styles.wrap, align === 'end' ? styles.wrapEnd : null, style]}>
      {tags.map((tag) => (
        <TagCapsule
          key={String(tag?.id || tag?.value)}
          label={String(tag?.value || '')}
          compact={compact}
          onPress={typeof onPressTag === 'function' ? () => onPressTag(tag) : undefined}
          onDeleteBadgePress={typeof onDeleteTag === 'function' ? () => onDeleteTag(tag) : undefined}
        />
      ))}
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    wrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.xs,
    },
    wrapEnd: {
      width: '100%',
      justifyContent: 'flex-end',
    },
  });
}

