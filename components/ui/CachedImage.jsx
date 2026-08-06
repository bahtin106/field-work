// components/ui/CachedImage.jsx
// Shared image renderer with disk+memory caching, stable placeholders, and a compact error state.

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import Feather from '@expo/vector-icons/Feather';
import { useTheme } from '../../theme';

const BLURHASH_PLACEHOLDER = 'L6PZfSi_.AyE_3t7t7R**0o#DgR4';
const MAX_IMAGE_RETRY_ATTEMPTS = 2;
const IMAGE_LOAD_TIMEOUT_MS = 15_000;

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
  onProgress,
  placeholder = BLURHASH_PLACEHOLDER,
  showLoadingIndicator = false,
  loadTimeoutMs = IMAGE_LOAD_TIMEOUT_MS,
  accessibilityLabel,
  ...rest
}) {
  const { theme } = useTheme();
  const [hasError, setHasError] = useState(false);
  const [activeUri, setActiveUri] = useState(uri || '');
  const [isLoading, setIsLoading] = useState(!!uri);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const retryTimerRef = useRef(null);
  const loadTimeoutRef = useRef(null);
  const loadedUriRef = useRef('');

  // Reset only when the visible URI changes. Fallback churn should not reload
  // an already rendered image during background media refreshes.
  useEffect(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    setActiveUri(uri || '');
    setHasError(false);
    setIsLoading(!!uri);
    setRetryAttempt(0);
    loadedUriRef.current = '';
  }, [uri]);

  useEffect(
    () => () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    },
    [],
  );

  useEffect(() => {
    const fallback = String(fallbackUri || '').trim();
    if (!hasError || !fallback || fallback === activeUri) return;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    setActiveUri(fallback);
    setHasError(false);
    setIsLoading(true);
    setRetryAttempt(0);
    loadedUriRef.current = '';
  }, [activeUri, fallbackUri, hasError]);

  const handleError = useCallback(
    (e) => {
      const fallback = String(fallbackUri || '').trim();
      if (fallback && fallback !== activeUri) {
        if (loadTimeoutRef.current) {
          clearTimeout(loadTimeoutRef.current);
          loadTimeoutRef.current = null;
        }
        if (retryTimerRef.current) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
        setActiveUri(fallback);
        setHasError(false);
        setIsLoading(true);
        setRetryAttempt(0);
        loadedUriRef.current = '';
        return;
      }
      if (/^https?:\/\//i.test(String(activeUri || '')) && retryAttempt < MAX_IMAGE_RETRY_ATTEMPTS) {
        if (loadTimeoutRef.current) {
          clearTimeout(loadTimeoutRef.current);
          loadTimeoutRef.current = null;
        }
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        const nextAttempt = retryAttempt + 1;
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          setHasError(false);
          setIsLoading(true);
          setRetryAttempt(nextAttempt);
        }, 350 * nextAttempt);
        return;
      }
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
      setIsLoading(false);
      setHasError(true);
      onError?.(e);
    },
    [activeUri, fallbackUri, onError, retryAttempt],
  );

  const handleLoad = useCallback(
    (e) => {
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
      loadedUriRef.current = activeUri || uri || '';
      setHasError(false);
      setIsLoading(false);
      setRetryAttempt(0);
      onLoad?.(e);
    },
    [activeUri, onLoad, uri],
  );

  const handleLoadEnd = useCallback(() => {
    setIsLoading(false);
  }, []);

  const sourceUri = activeUri || uri || '';

  const restartLoadTimeout = useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    if (
      !sourceUri ||
      hasError ||
      loadedUriRef.current === sourceUri ||
      !Number.isFinite(loadTimeoutMs) ||
      loadTimeoutMs <= 0
    ) return;
    loadTimeoutRef.current = setTimeout(() => {
      loadTimeoutRef.current = null;
      handleError(new Error('Image load timed out'));
    }, loadTimeoutMs);
  }, [handleError, hasError, loadTimeoutMs, sourceUri]);

  const handleProgress = useCallback(
    (event) => {
      restartLoadTimeout();
      onProgress?.(event);
    },
    [onProgress, restartLoadTimeout],
  );

  useEffect(() => {
    restartLoadTimeout();
    return () => {
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
    };
  }, [restartLoadTimeout, retryAttempt]);

  const imageSource = useMemo(() => ({ uri: sourceUri }), [sourceUri]);
  const sizeStyle = useMemo(
    () => ({
      ...(width != null ? { width } : {}),
      ...(height != null ? { height } : {}),
    }),
    [width, height],
  );

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
        key={`${sourceUri}:${retryAttempt}`}
        source={imageSource}
        style={StyleSheet.absoluteFill}
        contentFit={contentFit}
        cachePolicy={retryAttempt > 0 ? 'none' : cachePolicy}
        recyclingKey={recyclingKey != null ? `${String(recyclingKey)}:${retryAttempt}` : `${sourceUri}:${retryAttempt}`}
        transition={transition}
        placeholder={placeholder ? { blurhash: placeholder } : undefined}
        placeholderContentFit={contentFit}
        enforceEarlyResizing
        onLoad={handleLoad}
        onLoadEnd={handleLoadEnd}
        onError={handleError}
        onProgress={handleProgress}
        accessibilityLabel={accessibilityLabel}
        {...rest}
      />
      {showLoadingIndicator && isLoading ? (
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
