import React from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import CachedImage from '../ui/CachedImage';

import { useTheme } from '../../theme';

const MAX_PREVIEW_SIZE = 640;
const PREVIEW_HEIGHT_RATIO = 0.62;

export default function ModalImagePreview({
  uri,
  fallbackUri,
  emptyLabel,
  accessibilityLabel,
  contentFit = 'contain',
  cachePolicy,
}) {
  const { theme } = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const sourceUri = String(uri || '').trim();
  const safeFallbackUri = String(fallbackUri || '').trim();
  const displayUri = sourceUri || safeFallbackUri;
  const [failed, setFailed] = React.useState(false);
  const previewSize = React.useMemo(() => {
    const modalOuterPadding = Number(theme.spacing?.lg ?? 16) * 2;
    const contentPadding = Number(theme.spacing?.md ?? 12) * 2;
    const availableWidth = Math.max(1, windowWidth - modalOuterPadding - contentPadding);
    const availableHeight = Math.max(1, windowHeight * PREVIEW_HEIGHT_RATIO);
    return Math.max(1, Math.min(MAX_PREVIEW_SIZE, availableWidth, availableHeight));
  }, [theme.spacing?.lg, theme.spacing?.md, windowHeight, windowWidth]);

  React.useEffect(() => {
    setFailed(false);
  }, [sourceUri, safeFallbackUri]);

  const handleError = React.useCallback(() => {
    setFailed(true);
  }, []);

  const handleReady = React.useCallback(() => {
    setFailed(false);
  }, []);

  const isRemote = /^https?:\/\//i.test(displayUri);

  return (
    <View style={[styles.wrap, { minHeight: previewSize, padding: theme.spacing.md }]}>
      <View style={{ width: previewSize, height: previewSize }}>
        <CachedImage
          uri={displayUri}
          fallbackUri={safeFallbackUri}
          width={previewSize}
          height={previewSize}
          style={{ borderRadius: theme.radii.lg }}
          contentFit={contentFit}
          cachePolicy={cachePolicy || (isRemote ? 'memory-disk' : 'none')}
          priority="high"
          recyclingKey={`${displayUri}:modal-preview`}
          placeholder={null}
          showLoadingIndicator
          accessibilityLabel={accessibilityLabel}
          transition={0}
          onLoad={handleReady}
          onError={handleError}
        />
        {!displayUri || failed ? (
          <View pointerEvents="none" style={[styles.emptyOverlay, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.empty, { color: theme.colors.textSecondary }]}>{emptyLabel}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    textAlign: 'center',
  },
  emptyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
