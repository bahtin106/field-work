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
  const removeSeparators = (nodes) => {
    const out = [];
    React.Children.forEach(nodes, (n) => {
      if (!n) return;
      if (Array.isArray(n)) {
        out.push(...removeSeparators(n));
        return;
      }
      if (React.isValidElement(n)) {
        if (n.type === ListSeparator) return; // drop
        if (n.props && n.props.children) {
          const childNodes = removeSeparators(n.props.children);
          out.push(React.cloneElement(n, { ...n.props, children: childNodes }));
          return;
        }
      }
      out.push(n);
    });
    return out;
  };

  const filtered = labelCount === 1 ? removeSeparators(arr) : arr;

  return (
    <CardContext.Provider value={{ labelCount }}>
      <View style={[s.card, padded ? s.padded : null, paddedXOnly ? s.paddedX : null, style]}>
        {filtered}
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
