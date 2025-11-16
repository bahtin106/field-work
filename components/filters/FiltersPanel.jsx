// components/filters/FiltersPanel.jsx
// Full-screen page-like filters without RN Modal. No remount on selection → no flicker.
// Stays mounted; visibility is controlled by Animated slide. Matches "отдельная страница" UX.

import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Dimensions,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { t } from '../../src/i18n';
import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme/ThemeProvider';
import Button from '../ui/Button';

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
  const sh = theme.shadows;

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

  // Intercept hardware back button and swipe-back when panel is visible
  useEffect(() => {
    if (!visible) return;

    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (onClose) onClose();
      return true; // Prevent default back navigation
    });

    return () => backHandler.remove();
  }, [visible, onClose]);

  // Categories composition
  const categories = useMemo(() => {
    const cats = [];
    if (departments && departments.length > 0) {
      cats.push({ key: 'departments', label: t('users_department') });
    }
    cats.push({ key: 'roles', label: t('users_role') });
    cats.push({ key: 'suspended', label: t('users_suspended') });
    return cats;
  }, [departments, t]);

  // Active category: restore from storage if recent (TTL 5s), otherwise select first
  const [activeCat, setActiveCat] = useState(null);

  // Restore last active category when panel opens (if within TTL)
  useEffect(() => {
    if (visible && categories.length > 0) {
      const restoreCategory = async () => {
        try {
          const stored = await AsyncStorage.getItem('@filtersPanelLastCategory');
          if (stored) {
            const { categoryKey, timestamp } = JSON.parse(stored);
            const age = Date.now() - timestamp;
            const ttl = 5000; // 5 seconds, matching filter TTL
            if (age <= ttl && categories.some((c) => c.key === categoryKey)) {
              setActiveCat(categoryKey);
              return;
            }
          }
        } catch (e) {
          // Ignore storage errors
        }
        // Default to first category if no valid stored value
        setActiveCat(categories[0].key);
      };
      restoreCategory();
    } else if (!visible) {
      // Reset active category when panel closes to ensure clean state on next open
      setActiveCat(null);
    }
  }, [visible, categories]);

  // Save active category to storage when it changes
  useEffect(() => {
    if (activeCat) {
      const saveCategory = async () => {
        try {
          await AsyncStorage.setItem(
            '@filtersPanelLastCategory',
            JSON.stringify({ categoryKey: activeCat, timestamp: Date.now() }),
          );
        } catch (e) {
          // Ignore storage errors
        }
      };
      saveCategory();
    }
  }, [activeCat]);

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

  // Check if any filters are active (different from defaults)
  const hasActiveFilters = useMemo(() => {
    const defaultDeps = Array.isArray(defaults.departments) ? defaults.departments.map(String) : [];
    const defaultRoles = Array.isArray(defaults.roles) ? defaults.roles : [];
    const defaultSuspended = defaults.suspended ?? null;

    if (!eqArrays(draft.departments || [], defaultDeps)) return true;
    if (!eqArrays(draft.roles || [], defaultRoles)) return true;
    if ((draft.suspended ?? null) !== defaultSuspended) return true;
    return false;
  }, [draft, defaults]);

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
    const leftRatioRaw = theme?.components?.filtersPanel?.leftColumnRatio;
    const leftRatio = typeof leftRatioRaw === 'number' ? leftRatioRaw : 1 / 3;
    const safeRatio = Math.max(0.2, Math.min(0.5, leftRatio));
    const leftWidth = Math.round(SCREEN_W * safeRatio);
    const rightWidth = SCREEN_W - leftWidth;
    return StyleSheet.create({
      overlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 1000,
        elevation: 1000,
      },
      backdrop: {
        ...StyleSheet.absoluteFillObject,
        // overlay color comes from theme (already an rgba string in tokens)
        backgroundColor: c.overlay,
      },
      page: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: SCREEN_W,
        backgroundColor: c.background,
        // Use theme shadows (ios + android values) instead of hardcoded ones
        shadowColor: sh?.card?.ios?.shadowColor,
        shadowOpacity: sh?.card?.ios?.shadowOpacity,
        shadowRadius: sh?.card?.ios?.shadowRadius,
        shadowOffset: sh?.card?.ios?.shadowOffset,
        elevation: sh?.card?.android?.elevation,
      },
      header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: sz.sm,
        paddingHorizontal: sz.md,
        // remove header separator line per request
        borderBottomWidth: 0,
        backgroundColor: c.surface,
      },
      backBtn: {
        padding: 4,
        borderRadius: 20,
        marginRight: sz.xs,
      },
      backCircle: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
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
        borderRightWidth: 0,
        backgroundColor: c.background,
      },
      categoryItem: {
        paddingVertical: sz.sm,
        paddingHorizontal: sz.md,
        flexDirection: 'row',
        alignItems: 'flex-start', // allow wrapping in label
      },
      categoryLabel: {
        fontSize: ty.sizes.md,
        color: c.textSecondary,
        flex: 1,
        flexWrap: 'wrap',
        flexShrink: 1,
      },
      categoryItemActive: { backgroundColor: c.inputBg },
      categoryLabelActive: { color: c.text, fontWeight: ty.weight.semibold },
      options: { width: rightWidth, backgroundColor: c.inputBg },
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

  const optionRow = useMemo(
    () => ({
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: sz.sm,
      paddingHorizontal: sz.md,
    }),
    [sz],
  );

  const optionLabel = useMemo(
    () => ({
      flexShrink: 1,
      fontSize: ty.sizes.md,
      color: c.text,
    }),
    [ty.sizes.md, c.text],
  );

  const checkboxBase = useMemo(
    () => ({
      width: 20,
      height: 20,
      borderRadius: rad.md,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: sz.md,
      backgroundColor: c.surface,
    }),
    [c.border, c.surface, rad.md, sz.md],
  );

  const checkboxSelected = useMemo(
    () => ({
      borderColor: c.primary,
      backgroundColor: withAlpha(c.primary, 0.15),
    }),
    [c.primary],
  );

  const renderOptions = () => {
    switch (activeCat) {
      case 'departments':
        if (!departments || departments.length === 0) {
          return (
            <View style={{ paddingHorizontal: sz.md, paddingVertical: sz.sm }}>
              <Text style={{ color: c.textSecondary, fontSize: ty.sizes.sm }}>
                {t('common_noData')}
              </Text>
            </View>
          );
        }
        // 'All' option
        const allSelected = !Array.isArray(draft.departments) || draft.departments.length === 0;
        return (
          <>
            <Pressable
              key="all"
              onPress={() => setDraft((d) => ({ ...d, departments: [] }))}
              style={({ pressed }) => [
                optionRow,
                pressed && { backgroundColor: withAlpha(c.border, 0.07) },
              ]}
            >
              <View style={[checkboxBase, allSelected && checkboxSelected]}>
                {allSelected && <Feather name="check" size={14} color={c.onPrimary} />}
              </View>
              <Text style={[optionLabel, allSelected && { fontWeight: ty.weight.semibold }]}>
                {t('users_showAll')}
              </Text>
            </Pressable>
            {departments.map((d) => {
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
                    {selected && <Feather name="check" size={14} color={c.onPrimary} />}
                  </View>
                  <Text
                    style={[optionLabel, selected && { fontWeight: ty.weight.semibold }]}
                    numberOfLines={2}
                  >
                    {d.name}
                  </Text>
                </Pressable>
              );
            })}
          </>
        );
      case 'roles':
        // 'All' option for roles: empty selection means all
        const rolesAllSelected = !Array.isArray(draft.roles) || draft.roles.length === 0;
        return (
          <>
            <Pressable
              key="all_roles"
              onPress={() => setDraft((d) => ({ ...d, roles: [] }))}
              style={({ pressed }) => [
                optionRow,
                pressed && { backgroundColor: withAlpha(c.border, 0.07) },
              ]}
            >
              <View style={[checkboxBase, rolesAllSelected && checkboxSelected]}>
                {rolesAllSelected && <Feather name="check" size={14} color={c.onPrimary} />}
              </View>
              <Text style={[optionLabel, rolesAllSelected && { fontWeight: ty.weight.semibold }]}>
                {t('users_showAll')}
              </Text>
            </Pressable>
            {rolesOptions.map((r) => {
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
                    {selected && <Feather name="check" size={14} color={c.onPrimary} />}
                  </View>
                  <Text style={[optionLabel, selected && { fontWeight: ty.weight.semibold }]}>
                    {r.label}
                  </Text>
                </Pressable>
              );
            })}
          </>
        );
      case 'suspended':
        const opts = [
          { id: 'all', value: null, label: t('users_showAll') },
          { id: 'onlySuspended', value: true, label: t('users_onlySuspended') },
          { id: 'withoutSuspended', value: false, label: t('users_withoutSuspended') },
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
                {selected && <Feather name="check" size={14} color={c.onPrimary} />}
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

      <Animated.View style={[styles.page, { transform: [{ translateX: tx }] }]}>
        <View style={styles.header}>
          {/* Back arrow on left: discard changes and close panel */}
          <Pressable
            hitSlop={12}
            onPress={() => {
              // Discard any changes by restoring baseline values
              setDraft(baseline);
              // Close the panel without applying changes
              if (onClose) onClose();
            }}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel={t('common_back')}
          >
            <View style={styles.backCircle}>
              <Feather name="chevron-left" size={22} color={c.text} />
            </View>
          </Pressable>

          <Text style={styles.headerTitle}>{t('common_filter')}</Text>

          {/* Reset button on right: visible when any filter is active (not default) */}
          {hasActiveFilters ? (
            <Pressable
              onPress={() => {
                const emptyDeps = Array.isArray(defaults.departments)
                  ? defaults.departments.map(String)
                  : [];
                const emptyRoles = Array.isArray(defaults.roles) ? defaults.roles : [];
                const emptySuspended = defaults.suspended ?? null;
                const snapshot = {
                  departments: emptyDeps,
                  roles: emptyRoles,
                  suspended: emptySuspended,
                };
                // Reset draft and baseline so hasChanges becomes false immediately
                setDraft(snapshot);
                setBaseline(snapshot);
                // Propagate reset to parent state: update values and then call onApply
                // so the cleared filters persist (prevents stale filter on reopen).
                if (setValue) {
                  setValue('departments', emptyDeps);
                  setValue('roles', emptyRoles);
                  setValue('suspended', emptySuspended);
                }
                if (onApply) {
                  // Call onApply to let parent persist the cleared filters. Do not close the panel.
                  onApply();
                }
                // Do not call onClose here; keep panel open per UX request.
              }}
              android_ripple={{ borderless: false, color: withAlpha(c.border, 0.13) }}
              style={styles.resetBtn}
              accessibilityRole="button"
              accessibilityLabel={t('settings_sections_quiet_items_quiet_reset')}
            >
              <Text style={styles.resetBtnText}>
                {t('settings_sections_quiet_items_quiet_reset')}
              </Text>
            </Pressable>
          ) : (
            <View style={styles.resetBtn} />
          )}
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
              title={t('btn_apply')}
              onPress={() => {
                if (setValue) {
                  setValue(
                    'departments',
                    Array.isArray(draft.departments) ? draft.departments : [],
                  );
                  setValue('roles', Array.isArray(draft.roles) ? draft.roles : []);
                  setValue('suspended', draft.suspended ?? null);
                }
                if (onApply) onApply();
                // update baseline to reflect applied state
                setBaseline({
                  departments: Array.isArray(draft.departments) ? draft.departments : [],
                  roles: Array.isArray(draft.roles) ? draft.roles : [],
                  suspended: draft.suspended ?? null,
                });
                // Close the panel after applying
                if (onClose) onClose();
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
