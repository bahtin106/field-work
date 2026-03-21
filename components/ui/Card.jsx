// components/ui/Card.jsx
import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { useTheme } from '../../theme';
import LabelValueRow from './LabelValueRow';
import ListSeparator from './ListSeparator';
import CardContext from './CardContext';

export default function Card({ children, style, padded = true, paddedXOnly = false }) {
  const { theme } = useTheme();
  const s = styles(theme);

  // Normalize children so we can apply small UX rules locally:
  // If a card contains exactly one LabelValueRow (even nested inside fragments),
  // remove inline ListSeparator children so a single row doesn't show a divider.
  const arr = React.Children.toArray(children || []);

  const countLabelRows = (nodes) => {
    let count = 0;
    React.Children.forEach(nodes, (n) => {
      if (!n) return;
      if (Array.isArray(n)) {
        count += countLabelRows(n);
        return;
      }
      if (React.isValidElement(n)) {
        if (n.type === LabelValueRow) {
          // Determine if this LabelValueRow would actually render (not hidden).
          const { hideWhenEmpty = true, value, valueComponent } = n.props || {};
          if (valueComponent !== null && valueComponent !== undefined && valueComponent !== false) {
            count += 1;
            return;
          }
          // normalize display value similar to LabelValueRow.isEmptyDisplayValue
          const normalizeDisplayValue = (v) => {
            if (v === null || v === undefined) return '';
            if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
            if (typeof v === 'boolean') return v ? 'true' : 'false';
            return String(v);
          };
          const EMPTY_PLACEHOLDER_VALUES = new Set(['-', '–', '—']);
          const norm = normalizeDisplayValue(value).trim();
          const isEmpty = !norm || EMPTY_PLACEHOLDER_VALUES.has(norm);
          if (!(hideWhenEmpty && isEmpty)) count += 1;
          return;
        }
        // fragments or other wrappers — inspect children
        if (n.props && n.props.children) {
          count += countLabelRows(n.props.children);
          return;
        }
      }
    });
    return count;
  };

  const labelCount = countLabelRows(arr);
  const looksLikeThinSeparatorView = (node) => {
    if (!React.isValidElement(node)) return false;
    if (node.type !== View) return false;
    if (node.props?.children !== undefined && node.props?.children !== null && node.props?.children !== false) {
      return false;
    }
    const flattened = StyleSheet.flatten(node.props?.style);
    if (!flattened || typeof flattened !== 'object') return false;
    const height = Number(flattened.height);
    if (!Number.isFinite(height) || height <= 0 || height > 2) return false;
    return typeof flattened.backgroundColor === 'string' && flattened.backgroundColor.length > 0;
  };

  const isSeparatorLikeNode = (node) => {
    if (!React.isValidElement(node)) return false;
    if (node.type === ListSeparator) return true;
    return looksLikeThinSeparatorView(node);
  };

  const collapseAdjacentSeparators = (nodes) => {
    const out = [];
    let prevWasSeparator = false;

    React.Children.forEach(nodes, (n) => {
      if (n === null || n === undefined || n === false) return;

      const currentIsSeparator = isSeparatorLikeNode(n);
      if (prevWasSeparator && currentIsSeparator) return;
      out.push(n);
      prevWasSeparator = currentIsSeparator;
    });

    return out;
  };

  const withSingleSeparators = React.Children.toArray(collapseAdjacentSeparators(arr));
  const filtered =
    labelCount === 1
      ? withSingleSeparators.filter((node) => !(React.isValidElement(node) && node.type === ListSeparator))
      : withSingleSeparators;
  const normalizedChildren = React.Children.toArray(filtered);

  return (
    <CardContext.Provider value={{ labelCount }}>
      <View style={[s.card, padded ? s.padded : null, paddedXOnly ? s.paddedX : null, style]}>
        {normalizedChildren}
      </View>
    </CardContext.Provider>
  );
}

const styles = (t) =>
  StyleSheet.create({
    card: {
      backgroundColor: t.colors.surface,
      borderRadius: t.radii.xl,
      borderWidth: t.components?.card?.borderWidth ?? 1,
      borderColor: t.colors.border,
      ...(Platform.OS === 'ios' ? t.shadows.card.ios : t.shadows.card.android),
    },
    padded: {
      paddingHorizontal: t.spacing[t.components?.card?.padX ?? 'lg'],
      paddingVertical: t.spacing[t.components?.card?.padY ?? 'lg'],
    },
    paddedX: {
      paddingHorizontal: t.spacing[t.components?.card?.padX ?? 'lg'],
      paddingVertical: 0,
    },
  });
