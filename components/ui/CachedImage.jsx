// components/ui/CachedImage.jsx
// High-performance image component with disk+memory caching, shimmer placeholder, and error state.
// Built on expo-image for native-level caching (like Instagram / Telegram).

import { useState, useCallback, useMemo, useEffect } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '../../theme';

const BLURHASH_PLACEHOLDER = 'L6PZfSi_.AyE_3t7t7R**0o#DgR4';

/**
 * @param {object} props
 * @param {string} props.uri              – image URL (remote or local)
 * @param {number} [props.width]          – explicit width (or use style)
 * @param {number} [props.height]         – explicit height (or use style)
 * @param {object} [props.style]          – additional style
 * @param {'cover'|'contain'|'fill'} [props.contentFit] – resize mode
 * @param {'memory-disk'|'memory'|'disk'|'none'} [props.cachePolicy] – cache strategy
 * @param {number} [props.recyclingKey]   – forces reload if changed
 * @param {number} [props.transition]     – crossfade duration ms
 * @param {() => void} [props.onLoad]     – called when image loaded
 * @param {() => void} [props.onError]    – called on load error
 * @param {string} [props.placeholder]    – blurhash or thumbhash placeholder
 * @param {string} [props.accessibilityLabel]
 */
export default function CachedImage({
  uri,
  width,
  height,
  style,
  contentFit = 'cover',
  cachePolicy = 'memory-disk',
  recyclingKey,
  transition = 200,
  onLoad,
  onError,
  placeholder = BLURHASH_PLACEHOLDER,
  accessibilityLabel,
  ...rest
}) {
  const { theme } = useTheme();
  const [hasError, setHasError] = useState(false);

  // Reset error state when URI changes so images retry loading
  useEffect(() => { setHasError(false); }, [uri]);

  const handleError = useCallback(
    (e) => {
      setHasError(true);
      onError?.(e);
    },
    [onError],
  );

  const handleLoad = useCallback(
    (e) => {
      setHasError(false);
      onLoad?.(e);
    },
    [onLoad],
  );

  const sizeStyle = useMemo(
    () => ({
      ...(width != null ? { width } : {}),
      ...(height != null ? { height } : {}),
    }),
    [width, height],
  );

  if (!uri || hasError) {
    return (
      <View
        style={[
          styles.fallback,
          sizeStyle,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
          style,
        ]}
      >
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: Math.min((width || 80) * 0.32, 24),
            lineHeight: Math.min((width || 80) * 0.32, 24),
          }}
        >
          □
        </Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={[sizeStyle, style]}
      contentFit={contentFit}
      cachePolicy={cachePolicy}
      recyclingKey={recyclingKey != null ? String(recyclingKey) : undefined}
      transition={transition}
      placeholder={placeholder ? { blurhash: placeholder } : undefined}
      placeholderContentFit="cover"
      onLoad={handleLoad}
      onError={handleError}
      accessibilityLabel={accessibilityLabel}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 12,
  },
});
