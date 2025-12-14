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
import { ROLE_LABELS } from '../../constants/roles';
import Button from '../ui/Button';
import TextField from '../ui/TextField';

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
    const rgb = color.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
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
  mode = 'filters',
  assignment = null,
  searchItems = [],
  showSearchCategory = true,
}) {
  const { theme } = useTheme();
  useTranslation();

  const isAssignmentMode = mode === 'assignment' && assignment;
  const normalizeSelectionId = (id) =>
    id !== null && id !== undefined ? String(id) : null;
  const assignmentEmployees = isAssignmentMode
    ? Array.isArray(assignment?.employees)
      ? assignment.employees
      : []
    : [];
  const assignmentDefaultId = normalizeSelectionId(assignment?.defaults?.selectedId ?? null);
  const searchList = !isAssignmentMode && Array.isArray(searchItems) ? searchItems : assignmentEmployees;

  const c = theme.colors;
  const sz = theme.spacing;
  const ty = theme.typography;
  const rad = theme.radii;
  const sh = theme.shadows;

  // Animation and UI constants with fallbacks
  const ANIMATION_DURATION_IN = theme?.timings?.modalSlideIn ?? 220;
  const ANIMATION_DURATION_OUT = theme?.timings?.modalSlideOut ?? 200;
  const CATEGORY_TTL = theme?.timings?.filterCategoryTTL ?? 5000; // 5 seconds
  const ICON_SIZE_CHECK = theme?.components?.icon?.sizeXs ?? 14;
  const ICON_SIZE_CHEVRON = theme?.components?.icon?.sizeMd ?? 22;
  const BACK_BUTTON_SIZE = theme?.components?.header?.backButtonSize ?? 36;
  const CHECKBOX_SIZE = theme?.components?.checkbox?.size ?? 20;
  const OVERLAY_Z_INDEX = theme?.zIndices?.modal ?? 1000;
  const ALPHA_RIPPLE = theme?.components?.ripple?.alpha ?? 0.13;
  const ALPHA_PRESSED = theme?.components?.pressable?.pressedAlpha ?? 0.07;
  const ALPHA_CHECKBOX_SELECTED = theme?.components?.checkbox?.selectedAlpha ?? 0.15;
  const RATIO_MIN = theme?.components?.filtersPanel?.minColumnRatio ?? 0.2;
  const RATIO_MAX = theme?.components?.filtersPanel?.maxColumnRatio ?? 0.5;

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
  const [assignmentDraftId, setAssignmentDraftId] = useState(
    normalizeSelectionId(assignment?.selectedId ?? null),
  );
  const [assignmentBaselineId, setAssignmentBaselineId] = useState(
    normalizeSelectionId(assignment?.selectedId ?? null),
  );

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
        duration: ANIMATION_DURATION_IN,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(tx, {
        toValue: SCREEN_W,
        duration: ANIMATION_DURATION_OUT,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, tx, ANIMATION_DURATION_IN, ANIMATION_DURATION_OUT]);

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
  const assignmentCategories = useMemo(() => {
    if (!isAssignmentMode) return [];
    const includeUnassigned = assignment?.includeUnassigned !== false;
    const cats = [];
    if (includeUnassigned) {
      cats.push({
        key: 'dept:null',
        departmentId: null,
        label: t('placeholder_department'),
      });
    }
    if (Array.isArray(departments) && departments.length > 0) {
      departments.forEach((dept) => {
        cats.push({
          key: `dept:${dept.id}`,
          departmentId: dept.id,
          label: dept.name || t('users_department'),
        });
      });
    }
    if (cats.length === 0) {
      cats.push({
        key: 'dept:empty',
        departmentId: null,
        label: t('common_noData'),
        empty: true,
      });
    }
    return cats;
  }, [assignment?.includeUnassigned, departments, isAssignmentMode, t]);

  const SEARCH_CATEGORY_KEY = 'search';
  const categories = useMemo(() => {
    const searchCategory = showSearchCategory
      ? { key: SEARCH_CATEGORY_KEY, label: t('common_search') }
      : null;
    if (isAssignmentMode) {
      return showSearchCategory ? [searchCategory, ...assignmentCategories] : assignmentCategories;
    }
    const cats = [];
    if (departments && departments.length > 0) {
      cats.push({ key: 'departments', label: t('users_department') });
    }
    cats.push({ key: 'roles', label: t('users_role') });
    cats.push({ key: 'suspended', label: t('users_suspended') });
    return showSearchCategory ? [searchCategory, ...cats] : cats;
  }, [assignmentCategories, departments, isAssignmentMode, showSearchCategory, t]);

  const restoredCategoryRef = useRef(false);
  const lastCategoriesRef = useRef(null);

  // Active category: restore from storage if recent (TTL 5s), otherwise select first
  const [activeCat, setActiveCat] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!visible) {
      restoredCategoryRef.current = false;
      lastCategoriesRef.current = null;
      setActiveCat(null);
      return;
    }

    if (isAssignmentMode) {
      const getPreferredCategory = () => {
        const selectedId = normalizeSelectionId(assignment?.selectedId);
        if (selectedId) {
          const selectedUser = assignmentEmployees.find((emp) => String(emp.id) === selectedId);
          if (selectedUser) {
            const deptId = selectedUser.department_id ?? null;
            const key = `dept:${deptId === null ? 'null' : deptId}`;
            if (categories.some((cat) => cat.key === key)) {
              return key;
            }
          }
        }
        return categories.length ? categories[0].key : null;
      };

      setActiveCat((prev) => {
        if (prev && categories.some((cat) => cat.key === prev)) return prev;
        return getPreferredCategory();
      });
      return;
    }

    if (
      restoredCategoryRef.current &&
      lastCategoriesRef.current &&
      lastCategoriesRef.current === categories
    ) {
      return;
    }

    const restoreCategory = async () => {
      try {
        const stored = await AsyncStorage.getItem('@filtersPanelLastCategory');
        if (stored) {
          const { categoryKey, timestamp } = JSON.parse(stored);
          const age = Date.now() - timestamp;
          if (age <= CATEGORY_TTL && categories.some((c) => c.key === categoryKey)) {
            setActiveCat(categoryKey);
            return;
          }
        }
      } catch (e) {
        // Ignore storage errors
      }
      if (categories.length > 0) {
        const fallbackCategory =
          categories.find((cat) => cat.key !== SEARCH_CATEGORY_KEY)?.key ?? categories[0].key;
        setActiveCat(fallbackCategory);
      } else {
        setActiveCat(null);
      }
    };

    restoredCategoryRef.current = true;
    lastCategoriesRef.current = categories;
    restoreCategory();
  }, [
    visible,
    categories,
    CATEGORY_TTL,
    isAssignmentMode,
    assignment?.selectedId,
    assignmentEmployees,
  ]);

  useEffect(() => {
    setSearchQuery('');
  }, [activeCat, visible, isAssignmentMode]);

  useEffect(() => {
    if (isAssignmentMode) return;
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
  }, [activeCat, isAssignmentMode]);

  useEffect(() => {
    if (!isAssignmentMode || !visible) return;
    const initialSelection = normalizeSelectionId(assignment?.selectedId ?? null);
    setAssignmentDraftId(initialSelection);
    setAssignmentBaselineId(initialSelection);
  }, [assignment?.selectedId, isAssignmentMode, visible]);

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
    if (isAssignmentMode) {
      return assignmentDraftId !== assignmentBaselineId;
    }
    if (!eqArrays(draft.departments || [], baseline.departments || [])) return true;
    if (!eqArrays(draft.roles || [], baseline.roles || [])) return true;
    if ((draft.suspended ?? null) !== (baseline.suspended ?? null)) return true;
    return false;
  }, [
    draft,
    baseline,
    assignmentBaselineId,
    assignmentDraftId,
    isAssignmentMode,
  ]);

  // Check if any filters are active (different from defaults)
  const hasActiveFilters = useMemo(() => {
    if (isAssignmentMode) {
      return assignmentDraftId !== assignmentDefaultId;
    }
    const defaultDeps = Array.isArray(defaults.departments)
      ? defaults.departments.map(String)
      : [];
    const defaultRoles = Array.isArray(defaults.roles) ? defaults.roles : [];
    const defaultSuspended = defaults.suspended ?? null;

    if (!eqArrays(draft.departments || [], defaultDeps)) return true;
    if (!eqArrays(draft.roles || [], defaultRoles)) return true;
    if ((draft.suspended ?? null) !== defaultSuspended) return true;
    return false;
  }, [assignmentDefaultId, assignmentDraftId, defaults, draft, isAssignmentMode]);

  const handleAssignmentReset = () => {
    const defaultId = assignmentDefaultId;
    setAssignmentDraftId(defaultId);
    setAssignmentBaselineId(defaultId);
    if (typeof assignment?.onReset === 'function') {
      assignment.onReset(defaultId);
    }
  };

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
    const safeRatio = Math.max(RATIO_MIN, Math.min(RATIO_MAX, leftRatio));
    const leftWidth = Math.round(SCREEN_W * safeRatio);
    const rightWidth = SCREEN_W - leftWidth;
    return StyleSheet.create({
      overlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: OVERLAY_Z_INDEX,
        elevation: OVERLAY_Z_INDEX,
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
        backgroundColor: c.background,
      },
      backBtn: {
        padding: sz.xs || 4,
        borderRadius: (BACK_BUTTON_SIZE + (sz.xs || 4) * 2) / 2,
        marginRight: sz.xs,
      },
      backCircle: {
        width: BACK_BUTTON_SIZE,
        height: BACK_BUTTON_SIZE,
        borderRadius: BACK_BUTTON_SIZE / 2,
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
        categoriesColumn: {
          width: leftWidth,
          borderRightWidth: 0,
          backgroundColor: c.background,
          paddingBottom: sz.sm,
        },
        categoriesList: {
          flex: 1,
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
      optionsScroll: { flex: 1 },
      searchFieldWrap: {
        paddingHorizontal: sz.md,
        marginTop: sz.sm,
      },
      applyBar: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        paddingHorizontal: sz.lg,
        paddingBottom: sz.lg,
        paddingTop: sz.md,
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
      width: CHECKBOX_SIZE,
      height: CHECKBOX_SIZE,
      borderRadius: rad.md,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: sz.md,
      backgroundColor: c.surface,
    }),
    [c.border, c.surface, rad.md, sz.md, CHECKBOX_SIZE],
  );

  const checkboxSelected = useMemo(
    () => ({
      borderColor: c.primary,
      backgroundColor: withAlpha(c.primary, ALPHA_CHECKBOX_SELECTED),
    }),
    [c.primary, ALPHA_CHECKBOX_SELECTED],
  );

  const normalizedSearch = useMemo(() => (searchQuery || '').trim().toLowerCase(), [searchQuery]);
  const searchHasValue = normalizedSearch.length > 0;
  const matchesSearchText = useMemo(
    () => (value) => {
      if (!searchHasValue) return false;
      if (!value) return false;
      return String(value).toLowerCase().includes(normalizedSearch);
    },
    [normalizedSearch, searchHasValue],
  );

  const headerTitle = isAssignmentMode ? assignment?.title || t('common_filter') : t('common_filter');

  const renderAssignmentOptions = () => {
    if (!isAssignmentMode) return null;
    if (!categories || categories.length === 0) return null;
    const activeCategory =
      categories.find((cat) => cat.key === activeCat) ?? categories[0];
    if (!activeCategory) return null;
    const activeDeptId =
      activeCategory.departmentId === undefined ? null : activeCategory.departmentId;
    const filtered = assignmentEmployees.filter((emp) => {
      const dept = emp?.department_id ?? null;
      if (activeDeptId === null) return dept === null;
      return String(dept) === String(activeDeptId);
    });

    if (!filtered.length) {
      return (
        <View style={{ paddingHorizontal: sz.md, paddingVertical: sz.sm }}>
          <Text style={{ color: c.textSecondary, fontSize: ty.sizes.sm }}>
            {normalizedSearch ? t('empty_noResults') : t('common_noData')}
          </Text>
        </View>
      );
    }

    const sorted = [...filtered].sort((a, b) =>
      (a.display_name || '').localeCompare(b.display_name || ''),
    );

    return sorted.map((emp, idx) => renderAssignmentRow(emp, idx));
  };

  const renderAssignmentRow = (emp, idx) => {
    const empId = normalizeSelectionId(emp.id);
    const selected = empId ? assignmentDraftId === empId : false;
    const name = emp.display_name || emp.email || t('common_noName');
    return (
      <Pressable
        key={empId || `emp-${idx}`}
        onPress={() => {
          if (empId) setAssignmentDraftId(empId);
        }}
        style={({ pressed }) => [
          optionRow,
          pressed && { backgroundColor: withAlpha(c.border, ALPHA_PRESSED) },
        ]}
      >
        <View style={[checkboxBase, selected && checkboxSelected]}>
          {selected && <Feather name="check" size={ICON_SIZE_CHECK} color={c.onPrimary} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={[optionLabel, selected && { fontWeight: ty.weight.semibold }]}
            numberOfLines={1}
          >
            {name}
          </Text>
          {emp.role ? (
            <Text
              style={{
                fontSize: ty.sizes.sm,
                color: c.textSecondary,
                marginTop: 2,
              }}
              numberOfLines={1}
            >
              {ROLE_LABELS[emp.role] || emp.role}
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  };

  const renderSearchMode = () => {
    const results = searchHasValue
      ? searchList
          .filter((emp) => matchesSearchText(emp.display_name) || matchesSearchText(emp.email))
          .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''))
      : [];

    return (
      <>
        <View style={styles.searchFieldWrap}>
          <TextField
            placeholder={t('common_search')}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
            hideSeparator={true}
            rightSlot={
              searchQuery ? (
                <Pressable
                  android_ripple={{ borderless: true, color: withAlpha(c.border, 0.1) }}
                  onPress={() => setSearchQuery('')}
                  style={{ padding: 4 }}
                >
                  <Feather name="x" size={16} color={c.textSecondary} />
                </Pressable>
              ) : null
            }
          />
        </View>
        {results.length === 0 ? (
          <View style={{ paddingHorizontal: sz.md, paddingVertical: sz.sm }}>
            <Text style={{ color: c.textSecondary, fontSize: ty.sizes.sm }}>
              {t('empty_noResults')}
            </Text>
          </View>
        ) : (
          results.map((emp, idx) => renderAssignmentRow(emp, idx))
        )}
      </>
    );
  };

  const renderOptions = () => {
    if (showSearchCategory && activeCat === SEARCH_CATEGORY_KEY) {
      return renderSearchMode();
    }
    if (!showSearchCategory && activeCat == null && !isAssignmentMode) {
      return null;
    }
    if (isAssignmentMode) {
      return renderAssignmentOptions();
    }
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
        const allSelected = !Array.isArray(draft.departments) || draft.departments.length === 0;
        return (
          <>
            <Pressable
              key="all"
              onPress={() => setDraft((d) => ({ ...d, departments: [] }))}
              style={({ pressed }) => [
                optionRow,
                pressed && { backgroundColor: withAlpha(c.border, ALPHA_PRESSED) },
              ]}
            >
              <View style={[checkboxBase, allSelected && checkboxSelected]}>
                {allSelected && <Feather name="check" size={ICON_SIZE_CHECK} color={c.onPrimary} />}
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
                    pressed && { backgroundColor: withAlpha(c.border, ALPHA_PRESSED) },
                  ]}
                >
                  <View style={[checkboxBase, selected && checkboxSelected]}>
                    {selected && (
                      <Feather name="check" size={ICON_SIZE_CHECK} color={c.onPrimary} />
                    )}
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
        const rolesAllSelected = !Array.isArray(draft.roles) || draft.roles.length === 0;
        return (
          <>
            <Pressable
              key="all_roles"
              onPress={() => setDraft((d) => ({ ...d, roles: [] }))}
              style={({ pressed }) => [
                optionRow,
                pressed && { backgroundColor: withAlpha(c.border, ALPHA_PRESSED) },
              ]}
            >
              <View style={[checkboxBase, rolesAllSelected && checkboxSelected]}>
                {rolesAllSelected && (
                  <Feather name="check" size={ICON_SIZE_CHECK} color={c.onPrimary} />
                )}
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
                    pressed && { backgroundColor: withAlpha(c.border, ALPHA_PRESSED) },
                  ]}
                >
                  <View style={[checkboxBase, selected && checkboxSelected]}>
                    {selected && (
                      <Feather name="check" size={ICON_SIZE_CHECK} color={c.onPrimary} />
                    )}
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
                pressed && { backgroundColor: withAlpha(c.border, ALPHA_PRESSED) },
              ]}
            >
              <View style={[checkboxBase, selected && checkboxSelected]}>
                {selected && <Feather name="check" size={ICON_SIZE_CHECK} color={c.onPrimary} />}
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
              if (isAssignmentMode) {
                setAssignmentDraftId(assignmentBaselineId);
              } else {
                setDraft(baseline);
              }
              // Close the panel without applying changes
              if (onClose) onClose();
            }}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel={t('common_back')}
          >
            <View style={styles.backCircle}>
              <Feather name="chevron-left" size={ICON_SIZE_CHEVRON} color={c.text} />
            </View>
          </Pressable>

          <Text style={styles.headerTitle}>{headerTitle}</Text>

          {/* Reset button on right: visible when any filter is active (not default) */}
          {hasActiveFilters ? (
            <Pressable
              onPress={() => {
                if (isAssignmentMode) {
                  handleAssignmentReset();
                  return;
                }
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
              android_ripple={{ borderless: false, color: withAlpha(c.border, ALPHA_RIPPLE) }}
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
          <View style={styles.categoriesColumn}>
            <ScrollView
              style={styles.categoriesList}
              contentContainerStyle={{ paddingBottom: sz.sm }}
            >
            {categories.map((cat) => {
              const active = cat.key === activeCat;
              return (
                <Pressable
                  key={cat.key}
                  onPress={() => {
                    setActiveCat(cat.key);
                    if (cat.key === SEARCH_CATEGORY_KEY) {
                      setSearchQuery('');
                    }
                  }}
                  android_ripple={{ borderless: false, color: withAlpha(c.border, ALPHA_RIPPLE) }}
                  style={[styles.categoryItem, active && styles.categoryItemActive]}
                >
                  <Text style={[styles.categoryLabel, active && styles.categoryLabelActive]}>
                    {cat.label}
                  </Text>
                </Pressable>
              );
            })}
            </ScrollView>
          </View>

          <View style={styles.options}>
            <ScrollView style={styles.optionsScroll} contentContainerStyle={{ paddingBottom: sz.sm }}>
              {renderOptions()}
            </ScrollView>
          </View>
        </View>

        {hasChanges && (
          <View style={styles.applyBar} pointerEvents="box-none">
            <Button
              title={t('btn_apply')}
              onPress={() => {
                if (isAssignmentMode) {
                  const selection = assignmentDraftId;
                  if (typeof assignment?.onApply === 'function') {
                    assignment.onApply(selection);
                  }
                  setAssignmentBaselineId(selection);
                  setAssignmentDraftId(selection);
                  if (onClose) onClose();
                  return;
                }
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
