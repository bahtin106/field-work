// components/ui/modals/Wheel.jsx
import React, { useMemo, useRef, useState, useEffect } from "react";
import { View, Text, FlatList, Platform } from "react-native";
import { useTheme } from "../../../theme";

export const ITEM_HEIGHT_DP = 44;
export const VISIBLE_COUNT_DP = 5;

export default function Wheel({ data, index, onIndexChange, width, enabled = true, activeColor, inactiveColor }) {
  const { theme } = useTheme();
  const _activeColor = activeColor || theme.colors.primary;
  const listRef = useRef(null);
  const isSyncingRef = useRef(false);
  const [selIndex, setSelIndex] = useState(index ?? 0);

  useEffect(() => {
    const next = Math.max(0, Math.min(data.length - 1, index ?? 0));
    if (next !== selIndex) {
      setSelIndex(next);
      isSyncingRef.current = true;
      listRef.current?.scrollToOffset({ offset: next * ITEM_HEIGHT_DP, animated: false });
      setTimeout(() => { isSyncingRef.current = false; }, 0);
    }
  }, [index, data.length]);

  useEffect(() => {
    if (selIndex > data.length - 1) {
      const next = data.length - 1;
      setSelIndex(next);
      isSyncingRef.current = true;
      listRef.current?.scrollToOffset({ offset: next * ITEM_HEIGHT_DP, animated: false });
      setTimeout(() => { isSyncingRef.current = false; }, 0);
      onIndexChange?.(next);
    }
  }, [data.length]);

  const snapOffsets = useMemo(() => data.map((_, i) => i * ITEM_HEIGHT_DP), [data]);

  const syncToNearest = (y) => {
    const i = Math.round(y / ITEM_HEIGHT_DP);
    const clamped = Math.max(0, Math.min(data.length - 1, i));
    const target = clamped * ITEM_HEIGHT_DP;
    if (!isSyncingRef.current && Math.abs(target - y) > 0.5) {
      isSyncingRef.current = true;
      listRef.current?.scrollToOffset({ offset: target, animated: false });
      setTimeout(() => { isSyncingRef.current = false; }, 0);
    }
    if (clamped !== selIndex) {
      setSelIndex(clamped);
      onIndexChange?.(clamped);
    }
  };

  const onMomentumEnd = (e) => {
    const y = e.nativeEvent.contentOffset.y;
    syncToNearest(y);
  };

  // NEW: also sync selection when user lifts the finger, even if momentum hasn't started yet.
  const onDragEnd = (e) => {
    const y = e.nativeEvent.contentOffset?.y ?? 0;
    syncToNearest(y);
  };

  return (
    <FlatList
      ref={listRef}
      data={data}
      keyExtractor={(_, i) => String(i)}
      renderItem={({ item, index: i }) => (
        <View style={[{ height: ITEM_HEIGHT_DP, justifyContent: 'center', alignItems: 'center' }, !enabled && { opacity: 0.35 }]}> 
          <Text
            style={[{ fontSize: 18, color: inactiveColor || theme.colors.textSecondary }, i === selIndex && { fontSize: 20, fontWeight: '700', color: _activeColor }]}
          >
            {item}
          </Text>
        </View>
      )}
      showsVerticalScrollIndicator={false}
      getItemLayout={(_, i) => ({ length: ITEM_HEIGHT_DP, offset: ITEM_HEIGHT_DP * i, index: i })}
      snapToOffsets={snapOffsets}
      snapToAlignment="center"
      decelerationRate={Platform.OS === 'ios' ? 0.995 : 0.985}
      bounces={false}
      overScrollMode="never"
      onMomentumScrollEnd={onMomentumEnd}
      onScrollEndDrag={onDragEnd}
      initialNumToRender={VISIBLE_COUNT_DP + 2}
      scrollEventThrottle={16}
      style={{ width }}
      contentContainerStyle={{ paddingVertical: (ITEM_HEIGHT_DP * (VISIBLE_COUNT_DP - 1)) / 2 }}
      scrollEnabled={enabled}
      initialScrollIndex={Math.max(0, Math.min(data.length - 1, selIndex))}
      onScrollToIndexFailed={(info) => {
        const offset = Math.min(
          info.highestMeasuredFrameIndex * ITEM_HEIGHT_DP,
          info.averageItemLength * info.index,
        );
        listRef.current?.scrollToOffset({ offset, animated: false });
        setTimeout(() =>
          listRef.current?.scrollToIndex({
            index: info.index,
            animated: false,
            viewPosition: 0.5,
          }),
          0,
        );
      }}
    />
  );
}
