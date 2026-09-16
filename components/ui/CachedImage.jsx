// components/ui/CachedImage.jsx
// Shared image renderer with disk+memory caching, stable placeholders, and a compact error state.

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import Feather from '@expo/vector-icons/Feather';
import { useTheme } from '../../theme';
import { getCachedSupabaseAccessToken } from '../../lib/supabaseSessionCache';
import { isProtectedMediaThumbnailUrl } from '../../src/shared/media/thumbnailUrl';

const BLURHASH_PLACEHOLDER = 'L6PZfSi_.AyE_3t7t7R**0o#DgR4';
const MAX_IMAGE_RETRY_ATTEMPTS = 2;
const IMAGE_LOAD_TIMEOUT_MS = 15_000;

/**
 * @param {object} props
 * @param {string} props.uri              – image URL (remote or local)
 * @param {string} [props.fallbackUri]    – first alternate source
 * @param {string[]} [props.fallbackUris] – remaining sources, tried once in order
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
 * @param {object} [props.headers]         - explicit headers for the image origin
 * @param {string} [props.cacheKey]        - stable native cache identity
 */
export default function CachedImage({
  uri,
  fallbackUri,
  fallbackUris,
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
  headers,
  cacheKey,
  ...rest
}) {
  const { theme } = useTheme();
  const [hasError, setHasError] = useState(false);
  const [activeUri, setActiveUri] = useState(uri || '');
  const [isLoading, setIsLoading] = useState(!!uri);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [protectedAuth, setProtectedAuth] = useState(null);
  const retryTimerRef = useRef(null);
  const loadTimeoutRef = useRef(null);
  const loadedUriRef = useRef('');
  const failedSourcesRef = useRef(new Set());
  // Compare values, not the caller's array identity: background renders must
  // not restart the loading watchdog or retry an already rejected source.
  const fallbackKey = JSON.stringify(
    [...new Set([fallbackUri, ...(Array.isArray(fallbackUris) ? fallbackUris : [])]
      .map((value) => String(value || '').trim()).filter(Boolean))],
  );
  const nextFallback = useCallback((current) => JSON.parse(fallbackKey)
    .find((candidate) => candidate !== current && !failedSourcesRef.current.has(candidate)), [fallbackKey]);

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
    failedSourcesRef.current.clear();
  }, [uri]);

  useEffect(
    () => () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    },
    [],
  );

  useEffect(() => {
    const fallback = nextFallback(activeUri);
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
  }, [activeUri, nextFallback, hasError]);

  const handleError = useCallback(
    (e) => {
      failedSourcesRef.current.add(activeUri);
      const fallback = nextFallback(activeUri);
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
    [activeUri, nextFallback, onError, retryAttempt],
  );

  const handleLoad = useCallback(
    (e) => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
      loadedUriRef.current = activeUri || uri || '';
      setHasError(false);
      setIsLoading(false);
      // retryAttempt is part of the native view key. Resetting it here destroys
      // the successfully decoded image and starts the original request again.
      onLoad?.(e);
    },
    [activeUri, onLoad, uri],
  );

  const handleLoadEnd = useCallback(() => {
    setIsLoading(false);
  }, []);

  const sourceUri = activeUri || uri || '';
  // media-thumbnail is JWT-protected. profile-media-storage render URLs are
  // already authenticated by their exp/sig query pair and must stay usable
  // while the Supabase session cache is warming up.
  const requiresProtectedAuth = isProtectedMediaThumbnailUrl(sourceUri);
  const authRequestKey = `${sourceUri}:${retryAttempt}`;
  const protectedAuthReady = protectedAuth?.key === authRequestKey;
  const protectedAccessToken = protectedAuthReady ? protectedAuth.token : '';

  useEffect(() => {
    let cancelled = false;
    let authTimeout;
    if (!requiresProtectedAuth) {
      return () => {
        cancelled = true;
      };
    }

    authTimeout = setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      setProtectedAuth({ key: authRequestKey, token: '' });
    }, IMAGE_LOAD_TIMEOUT_MS);
    getCachedSupabaseAccessToken()
      .then((accessToken) => {
        if (cancelled) return;
        clearTimeout(authTimeout);
        setProtectedAuth({ key: authRequestKey, token: String(accessToken || '').trim() });
      })
      .catch(() => {
        if (cancelled) return;
        clearTimeout(authTimeout);
        setProtectedAuth({ key: authRequestKey, token: '' });
      });
    return () => {
      cancelled = true;
      clearTimeout(authTimeout);
    };
  }, [authRequestKey, requiresProtectedAuth]);

  useEffect(() => {
    if (!requiresProtectedAuth || !protectedAuthReady || protectedAccessToken || hasError) return;
    handleError(new Error('Image session is unavailable'));
  }, [handleError, hasError, protectedAccessToken, protectedAuthReady, requiresProtectedAuth]);

  const canLoadSource = !requiresProtectedAuth || (protectedAuthReady && Boolean(protectedAccessToken));

  const restartLoadTimeout = useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    if (
      !sourceUri ||
      !canLoadSource ||
      hasError ||
      loadedUriRef.current === sourceUri ||
      !Number.isFinite(loadTimeoutMs) ||
      loadTimeoutMs <= 0
    ) return;
    loadTimeoutRef.current = setTimeout(() => {
      loadTimeoutRef.current = null;
      handleError(new Error('Image load timed out'));
    }, loadTimeoutMs);
  }, [canLoadSource, handleError, hasError, loadTimeoutMs, sourceUri]);

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

  const imageSource = useMemo(() => {
    const sourceHeaders = {
      ...(headers && typeof headers === 'object' ? headers : {}),
      ...(requiresProtectedAuth && protectedAccessToken
        ? { Authorization: `Bearer ${protectedAccessToken}` }
        : {}),
    };
    return {
      uri: sourceUri,
      ...(!requiresProtectedAuth && cacheKey ? { cacheKey } : {}),
      ...(Object.keys(sourceHeaders).length ? { headers: sourceHeaders } : {}),
    };
  }, [cacheKey, headers, protectedAccessToken, requiresProtectedAuth, sourceUri]);
  // The native cache key does not vary by Authorization. Avoid caching a
  // protected response under a URL-only key; full display URLs remain cached.
  const effectiveCachePolicy = requiresProtectedAuth ? 'none' : cachePolicy;
  const sizeStyle = useMemo(
    () => ({
      ...(width != null ? { width } : {}),
      ...(height != null ? { height } : {}),
    }),
    [width, height],
  );
  const shouldLoadImage = Boolean(sourceUri) && canLoadSource && !hasError;

  // Keep the native Image mounted while its JWT is being resolved. Swapping a
  // Feather-only view for a late-mounted ExpoImage in an Android modal can emit
  // onLoad/onDisplay with valid dimensions yet leave the tile blank (Fabric).
  // A stable native view receives its authenticated source as a normal update.
  return (
    <View style={[sizeStyle, style, styles.imageFrame]}>
      <Image
        key={`${sourceUri}:${retryAttempt}`}
        source={shouldLoadImage ? imageSource : null}
        style={StyleSheet.absoluteFill}
        contentFit={contentFit}
        cachePolicy={retryAttempt > 0 ? 'none' : effectiveCachePolicy}
        recyclingKey={recyclingKey != null ? `${String(recyclingKey)}:${retryAttempt}` : `${sourceUri}:${retryAttempt}`}
        transition={transition}
        placeholder={placeholder && shouldLoadImage ? { blurhash: placeholder } : undefined}
        placeholderContentFit={contentFit}
        enforceEarlyResizing
        onLoad={shouldLoadImage ? handleLoad : undefined}
        onLoadEnd={shouldLoadImage ? handleLoadEnd : undefined}
        onError={shouldLoadImage ? handleError : undefined}
        onProgress={handleProgress}
        accessibilityLabel={accessibilityLabel}
        {...rest}
      />
      {!sourceUri || hasError ? (
        <View style={[StyleSheet.absoluteFill, styles.fallback, {
          backgroundColor: theme.colors.surface, borderColor: theme.colors.border,
        }]}>
          <Feather name="image" size={24} color={theme.colors.textSecondary} />
        </View>
      ) : null}
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
