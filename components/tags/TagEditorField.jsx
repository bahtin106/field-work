import React from 'react';
import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useToast } from '../ui/ToastProvider';
import { useTheme } from '../../theme/ThemeProvider';
import { useTranslation } from '../../src/i18n/useTranslation';
import TagCapsule from './TagCapsule';
import TextField from '../ui/TextField';
import { MAX_TAG_LENGTH, MAX_TAGS_PER_ENTITY, TAG_SUGGESTIONS_LIMIT } from './tagConfig';
import { useTagSuggestions } from '../../src/features/tags/queries';

function normalizeTagValue(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function findDuplicate(values, nextValue) {
  const normalizedNext = normalizeTagValue(nextValue).toLowerCase();
  if (!normalizedNext) return true;
  return values.some((value) => normalizeTagValue(value).toLowerCase() === normalizedNext);
}

export default function TagEditorField({
  label,
  tagType,
  tags = [],
  onChange,
  disabled = false,
  placeholder,
  hideSeparator = false,
  showSuggestions = true,
  allowRemove = true,
  showLabel = true,
  showInlineTags = true,
  commitOnBlur = true,
  maxTags = MAX_TAGS_PER_ENTITY,
  suggestionsPlacement = 'top',
}) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const [query, setQuery] = React.useState('');
  const [debouncedQuery, setDebouncedQuery] = React.useState('');
  const [focused, setFocused] = React.useState(false);
  const inputRef = React.useRef(null);
  const blurTimerRef = React.useRef(null);
  const hasLimit = Number.isFinite(maxTags) && Number(maxTags) > 0;
  const maxTagsCount = hasLimit ? Number(maxTags) : null;

  const normalizedTags = React.useMemo(
    () => (Array.isArray(tags) ? tags.map((tag) => normalizeTagValue(tag?.value || tag)).filter(Boolean) : []),
    [tags],
  );
  const canTypeMore = !hasLimit || normalizedTags.length < maxTagsCount;

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, Number(theme?.timings?.backDelayMs ?? 250));
    return () => clearTimeout(timer);
  }, [query, theme?.timings?.backDelayMs]);

  const { data: suggestions = [] } = useTagSuggestions({
    tagType,
    query: debouncedQuery,
    enabled: !!tagType && showSuggestions && !disabled && canTypeMore,
  });

  const clearBlurTimer = React.useCallback(() => {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
  }, []);

  React.useEffect(() => () => clearBlurTimer(), [clearBlurTimer]);

  const resolvedLabel = React.useMemo(() => {
    const baseLabel = String(label || '').trim();
    if (!baseLabel) return '';
    if (!hasLimit) return baseLabel;
    const limitTemplate = String(t('tags_limit_hint') || '').trim();
    const suffix = (limitTemplate || '(max {count})').replace('{count}', String(maxTagsCount));
    return `${baseLabel} ${suffix}`.trim();
  }, [hasLimit, label, maxTagsCount, t]);

  const addTag = React.useCallback(
    (rawValue) => {
      const value = normalizeTagValue(rawValue).slice(0, MAX_TAG_LENGTH);
      if (!value) return false;

      if (findDuplicate(normalizedTags, value)) {
        setQuery('');
        toast.info(t('tags_duplicate_toast'));
        return false;
      }

      if (hasLimit && normalizedTags.length >= maxTagsCount) {
        toast.warning(t('tags_max_toast').replace('{count}', String(maxTagsCount)));
        return false;
      }

      onChange?.([...normalizedTags, value]);
      setQuery('');

      return true;
    },
    [hasLimit, maxTagsCount, normalizedTags, onChange, t, toast],
  );

  const removeTagByIndex = React.useCallback(
    (index) => {
      if (index < 0 || index >= normalizedTags.length) return;
      const next = normalizedTags.filter((_, idx) => idx !== index);
      onChange?.(next);
    },
    [normalizedTags, onChange],
  );

  const visibleSuggestions = React.useMemo(() => {
    if (!canTypeMore) return [];
    const q = normalizeTagValue(query).toLowerCase();
    return suggestions
      .filter((item) => {
        const value = normalizeTagValue(item?.value || '');
        if (!value) return false;
        if (findDuplicate(normalizedTags, value)) return false;
        if (!q) return true;
        return value.toLowerCase().startsWith(q);
      })
      .slice(0, TAG_SUGGESTIONS_LIMIT);
  }, [canTypeMore, normalizedTags, query, suggestions]);
  const plusButton = (
    <Pressable
      onPress={() => {
        clearBlurTimer();
        if (!canTypeMore) {
          if (hasLimit) {
            toast.warning(t('tags_max_toast').replace('{count}', String(maxTagsCount)));
          }
          return;
        }
        if (query) {
          addTag(query);
          requestAnimationFrame(() => {
            inputRef.current?.focus?.();
          });
        } else {
          inputRef.current?.focus?.();
        }
        setFocused(true);
      }}
      disabled={disabled}
      style={styles.addBtn}
      accessibilityRole="button"
      accessibilityLabel={t('tags_input_placeholder')}
      hitSlop={theme.components?.interactive?.hitSlop ?? { top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Feather name="plus" size={theme.icons?.sm ?? 18} color={theme.colors.textSecondary} />
    </Pressable>
  );

  const commonInputProps = {
    ref: inputRef,
    value: query,
    onChangeText: (nextText) => setQuery(String(nextText || '').slice(0, MAX_TAG_LENGTH)),
    onFocus: () => {
      clearBlurTimer();
      setFocused(true);
    },
    onBlur: () => {
      clearBlurTimer();
      blurTimerRef.current = setTimeout(() => {
        if (commitOnBlur && query) addTag(query);
        setFocused(false);
      }, 120);
    },
    onSubmitEditing: () => {
      addTag(query);
    },
    onKeyPress: (event) => {
      if (event?.nativeEvent?.key === 'Backspace' && !query && normalizedTags.length) {
        removeTagByIndex(normalizedTags.length - 1);
      }
    },
    placeholder,
    rightSlot: plusButton,
  };

  return (
    <View>
      {showLabel ? (
        <View style={styles.labelRow}>
          <Text style={styles.label}>{resolvedLabel}</Text>
        </View>
      ) : null}

      {showInlineTags ? (
        <View style={styles.rowWrap}>
          <View style={styles.inputAnchor}>
            {focused && visibleSuggestions.length > 0 ? (
              <View
                style={[
                  styles.suggestionsWrap,
                  suggestionsPlacement === 'top' ? styles.suggestionsTop : styles.suggestionsBottom,
                ]}
              >
                {visibleSuggestions.map((item) => (
                  <Pressable
                    key={String(item.id || item.value)}
                    style={styles.suggestionItem}
                    onPress={() => {
                      clearBlurTimer();
                      addTag(item.value, { fromSuggestion: true });
                      inputRef.current?.focus?.();
                    }}
                  >
                    <Text style={styles.suggestionText}>{item.value}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {!disabled && canTypeMore ? (
              <TextField
                {...commonInputProps}
                hideSeparator
                style={styles.inlineTextField}
              />
            ) : null}
          </View>

          {normalizedTags.length ? (
            <View style={styles.tagsWrap}>
              {normalizedTags.map((value, index) => (
                <TagCapsule
                  key={`${value}-${index}`}
                  label={value}
                  onRemove={disabled || !allowRemove ? undefined : () => removeTagByIndex(index)}
                  compact
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.inputArea}>
          {focused && visibleSuggestions.length > 0 ? (
            <View
              style={[
                styles.suggestionsWrap,
                suggestionsPlacement === 'top' ? styles.suggestionsTop : styles.suggestionsBottom,
              ]}
            >
              {visibleSuggestions.map((item) => (
                <Pressable
                  key={String(item.id || item.value)}
                  style={styles.suggestionItem}
                  onPress={() => {
                    clearBlurTimer();
                    addTag(item.value, { fromSuggestion: true });
                    inputRef.current?.focus?.();
                  }}
                >
                  <Text style={styles.suggestionText}>{item.value}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <TextField
            {...commonInputProps}
            label={showLabel ? resolvedLabel : undefined}
            hideSeparator={hideSeparator}
          />
        </View>
      )}

      {!hideSeparator && showInlineTags ? <View style={styles.separator} /> : null}
    </View>
  );
}

function createStyles(theme) {
  const insetKey = theme.components?.input?.separator?.insetX ?? 'md';
  const inset = Number(theme.spacing?.[insetKey] ?? theme.spacing.md);

  return StyleSheet.create({
    labelRow: {
      paddingHorizontal: inset,
      marginBottom: theme.components?.input?.labelSpacing ?? theme.spacing.xs,
    },
    label: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight?.medium ?? '500',
    },
    rowWrap: {
      minHeight: theme.components?.input?.height ?? 44,
      paddingHorizontal: inset,
      paddingTop: theme.spacing.xs,
      paddingBottom: theme.spacing.xs,
      gap: theme.spacing.xs,
    },
    inputAnchor: {
      position: 'relative',
    },
    tagsWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.xs,
    },
    inlineTextField: {
      marginVertical: 0,
    },
    addBtn: {
      minWidth: 28,
      minHeight: 28,
      borderRadius: theme.radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
      marginTop: 2,
    },
    suggestionsWrap: {
      position: 'absolute',
      left: inset,
      right: inset,
      borderRadius: theme.radii.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      overflow: 'hidden',
      zIndex: 20,
      elevation: 6,
    },
    suggestionsTop: {
      bottom: '100%',
      marginBottom: theme.spacing.xs,
    },
    suggestionsBottom: {
      top: '100%',
      marginTop: theme.spacing.xs,
    },
    inputArea: {
      position: 'relative',
    },
    suggestionItem: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    suggestionText: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weight.medium,
    },
    separator: {
      height: theme.components?.input?.separator?.height ?? 1,
      marginHorizontal: inset,
      backgroundColor: theme.colors.border,
    },
  });
}
