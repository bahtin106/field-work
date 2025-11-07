// components/filters/FiltersPanel.jsx
// Full-screen page-like filters without RN Modal. No remount on selection → no flicker.
// Stays mounted; visibility is controlled by Animated slide. Matches "отдельная страница" UX.

import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Animated,
  Easing,
  Dimensions,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import Button from '../ui/Button';
import { t } from '../../src/i18n';
import { useTranslation } from '../../src/i18n/useTranslation';

const { width: SCREEN_W } = Dimensions.get('window');

function withAlpha(color, a) {
  if (typeof color === 'string') {
    const hex = color.match(/^#([0-9a-fA-F]{6})$/);
    if (hex) {
      const alpha = Math.round(Math.max(0, Math.min(1, a)) * 255)
        .toString(16)
        .padStart(2, '0');
      return color + alpha;
    }
    const rgb = color.match(/^rgb\\s*\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*\\)$/i);
    if (rgb) return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${a})`;
  }
  return `rgba(0,0,0,${a})`;
}

/**
 * Props:
 *  - visible, onClose
 *  - departments, rolesOptions
 *  - values, setValue, defaults
 *  - onReset, onApply
 */
export default function FiltersPanel({
  visible,
  onClose,
  departments = [],
  rolesOptions = [],
  values = {},
  setValue,
  defaults = {},
  onReset,
  onApply,
}) {
  const { theme } = useTheme();
  useTranslation();

  const c = theme.colors;
  const sz = theme.spacing;
  const ty = theme.typography;
  const rad = theme.radii;

  // --- Draft state: accumulate edits locally; apply on button press ---
  const [draft, setDraft] = useState({
    departments: Array.isArray(values.departments) ? values.departments.map(String) : [],
    roles: Array.isArray(values.roles) ? values.roles : [],
    suspended: values.suspended ?? null,
  });
  // Baseline snapshot: values at the moment panel becomes visible
  const [baseline, setBaseline] = useState({
    departments: Array.isArray(values.departments) ? values.departments.map(String) : [],
    roles: Array.isArray(values.roles) ? values.roles : [],
    suspended: values.suspended ?? null,
  });


  // Re-init draft and baseline every time panel opens
  useEffect(() => {
    if (visible) {
      const snap = {
        departments: Array.isArray(values.departments) ? values.departments.map(String) : [],
        roles: Array.isArray(values.roles) ? values.roles : [],
        suspended: values.suspended ?? null,
      };
      setDraft(snap);
      setBaseline(snap);
    }
  }, [visible]);

  // Animation (slide from right like a page). Kept mounted.
  const tx = useRef(new Animated.Value(visible ? 0 : SCREEN_W)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(tx, {
        toValue: 0,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(tx, {
        toValue: SCREEN_W,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, tx]);

  // Categories composition
  const categories = useMemo(() => {
    const cats = [];
    if (departments && departments.length > 0) {
      cats.push({ key: 'departments', label: t('users_department', 'Отдел') });
    }
    cats.push({ key: 'roles', label: t('users_role', 'Роль') });
    cats.push({ key: 'suspended', label: t('users_suspended', 'Состояние') });
    return cats;
  }, [departments, t]);

  const [activeCat, setActiveCat] = useState(() => (categories[0] ? categories[0].key : null));
  useEffect(() => {
    if (!categories.find((c) => c.key === activeCat) && categories.length > 0) {
      setActiveCat(categories[0].key);
    }
  }, [categories, activeCat]);

  // Shallow set compares
  const eqArrays = (a = [], b = []) => {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    const A = [...a].map(String).sort();
    const B = [...b].map(String).sort();
    for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) return false;
    return true;
  };

  const hasChanges = useMemo(() => {
    if (!eqArrays(draft.departments || [], baseline.departments || [])) return true;
    if (!eqArrays(draft.roles || [], baseline.roles || [])) return true;
    if ((draft.suspended ?? null) !== (baseline.suspended ?? null)) return true;
    return false;
  }, [draft, baseline]);

  const toggleDepartment = (id) => {
    const current = Array.isArray(draft.departments) ? draft.departments : [];
    const strId = String(id);
    const next = current.includes(strId) ? current.filter((x) => x !== strId) : [...current, strId];
    setDraft((d) => ({ ...d, departments: next }));
  };

  const toggleRole = (val) => {
    const current = Array.isArray(draft.roles) ? draft.roles : [];
    const next = current.includes(val) ? current.filter((x) => x !== val) : [...current, val];
    setDraft((d) => ({ ...d, roles: next }));
  };

  const selectSuspended = (val) => setDraft((d) => ({ ...d, suspended: val }));

  const styles = useMemo(() => {
    const leftWidth = sz.lg * 8;
    return StyleSheet.create({
      overlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 1000,
        elevation: 1000,
      },
      backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: withAlpha(c.scrim ?? '#000', 0.28),
      },
      page: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: SCREEN_W,
        backgroundColor: c.background,
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 8,
        shadowOffset: { width: -2, height: 0 },
        elevation: 6,
      },
      header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: sz.sm,
        paddingHorizontal: sz.md,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: c.border,
        backgroundColor: c.surface,
      },
      headerTitle: {
        flex: 1,
        textAlign: 'left',
        fontSize: ty.sizes.lg,
        color: c.text,
        fontWeight: ty.weight.bold,
        marginLeft: sz.sm,
      },
      content: { flexDirection: 'row', flex: 1 },
      categories: {
        width: leftWidth,
        borderRightWidth: StyleSheet.hairlineWidth,
        borderRightColor: c.border,
        backgroundColor: c.surface,
      },
      categoryItem: {
        paddingVertical: sz.sm,
        paddingHorizontal: sz.md,
        flexDirection: 'row',
        alignItems: 'center',
      },
      categoryLabel: { fontSize: ty.sizes.md, color: c.textSecondary },
      categoryItemActive: { backgroundColor: c.inputBg },
      categoryLabelActive: { color: c.text, fontWeight: ty.weight.semibold },
      options: { flex: 1, backgroundColor: c.inputBg },
      applyBar: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: c.border,
        paddingHorizontal: sz.lg,
        paddingVertical: sz.md,
        backgroundColor: c.surface,
      },
      resetBtn: { paddingHorizontal: sz.sm, paddingVertical: sz.xs },
      resetBtnText: { color: c.primary, fontSize: ty.sizes.sm, fontWeight: ty.weight.semibold },
      iconButton: { padding: 8, marginRight: 4 },
    });
  }, [c, sz, ty]);

  const optionRow = useMemo(() => ({
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: sz.sm,
    paddingHorizontal: sz.md,
  }), [sz]);

  const optionLabel = useMemo(() => ({
    flexShrink: 1,
    fontSize: ty.sizes.md,
    color: c.text,
  }), [ty.sizes.md, c.text]);

  const checkboxBase = useMemo(() => ({
    width: 20,
    height: 20,
    borderRadius: rad.md,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: sz.md,
    backgroundColor: c.surface,
  }), [c.border, c.surface, rad.md, sz.md]);

  const checkboxSelected = useMemo(() => ({
    borderColor: c.primary,
    backgroundColor: withAlpha(c.primary, 0.15),
  }), [c.primary]);

  const renderOptions = () => {
    switch (activeCat) {
      case 'departments':
        if (!departments || departments.length === 0) {
          return (
            <View style={{ paddingHorizontal: sz.md, paddingVertical: sz.sm }}>
              <Text style={{ color: c.textSecondary, fontSize: ty.sizes.sm }}>
                {t('common_noData', 'Нет данных')}
              </Text>
            </View>
          );
        }
        return departments.map((d) => {
          const selected = Array.isArray(draft.departments)
            ? draft.departments.map(String).includes(String(d.id))
            : false;
          return (
            <Pressable
              key={String(d.id)}
              onPress={() => toggleDepartment(d.id)}
              style={({ pressed }) => [
                optionRow,
                pressed && { backgroundColor: withAlpha(c.border, 0.07) },
              ]}
            >
              <View style={[checkboxBase, selected && checkboxSelected]}>
                {selected && <Feather name="check" size={14} color={c.onPrimary || c.surface} />}
              </View>
              <Text style={[optionLabel, selected && { fontWeight: ty.weight.semibold }]} numberOfLines={2}>
                {d.name}
              </Text>
            </Pressable>
          );
        });
      case 'roles':
        return rolesOptions.map((r) => {
          const selected = Array.isArray(draft.roles) ? draft.roles.includes(r.value) : false;
          return (
            <Pressable
              key={r.id}
              onPress={() => toggleRole(r.value)}
              style={({ pressed }) => [
                optionRow,
                pressed && { backgroundColor: withAlpha(c.border, 0.07) },
              ]}
            >
              <View style={[checkboxBase, selected && checkboxSelected]}>
                {selected && <Feather name="check" size={14} color={c.onPrimary || c.surface} />}
              </View>
              <Text style={[optionLabel, selected && { fontWeight: ty.weight.semibold }]}>
                {r.label}
              </Text>
            </Pressable>
          );
        });
      case 'suspended':
        const opts = [
          { id: 'all', value: null, label: t('users_showAll', 'Все') },
          { id: 'onlySuspended', value: true, label: t('users_onlySuspended', 'Отстраненные') },
          { id: 'withoutSuspended', value: false, label: t('users_withoutSuspended', 'Без отстраненных') },
        ];
        return opts.map((opt) => {
          const selected = (draft.suspended ?? null) === opt.value;
          return (
            <Pressable
              key={opt.id}
              onPress={() => selectSuspended(opt.value)}
              style={({ pressed }) => [
                optionRow,
                pressed && { backgroundColor: withAlpha(c.border, 0.07) },
              ]}
            >
              <View style={[checkboxBase, selected && checkboxSelected]}>
                {selected && <Feather name="check" size={14} color={c.onPrimary || c.surface} />}
              </View>
              <Text style={[optionLabel, selected && { fontWeight: ty.weight.semibold }]}>
                {opt.label}
              </Text>
            </Pressable>
          );
        });
      default:
        return null;
    }
  };

  if (!mounted && !visible) return null;

  return (
    <View
      style={styles.overlay}
      pointerEvents={visible ? 'auto' : 'none'}
      accessibilityViewIsModal={true}
      importantForAccessibility="yes"
    >
      <View style={[styles.backdrop, { opacity: visible ? 1 : 0 }]} />

      <Animated.View
        style={[styles.page, { transform: [{ translateX: tx }] }]}
      >
        <View style={styles.header}>
          <Pressable
            onPress={onClose}
            android_ripple={{ borderless: true, color: withAlpha(c.border, 0.2) }}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel={t('common_back', 'Назад')}
          >
            <Feather name="arrow-left" size={20} color={c.text} />
          </Pressable>
          <Text style={styles.headerTitle}>{t('common_filter', 'Фильтры')}</Text>
          <Pressable
            onPress={() => {
            setDraft({
              departments: Array.isArray(defaults.departments) ? defaults.departments.map(String) : [],
              roles: Array.isArray(defaults.roles) ? defaults.roles : [],
              suspended: defaults.suspended ?? null,
            });
          }}
            android_ripple={{ borderless: false, color: withAlpha(c.border, 0.13) }}
            style={styles.resetBtn}
            accessibilityRole="button"
            accessibilityLabel={t('settings_sections_quiet_items_quiet_reset', 'Сбросить')}
          >
            <Text style={styles.resetBtnText}>
              {t('settings_sections_quiet_items_quiet_reset', 'Сбросить')}
            </Text>
          </Pressable>
        </View>

        <View style={styles.content}>
          <ScrollView style={styles.categories} contentContainerStyle={{ paddingVertical: sz.sm }}>
            {categories.map((cat) => {
              const active = cat.key === activeCat;
              return (
                <Pressable
                  key={cat.key}
                  onPress={() => setActiveCat(cat.key)}
                  android_ripple={{ borderless: false, color: withAlpha(c.border, 0.13) }}
                  style={[styles.categoryItem, active && styles.categoryItemActive]}
                >
                  <Text style={[styles.categoryLabel, active && styles.categoryLabelActive]}>
                    {cat.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <ScrollView style={styles.options} contentContainerStyle={{ paddingVertical: sz.sm }}>
            {renderOptions()}
          </ScrollView>
        </View>

        {hasChanges && (
          <View style={styles.applyBar}>
            <Button
              title={t('btn_apply', 'Применить')}
              onPress={() => {
              if (setValue) {
                setValue('departments', Array.isArray(draft.departments) ? draft.departments : []);
                setValue('roles', Array.isArray(draft.roles) ? draft.roles : []);
                setValue('suspended', draft.suspended ?? null);
              }
              if (onApply) onApply();
              // update baseline to reflect applied state so button hides if staying open
              setBaseline({
                departments: Array.isArray(draft.departments) ? draft.departments : [],
                roles: Array.isArray(draft.roles) ? draft.roles : [],
                suspended: draft.suspended ?? null,
              });
            }}
              variant="primary"
              size="md"
            />
          </View>
        )}
      </Animated.View>
    </View>
  );
}
