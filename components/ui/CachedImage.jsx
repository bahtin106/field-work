// components/ui/CachedImage.jsx
// Shared image renderer with disk+memory caching, stable placeholders, and a compact error state.

import { useState, useCallback, useMemo, useEffect } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
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
  fallbackUri,
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
  const [activeUri, setActiveUri] = useState(uri || '');
  const [isLoading, setIsLoading] = useState(!!uri);

  // Reset error state when URI changes so images retry loading
  useEffect(() => {
    setActiveUri(uri || '');
    setHasError(false);
    setIsLoading(!!uri);
  }, [fallbackUri, uri]);

  const handleError = useCallback(
    (e) => {
      const fallback = String(fallbackUri || '').trim();
      if (fallback && fallback !== activeUri) {
        setActiveUri(fallback);
        setHasError(false);
        setIsLoading(true);
        return;
      }
      setHasError(true);
      onError?.(e);
    },
    [activeUri, fallbackUri, onError],
  );

  const handleLoad = useCallback(
    (e) => {
      setHasError(false);
      setIsLoading(false);
      onLoad?.(e);
    },
    [onLoad],
  );

  const handleLoadEnd = useCallback(() => {
    setIsLoading(false);
  }, []);

  const sizeStyle = useMemo(
    () => ({
      ...(width != null ? { width } : {}),
      ...(height != null ? { height } : {}),
    }),
    [width, height],
  );

  const sourceUri = activeUri || uri || '';

  if (!sourceUri || hasError) {
    return (
      <View
        style={[
          styles.fallback,
          sizeStyle,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
          style,
        ]}
      >
        <Feather name="image" size={24} color={theme.colors.textSecondary} />
      </View>
    );
  }

  return (
    <View style={[sizeStyle, style, styles.imageFrame]}>
      <Image
        source={{ uri: sourceUri }}
        style={StyleSheet.absoluteFill}
        contentFit={contentFit}
        cachePolicy={cachePolicy}
        recyclingKey={recyclingKey != null ? String(recyclingKey) : sourceUri}
        transition={transition}
        placeholder={placeholder ? { blurhash: placeholder } : undefined}
        placeholderContentFit={contentFit}
        enforceEarlyResizing
        onLoad={handleLoad}
        onLoadEnd={handleLoadEnd}
        onError={handleError}
        accessibilityLabel={accessibilityLabel}
        {...rest}
      />
      {isLoading ? (
        <View pointerEvents="none" style={styles.loadingOverlay}>
          <ActivityIndicator size="small" color={theme.colors.textSecondary} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  imageFrame: {
    overflow: 'hidden',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 12,
  },
});
