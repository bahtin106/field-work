// components/filters/FiltersPanel.jsx
// Full-screen page-like filters without RN Modal. No remount on selection → no flicker.
// Stays mounted; visibility is controlled by Animated slide. Matches "отдельная страница" UX.

import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useRef, useState } from 'react';
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
const EMPTY_ARRAY = [];
const EMPTY_OBJECT = {};

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

const normalizeSelectionId = (id) =>
  id !== null && id !== undefined ? String(id) : null;

const normalizeSelectionIds = (ids) =>
  Array.isArray(ids) ? ids.map((id) => normalizeSelectionId(id)).filter(Boolean) : [];

/**
 * Props:
 *  - visible, onClose
 *  - departments, rolesOptions
 *  - values, setValue, defaults
 *  - onApply
 */
export default function FiltersPanel({
  visible,
  onClose,
  departments = EMPTY_ARRAY,
  rolesOptions = EMPTY_ARRAY,
  objectFilters = null,
  inlineOptionSearch = null,
  previewCountResolver = null,
  previewCountValue = null,
  previewCountLabel = null,
  previewStatusResolver = null,
  values = EMPTY_OBJECT,
  setValue,
  defaults = EMPTY_OBJECT,
  onApply,
  mode = 'filters',
  assignment = null,
  ordersFilters = null,
  searchItems = EMPTY_ARRAY,
  showSearchCategory = true,
}) {
  const { theme } = useTheme();
  useTranslation();

  const isAssignmentMode = mode === 'assignment' && assignment;
  const isObjectsMode = mode === 'objects';
  const isOrdersMode = mode === 'orders';
  const isAssignmentMulti = isAssignmentMode && assignment?.multiple === true;
  const assignmentEmployees = useMemo(
    () =>
      isAssignmentMode
        ? Array.isArray(assignment?.employees)
          ? assignment.employees
          : []
        : [],
    [assignment?.employees, isAssignmentMode],
  );
  const assignmentDefaultSelection = useMemo(() => {
    if (!isAssignmentMode) return [];
    if (isAssignmentMulti) {
      const fromDefaults = normalizeSelectionIds(assignment?.defaults?.selectedIds);
      if (fromDefaults.length) return fromDefaults;
      const fromSelected = normalizeSelectionIds(assignment?.selectedIds);
      if (fromSelected.length) return fromSelected;
      return [];
    }
    return normalizeSelectionId(assignment?.defaults?.selectedId ?? null)
      ? [normalizeSelectionId(assignment?.defaults?.selectedId ?? null)]
      : [];
  }, [assignment?.defaults?.selectedId, assignment?.defaults?.selectedIds, assignment?.selectedIds, isAssignmentMode, isAssignmentMulti]);
  const searchList = !isAssignmentMode && Array.isArray(searchItems) ? searchItems : assignmentEmployees;

  const c = theme.colors;
  const sz = theme.spacing;
  const ty = theme.typography;
  const rad = theme.radii;
  const sh = theme.shadows;

  // Animation and UI constants with fallbacks
  const _ANIMATION_DURATION_IN = theme?.timings?.modalSlideIn ?? 220;
  const _ANIMATION_DURATION_OUT = theme?.timings?.modalSlideOut ?? 200;
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
    cities: Array.isArray(values.cities) ? values.cities.map(String) : [],
    streets: Array.isArray(values.streets) ? values.streets.map(String) : [],
    clientIds: Array.isArray(values.clientIds) ? values.clientIds.map(String) : [],
    workTypes: Array.isArray(values.workTypes) ? values.workTypes.map(String) : [],
    statuses: Array.isArray(values.statuses) ? values.statuses.map(String) : [],
    executorId:
      values.executorId === null || values.executorId === undefined ? null : String(values.executorId),
    departureDateFrom: values.departureDateFrom || null,
    departureDateTo: values.departureDateTo || null,
    departureTimeFrom: values.departureTimeFrom || null,
    departureTimeTo: values.departureTimeTo || null,
    sumMin: values.sumMin || '',
    sumMax: values.sumMax || '',
  });
  // Baseline snapshot: values at the moment panel becomes visible
  const [baseline, setBaseline] = useState({
    departments: Array.isArray(values.departments) ? values.departments.map(String) : [],
    roles: Array.isArray(values.roles) ? values.roles : [],
    suspended: values.suspended ?? null,
    cities: Array.isArray(values.cities) ? values.cities.map(String) : [],
    streets: Array.isArray(values.streets) ? values.streets.map(String) : [],
    clientIds: Array.isArray(values.clientIds) ? values.clientIds.map(String) : [],
    workTypes: Array.isArray(values.workTypes) ? values.workTypes.map(String) : [],
    statuses: Array.isArray(values.statuses) ? values.statuses.map(String) : [],
    executorId:
      values.executorId === null || values.executorId === undefined ? null : String(values.executorId),
    departureDateFrom: values.departureDateFrom || null,
    departureDateTo: values.departureDateTo || null,
    departureTimeFrom: values.departureTimeFrom || null,
    departureTimeTo: values.departureTimeTo || null,
    sumMin: values.sumMin || '',
    sumMax: values.sumMax || '',
  });
  const [assignmentDraftSelection, setAssignmentDraftSelection] = useState(
    isAssignmentMulti
      ? normalizeSelectionIds(assignment?.selectedIds)
      : (normalizeSelectionId(assignment?.selectedId ?? null) ? [normalizeSelectionId(assignment?.selectedId ?? null)] : []),
  );
  const [assignmentBaselineSelection, setAssignmentBaselineSelection] = useState(
    isAssignmentMulti
      ? normalizeSelectionIds(assignment?.selectedIds)
      : (normalizeSelectionId(assignment?.selectedId ?? null) ? [normalizeSelectionId(assignment?.selectedId ?? null)] : []),
  );

  // Re-init draft and baseline every time panel opens
  useEffect(() => {
    if (visible) {
      const snap = {
        departments: Array.isArray(values.departments) ? values.departments.map(String) : [],
        roles: Array.isArray(values.roles) ? values.roles : [],
        suspended: values.suspended ?? null,
        cities: Array.isArray(values.cities) ? values.cities.map(String) : [],
        streets: Array.isArray(values.streets) ? values.streets.map(String) : [],
        clientIds: Array.isArray(values.clientIds) ? values.clientIds.map(String) : [],
        workTypes: Array.isArray(values.workTypes) ? values.workTypes.map(String) : [],
        statuses: Array.isArray(values.statuses) ? values.statuses.map(String) : [],
        executorId:
          values.executorId === null || values.executorId === undefined ? null : String(values.executorId),
        departureDateFrom: values.departureDateFrom || null,
        departureDateTo: values.departureDateTo || null,
        departureTimeFrom: values.departureTimeFrom || null,
        departureTimeTo: values.departureTimeTo || null,
        sumMin: values.sumMin || '',
        sumMax: values.sumMax || '',
      };
      setDraft(snap);
      setBaseline(snap);
    }
  }, [
    visible,
    values.clientIds,
    values.cities,
    values.departments,
    values.roles,
    values.streets,
    values.suspended,
    values.workTypes,
    values.statuses,
    values.executorId,
    values.departureDateFrom,
    values.departureDateTo,
    values.departureTimeFrom,
    values.departureTimeTo,
    values.sumMin,
    values.sumMax,
  ]);

  // Animation (slide from right like a page). Kept mounted.
  const tx = useRef(new Animated.Value(visible ? 0 : SCREEN_W)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.spring(tx, {
        toValue: 0,
        damping: 28,
        stiffness: 260,
        mass: 0.85,
        useNativeDriver: true,
        overshootClamping: true,
      }).start();
    } else {
      Animated.timing(tx, {
        toValue: SCREEN_W,
        duration: 280,
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
  const assignmentCategories = useMemo(() => {
    if (!isAssignmentMode) return [];
    const includeUnassigned =
      assignment?.includeUnassigned ??
      (Array.isArray(departments) && departments.length > 0);
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
  }, [assignment?.includeUnassigned, departments, isAssignmentMode]);

  const SEARCH_CATEGORY_KEY = 'search';
  const categories = useMemo(() => {
    const searchCategory = showSearchCategory
      ? { key: SEARCH_CATEGORY_KEY, label: t('common_search') }
      : null;
    if (isAssignmentMode) {
      return showSearchCategory ? [searchCategory, ...assignmentCategories] : assignmentCategories;
    }
    if (isObjectsMode) {
      const objectCategories = [];
      objectCategories.push({ key: 'objects_cities', label: t('common_city', 'Город') });
      objectCategories.push({ key: 'objects_streets', label: t('common_street', 'Улица') });
      objectCategories.push({ key: 'objects_clients', label: t('common_client', 'Клиент') });
      return showSearchCategory ? [searchCategory, ...objectCategories] : objectCategories;
    }
    if (isOrdersMode) {
      const ordersStatusOptions = Array.isArray(ordersFilters?.statuses) ? ordersFilters.statuses : [];
      const ordersWorkTypes = Array.isArray(ordersFilters?.workTypes) ? ordersFilters.workTypes : [];
      const ordersExecutors = Array.isArray(ordersFilters?.executors) ? ordersFilters.executors : [];
      const showDate = ordersFilters?.showDate !== false;
      const showTime = ordersFilters?.showTime !== false;
      const showAmount = ordersFilters?.showAmount !== false;
      const cats = [];
      if (ordersStatusOptions.length) cats.push({ key: 'orders_statuses', label: t('orders_filter_status') });
      if (ordersWorkTypes.length) cats.push({ key: 'orders_workTypes', label: t('order_field_work_type') });
      if (ordersExecutors.length) cats.push({ key: 'orders_executors', label: t('orders_filter_executor', 'Исполнитель') });
      if (showDate) cats.push({ key: 'orders_departure_date', label: t('order_field_departure_date') });
      if (showTime) cats.push({ key: 'orders_departure_time', label: t('order_field_departure_time') });
      if (showAmount) cats.push({ key: 'orders_amount', label: t('order_details_amount') });
      return showSearchCategory ? [searchCategory, ...cats] : cats;
    }
    const cats = [];
    if (departments && departments.length > 0) {
      cats.push({ key: 'departments', label: t('users_department') });
    }
    cats.push({ key: 'roles', label: t('users_role') });
    cats.push({ key: 'suspended', label: t('users_suspended') });
    return showSearchCategory ? [searchCategory, ...cats] : cats;
  }, [assignmentCategories, departments, isAssignmentMode, isObjectsMode, isOrdersMode, ordersFilters, showSearchCategory]);

  const restoredCategoryRef = useRef(false);
  const lastCategoriesKeyRef = useRef('');
  const categoriesKey = useMemo(
    () => (Array.isArray(categories) ? categories.map((cat) => cat?.key).join('|') : ''),
    [categories],
  );

  // Active category: restore from storage if recent (TTL 5s), otherwise select first
  const [activeCat, setActiveCat] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [inlineSearchQuery, setInlineSearchQuery] = useState('');

  useEffect(() => {
    if (!visible) {
      restoredCategoryRef.current = false;
      lastCategoriesKeyRef.current = '';
      setActiveCat(null);
      return;
    }

    if (isAssignmentMode) {
      const getPreferredCategory = () => {
        const selectedId = assignmentDraftSelection?.[0] || normalizeSelectionId(assignment?.selectedId);
        if (selectedId) {
          const selectedUser = assignmentEmployees.find((emp) => String(emp.id) === String(selectedId));
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
      lastCategoriesKeyRef.current &&
      lastCategoriesKeyRef.current === categoriesKey
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
      } catch {
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
    lastCategoriesKeyRef.current = categoriesKey;
    restoreCategory();
  }, [
    visible,
    categories,
    categoriesKey,
    CATEGORY_TTL,
    isAssignmentMode,
    assignment?.selectedId,
    assignmentDraftSelection,
    assignmentEmployees,
  ]);

  useEffect(() => {
    setSearchQuery('');
    setInlineSearchQuery('');
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
        } catch {
          // Ignore storage errors
        }
      };
      saveCategory();
    }
  }, [activeCat, isAssignmentMode]);

  useEffect(() => {
    if (!isAssignmentMode || !visible) return;
    const initialSelection = isAssignmentMulti
      ? normalizeSelectionIds(assignment?.selectedIds)
      : (normalizeSelectionId(assignment?.selectedId ?? null) ? [normalizeSelectionId(assignment?.selectedId ?? null)] : []);
    setAssignmentDraftSelection(initialSelection);
    setAssignmentBaselineSelection(initialSelection);
  }, [assignment?.selectedId, assignment?.selectedIds, isAssignmentMode, isAssignmentMulti, visible]);

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
      return !eqArrays(assignmentDraftSelection || [], assignmentBaselineSelection || []);
    }
    if (isObjectsMode) {
      if (!eqArrays(draft.cities || [], baseline.cities || [])) return true;
      if (!eqArrays(draft.streets || [], baseline.streets || [])) return true;
      if (!eqArrays(draft.clientIds || [], baseline.clientIds || [])) return true;
      return false;
    }
    if (isOrdersMode) {
      if (!eqArrays(draft.workTypes || [], baseline.workTypes || [])) return true;
      if (!eqArrays(draft.statuses || [], baseline.statuses || [])) return true;
      if ((draft.executorId ?? null) !== (baseline.executorId ?? null)) return true;
      if ((draft.departureDateFrom ?? null) !== (baseline.departureDateFrom ?? null)) return true;
      if ((draft.departureDateTo ?? null) !== (baseline.departureDateTo ?? null)) return true;
      if ((draft.departureTimeFrom ?? null) !== (baseline.departureTimeFrom ?? null)) return true;
      if ((draft.departureTimeTo ?? null) !== (baseline.departureTimeTo ?? null)) return true;
      if (String(draft.sumMin || '') !== String(baseline.sumMin || '')) return true;
      if (String(draft.sumMax || '') !== String(baseline.sumMax || '')) return true;
      return false;
    }
    if (!eqArrays(draft.departments || [], baseline.departments || [])) return true;
    if (!eqArrays(draft.roles || [], baseline.roles || [])) return true;
    if ((draft.suspended ?? null) !== (baseline.suspended ?? null)) return true;
    return false;
  }, [
    draft,
    baseline,
    assignmentBaselineSelection,
    assignmentDraftSelection,
    isAssignmentMode,
    isObjectsMode,
    isOrdersMode,
  ]);

  // Check if any filters are active (different from defaults)
  const hasActiveFilters = useMemo(() => {
    if (isAssignmentMode) {
      return !eqArrays(assignmentDraftSelection || [], assignmentDefaultSelection || []);
    }
    if (isObjectsMode) {
      const defaultCities = Array.isArray(defaults.cities) ? defaults.cities.map(String) : [];
      const defaultStreets = Array.isArray(defaults.streets) ? defaults.streets.map(String) : [];
      const defaultClientIds = Array.isArray(defaults.clientIds) ? defaults.clientIds.map(String) : [];
      if (!eqArrays(draft.cities || [], defaultCities)) return true;
      if (!eqArrays(draft.streets || [], defaultStreets)) return true;
      if (!eqArrays(draft.clientIds || [], defaultClientIds)) return true;
      return false;
    }
    if (isOrdersMode) {
      const defaultWorkTypes = Array.isArray(defaults.workTypes) ? defaults.workTypes.map(String) : [];
      const defaultStatuses = Array.isArray(defaults.statuses) ? defaults.statuses.map(String) : [];
      const defaultExecutorId =
        defaults.executorId === null || defaults.executorId === undefined ? null : String(defaults.executorId);
      const defaultDateFrom = defaults.departureDateFrom || null;
      const defaultDateTo = defaults.departureDateTo || null;
      const defaultTimeFrom = defaults.departureTimeFrom || null;
      const defaultTimeTo = defaults.departureTimeTo || null;
      const defaultSumMin = defaults.sumMin || '';
      const defaultSumMax = defaults.sumMax || '';

      if (!eqArrays(draft.workTypes || [], defaultWorkTypes)) return true;
      if (!eqArrays(draft.statuses || [], defaultStatuses)) return true;
      if ((draft.executorId ?? null) !== defaultExecutorId) return true;
      if ((draft.departureDateFrom ?? null) !== defaultDateFrom) return true;
      if ((draft.departureDateTo ?? null) !== defaultDateTo) return true;
      if ((draft.departureTimeFrom ?? null) !== defaultTimeFrom) return true;
      if ((draft.departureTimeTo ?? null) !== defaultTimeTo) return true;
      if (String(draft.sumMin || '') !== String(defaultSumMin || '')) return true;
      if (String(draft.sumMax || '') !== String(defaultSumMax || '')) return true;
      return false;
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
  }, [assignmentDefaultSelection, assignmentDraftSelection, defaults, draft, isAssignmentMode, isObjectsMode, isOrdersMode]);

  const handleAssignmentReset = () => {
    const defaultSelection = [...assignmentDefaultSelection];
    setAssignmentDraftSelection(defaultSelection);
    setAssignmentBaselineSelection(defaultSelection);
    if (typeof assignment?.onReset === 'function') {
      assignment.onReset(isAssignmentMulti ? defaultSelection : (defaultSelection[0] ?? null));
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
  const toggleObjectsMulti = (key, value) => {
    const safeValue = String(value || '').trim();
    if (!safeValue) return;
    setDraft((prev) => {
      const current = Array.isArray(prev[key]) ? prev[key].map(String) : [];
      const next = current.includes(safeValue)
        ? current.filter((v) => v !== safeValue)
        : [...current, safeValue];
      return { ...prev, [key]: next };
    });
  };
  const toggleOrdersMulti = (key, value) => {
    const safeValue = String(value || '').trim();
    if (!safeValue) return;
    setDraft((prev) => {
      const current = Array.isArray(prev[key]) ? prev[key].map(String) : [];
      const next = current.includes(safeValue)
        ? current.filter((v) => v !== safeValue)
        : [...current, safeValue];
      return { ...prev, [key]: next };
    });
  };
  const normalizeDateInput = (text) => {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const cleaned = raw.replace(/\./g, '-').replace(/\//g, '-');
    const match = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return raw;
    return `${match[1]}-${match[2]}-${match[3]}`;
  };
  const normalizeTimeInput = (text) => {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const match = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return raw;
    const hh = Math.max(0, Math.min(23, Number(match[1]) || 0));
    const mm = Math.max(0, Math.min(59, Number(match[2]) || 0));
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };
  const normalizeNumberInput = (text) =>
    String(text || '')
      .replace(/[^0-9.,]/g, '')
      .replace(',', '.');

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
      previewRow: {
        paddingHorizontal: sz.md,
        paddingBottom: sz.xs,
      },
      previewText: {
        color: c.textSecondary,
        fontSize: ty.sizes.sm,
        fontWeight: ty.weight.medium,
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
      inlineSearchBox: {
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: rad.md,
        overflow: 'hidden',
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
  }, [c, sz, ty, sh, rad.md, BACK_BUTTON_SIZE, OVERLAY_Z_INDEX, RATIO_MIN, RATIO_MAX, theme]);

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
  const resolvedPreviewCount = useMemo(() => {
    if (typeof previewCountResolver === 'function') {
      try {
        const next = previewCountResolver(draft);
        return Number.isFinite(Number(next)) ? Number(next) : null;
      } catch {
        return null;
      }
    }
    if (previewCountValue == null) return null;
    return Number.isFinite(Number(previewCountValue)) ? Number(previewCountValue) : null;
  }, [draft, previewCountResolver, previewCountValue]);
  const previewCaption = previewCountLabel || t('common_found', 'Найдено');
  const resolvedPreviewStatus = useMemo(() => {
    if (typeof previewStatusResolver !== 'function') return null;
    try {
      return (
        previewStatusResolver({
          draft,
          defaults,
          count: resolvedPreviewCount,
          mode,
        }) || null
      );
    } catch {
      return null;
    }
  }, [defaults, draft, mode, previewStatusResolver, resolvedPreviewCount]);
  const shouldShowPreview =
    resolvedPreviewStatus?.visible != null
      ? Boolean(resolvedPreviewStatus.visible)
      : resolvedPreviewCount != null;
  const previewColor = resolvedPreviewStatus?.color || c.textSecondary;
  const inlineSearchCategoryKeys = useMemo(
    () =>
      Array.isArray(inlineOptionSearch?.categoryKeys)
        ? inlineOptionSearch.categoryKeys.map((key) => String(key))
        : EMPTY_ARRAY,
    [inlineOptionSearch?.categoryKeys],
  );
  const inlineSearchEnabled = Boolean(
    activeCat &&
      inlineSearchCategoryKeys.length > 0 &&
      inlineSearchCategoryKeys.includes(String(activeCat)),
  );
  const normalizedInlineSearch = useMemo(
    () => String(inlineSearchQuery || '').trim().toLowerCase(),
    [inlineSearchQuery],
  );

  const renderInlineOptionsSearch = () => {
    if (!inlineSearchEnabled) return null;
    return (
      <View style={styles.searchFieldWrap}>
        <View style={styles.inlineSearchBox}>
          <TextField
            placeholder={t('common_search')}
            value={inlineSearchQuery}
            onChangeText={setInlineSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
            hideSeparator={true}
            rightSlot={
              inlineSearchQuery ? (
                <Pressable
                  android_ripple={{ borderless: true, color: withAlpha(c.border, 0.1) }}
                  onPress={() => setInlineSearchQuery('')}
                  style={{ padding: 4 }}
                >
                  <Feather name="x" size={16} color={c.textSecondary} />
                </Pressable>
              ) : null
            }
          />
        </View>
      </View>
    );
  };

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
    const selected = empId ? (assignmentDraftSelection || []).includes(empId) : false;
    const name = emp.display_name || emp.email || t('common_noName');
    return (
      <Pressable
        key={empId || `emp-${idx}`}
        onPress={() => {
          if (!empId) return;
          if (isAssignmentMulti) {
            setAssignmentDraftSelection((prev) => {
              const current = Array.isArray(prev) ? prev : [];
              return current.includes(empId)
                ? current.filter((id) => id !== empId)
                : [...current, empId];
            });
            return;
          }
          setAssignmentDraftSelection([empId]);
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
      case 'objects_cities': {
        const citiesRaw = Array.isArray(objectFilters?.cities) ? objectFilters.cities : [];
        const cities = normalizedInlineSearch
          ? citiesRaw.filter((city) =>
              String(city?.label ?? city?.name ?? city?.value ?? city?.id ?? '')
                .toLowerCase()
                .includes(normalizedInlineSearch),
            )
          : citiesRaw;
        const allSelected = !Array.isArray(draft.cities) || draft.cities.length === 0;
        return (
          <>
            {renderInlineOptionsSearch()}
            <Pressable
              key="all_objects_cities"
              onPress={() => setDraft((d) => ({ ...d, cities: [] }))}
              style={({ pressed }) => [
                optionRow,
                pressed && { backgroundColor: withAlpha(c.border, ALPHA_PRESSED) },
              ]}
            >
              <View style={[checkboxBase, allSelected && checkboxSelected]}>
                {allSelected ? <Feather name="check" size={ICON_SIZE_CHECK} color={c.onPrimary} /> : null}
              </View>
              <Text style={[optionLabel, allSelected && { fontWeight: ty.weight.semibold }]}>
                {t('users_showAll')}
              </Text>
            </Pressable>
            {cities.length === 0 ? (
              <View style={{ paddingHorizontal: sz.md, paddingVertical: sz.sm }}>
                <Text style={{ color: c.textSecondary, fontSize: ty.sizes.sm }}>{t('common_noData')}</Text>
              </View>
            ) : (
              cities.map((city) => {
                const id = String(city?.value ?? city?.id ?? city?.label ?? '').trim();
                const label = String(city?.label ?? city?.name ?? id).trim();
                const selected = Array.isArray(draft.cities) ? draft.cities.includes(id) : false;
                return (
                  <Pressable
                    key={`objects_city_${id}`}
                    onPress={() => toggleObjectsMulti('cities', id)}
                    style={({ pressed }) => [
                      optionRow,
                      pressed && { backgroundColor: withAlpha(c.border, ALPHA_PRESSED) },
                    ]}
                  >
                    <View style={[checkboxBase, selected && checkboxSelected]}>
                      {selected ? <Feather name="check" size={ICON_SIZE_CHECK} color={c.onPrimary} /> : null}
                    </View>
                    <Text style={[optionLabel, selected && { fontWeight: ty.weight.semibold }]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </>
        );
      }
      case 'objects_streets': {
        const streetsRaw = Array.isArray(objectFilters?.streets) ? objectFilters.streets : [];
        const streets = normalizedInlineSearch
          ? streetsRaw.filter((street) =>
              String(street?.label ?? street?.name ?? street?.value ?? street?.id ?? '')
                .toLowerCase()
                .includes(normalizedInlineSearch),
            )
          : streetsRaw;
        const allSelected = !Array.isArray(draft.streets) || draft.streets.length === 0;
        return (
          <>
            {renderInlineOptionsSearch()}
            <Pressable
              key="all_objects_streets"
              onPress={() => setDraft((d) => ({ ...d, streets: [] }))}
              style={({ pressed }) => [
                optionRow,
                pressed && { backgroundColor: withAlpha(c.border, ALPHA_PRESSED) },
              ]}
            >
              <View style={[checkboxBase, allSelected && checkboxSelected]}>
                {allSelected ? <Feather name="check" size={ICON_SIZE_CHECK} color={c.onPrimary} /> : null}
              </View>
              <Text style={[optionLabel, allSelected && { fontWeight: ty.weight.semibold }]}>
                {t('users_showAll')}
              </Text>
            </Pressable>
            {streets.length === 0 ? (
              <View style={{ paddingHorizontal: sz.md, paddingVertical: sz.sm }}>
                <Text style={{ color: c.textSecondary, fontSize: ty.sizes.sm }}>{t('common_noData')}</Text>
              </View>
            ) : (
              streets.map((street) => {
                const id = String(street?.value ?? street?.id ?? street?.label ?? '').trim();
                const label = String(street?.label ?? street?.name ?? id).trim();
                const selected = Array.isArray(draft.streets) ? draft.streets.includes(id) : false;
                return (
                  <Pressable
                    key={`objects_street_${id}`}
                    onPress={() => toggleObjectsMulti('streets', id)}
                    style={({ pressed }) => [
                      optionRow,
                      pressed && { backgroundColor: withAlpha(c.border, ALPHA_PRESSED) },
                    ]}
                  >
                    <View style={[checkboxBase, selected && checkboxSelected]}>
                      {selected ? <Feather name="check" size={ICON_SIZE_CHECK} color={c.onPrimary} /> : null}
                    </View>
                    <Text style={[optionLabel, selected && { fontWeight: ty.weight.semibold }]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </>
        );
      }
      case 'objects_clients': {
        const clientsRaw = Array.isArray(objectFilters?.clients) ? objectFilters.clients : [];
        const clients = normalizedInlineSearch
          ? clientsRaw.filter((client) =>
              String(client?.label ?? client?.name ?? client?.value ?? client?.id ?? '')
                .toLowerCase()
                .includes(normalizedInlineSearch),
            )
          : clientsRaw;
        const allSelected = !Array.isArray(draft.clientIds) || draft.clientIds.length === 0;
        return (
          <>
            {renderInlineOptionsSearch()}
            <Pressable
              key="all_objects_clients"
              onPress={() => setDraft((d) => ({ ...d, clientIds: [] }))}
              style={({ pressed }) => [
                optionRow,
                pressed && { backgroundColor: withAlpha(c.border, ALPHA_PRESSED) },
              ]}
            >
              <View style={[checkboxBase, allSelected && checkboxSelected]}>
                {allSelected ? <Feather name="check" size={ICON_SIZE_CHECK} color={c.onPrimary} /> : null}
              </View>
              <Text style={[optionLabel, allSelected && { fontWeight: ty.weight.semibold }]}>
                {t('users_showAll')}
              </Text>
            </Pressable>
            {clients.length === 0 ? (
              <View style={{ paddingHorizontal: sz.md, paddingVertical: sz.sm }}>
                <Text style={{ color: c.textSecondary, fontSize: ty.sizes.sm }}>{t('common_noData')}</Text>
              </View>
            ) : (
              clients.map((client) => {
                const id = String(client?.value ?? client?.id ?? client?.label ?? '').trim();
                const label = String(client?.label ?? client?.name ?? id).trim();
                const selected = Array.isArray(draft.clientIds) ? draft.clientIds.includes(id) : false;
                return (
                  <Pressable
                    key={`objects_client_${id}`}
                    onPress={() => toggleObjectsMulti('clientIds', id)}
                    style={({ pressed }) => [
                      optionRow,
                      pressed && { backgroundColor: withAlpha(c.border, ALPHA_PRESSED) },
                    ]}
                  >
                    <View style={[checkboxBase, selected && checkboxSelected]}>
                      {selected ? <Feather name="check" size={ICON_SIZE_CHECK} color={c.onPrimary} /> : null}
                    </View>
                    <Text style={[optionLabel, selected && { fontWeight: ty.weight.semibold }]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </>
        );
      }
      case 'orders_statuses': {
        const statusOptions = Array.isArray(ordersFilters?.statuses) ? ordersFilters.statuses : [];
        const allSelected = !Array.isArray(draft.statuses) || draft.statuses.length === 0;
        return (
          <>
            <Pressable
              key="all_orders_statuses"
              onPress={() => setDraft((d) => ({ ...d, statuses: [] }))}
              style={({ pressed }) => [
                optionRow,
                pressed && { backgroundColor: withAlpha(c.border, ALPHA_PRESSED) },
              ]}
            >
              <View style={[checkboxBase, allSelected && checkboxSelected]}>
                {allSelected ? <Feather name="check" size={ICON_SIZE_CHECK} color={c.onPrimary} /> : null}
              </View>
              <Text style={[optionLabel, allSelected && { fontWeight: ty.weight.semibold }]}>
                {t('users_showAll')}
              </Text>
            </Pressable>
            {statusOptions.map((statusItem, index) => {
              const id = String(statusItem?.id ?? statusItem?.value ?? index);
              const label = String(statusItem?.label ?? id);
              const selected = Array.isArray(draft.statuses) ? draft.statuses.includes(id) : false;
              return (
                <Pressable
                  key={`orders_status_${id}`}
                  onPress={() => toggleOrdersMulti('statuses', id)}
                  style={({ pressed }) => [
                    optionRow,
                    pressed && { backgroundColor: withAlpha(c.border, ALPHA_PRESSED) },
                  ]}
                >
                  <View style={[checkboxBase, selected && checkboxSelected]}>
                    {selected ? <Feather name="check" size={ICON_SIZE_CHECK} color={c.onPrimary} /> : null}
                  </View>
                  <Text style={[optionLabel, selected && { fontWeight: ty.weight.semibold }]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </>
        );
      }
      case 'orders_workTypes': {
        const workTypes = Array.isArray(ordersFilters?.workTypes) ? ordersFilters.workTypes : [];
        const allSelected = !Array.isArray(draft.workTypes) || draft.workTypes.length === 0;
        return (
          <>
            <Pressable
              key="all_orders_work_types"
              onPress={() => setDraft((d) => ({ ...d, workTypes: [] }))}
              style={({ pressed }) => [
                optionRow,
                pressed && { backgroundColor: withAlpha(c.border, ALPHA_PRESSED) },
              ]}
            >
              <View style={[checkboxBase, allSelected && checkboxSelected]}>
                {allSelected ? <Feather name="check" size={ICON_SIZE_CHECK} color={c.onPrimary} /> : null}
              </View>
              <Text style={[optionLabel, allSelected && { fontWeight: ty.weight.semibold }]}>
                {t('users_showAll')}
              </Text>
            </Pressable>
            {workTypes.map((workType, index) => {
              const id = String(workType?.id ?? workType?.value ?? index);
              const label = String(workType?.label ?? workType?.name ?? id);
              const selected = Array.isArray(draft.workTypes) ? draft.workTypes.includes(id) : false;
              return (
                <Pressable
                  key={`orders_work_type_${id}`}
                  onPress={() => toggleOrdersMulti('workTypes', id)}
                  style={({ pressed }) => [
                    optionRow,
                    pressed && { backgroundColor: withAlpha(c.border, ALPHA_PRESSED) },
                  ]}
                >
                  <View style={[checkboxBase, selected && checkboxSelected]}>
                    {selected ? <Feather name="check" size={ICON_SIZE_CHECK} color={c.onPrimary} /> : null}
                  </View>
                  <Text style={[optionLabel, selected && { fontWeight: ty.weight.semibold }]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </>
        );
      }
      case 'orders_executors': {
        const executors = Array.isArray(ordersFilters?.executors) ? ordersFilters.executors : [];
        const allSelected = draft.executorId == null;
        return (
          <>
            <Pressable
              key="all_orders_executors"
              onPress={() => setDraft((d) => ({ ...d, executorId: null }))}
              style={({ pressed }) => [
                optionRow,
                pressed && { backgroundColor: withAlpha(c.border, ALPHA_PRESSED) },
              ]}
            >
              <View style={[checkboxBase, allSelected && checkboxSelected]}>
                {allSelected ? <Feather name="check" size={ICON_SIZE_CHECK} color={c.onPrimary} /> : null}
              </View>
              <Text style={[optionLabel, allSelected && { fontWeight: ty.weight.semibold }]}>
                {t('users_showAll')}
              </Text>
            </Pressable>
            {executors.map((executor, index) => {
              const id = String(executor?.id ?? executor?.value ?? index);
              const label = String(executor?.label ?? executor?.name ?? id);
              const selected = String(draft.executorId || '') === id;
              return (
                <Pressable
                  key={`orders_executor_${id}`}
                  onPress={() =>
                    setDraft((d) => ({ ...d, executorId: selected ? null : id }))
                  }
                  style={({ pressed }) => [
                    optionRow,
                    pressed && { backgroundColor: withAlpha(c.border, ALPHA_PRESSED) },
                  ]}
                >
                  <View style={[checkboxBase, selected && checkboxSelected]}>
                    {selected ? <Feather name="check" size={ICON_SIZE_CHECK} color={c.onPrimary} /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[optionLabel, selected && { fontWeight: ty.weight.semibold }]}>
                      {label}
                    </Text>
                    {executor?.meta ? (
                      <Text style={{ color: c.textSecondary, fontSize: ty.sizes.sm, marginTop: 2 }}>
                        {executor.meta}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </>
        );
      }
      case 'orders_departure_date':
        return (
          <View style={{ paddingHorizontal: sz.md, paddingTop: sz.sm, gap: sz.sm }}>
            <TextField
              value={draft.departureDateFrom || ''}
              onChangeText={(text) =>
                setDraft((d) => ({ ...d, departureDateFrom: normalizeDateInput(text) }))
              }
              placeholder={t('common_from')}
              hideSeparator
            />
            <TextField
              value={draft.departureDateTo || ''}
              onChangeText={(text) =>
                setDraft((d) => ({ ...d, departureDateTo: normalizeDateInput(text) }))
              }
              placeholder={t('common_to')}
              hideSeparator
            />
          </View>
        );
      case 'orders_departure_time':
        return (
          <View style={{ paddingHorizontal: sz.md, paddingTop: sz.sm, gap: sz.sm }}>
            <TextField
              value={draft.departureTimeFrom || ''}
              onChangeText={(text) =>
                setDraft((d) => ({ ...d, departureTimeFrom: normalizeTimeInput(text) }))
              }
              placeholder={t('common_from')}
              hideSeparator
            />
            <TextField
              value={draft.departureTimeTo || ''}
              onChangeText={(text) =>
                setDraft((d) => ({ ...d, departureTimeTo: normalizeTimeInput(text) }))
              }
              placeholder={t('common_to')}
              hideSeparator
            />
          </View>
        );
      case 'orders_amount':
        return (
          <View style={{ paddingHorizontal: sz.md, paddingTop: sz.sm, gap: sz.sm }}>
            <TextField
              value={String(draft.sumMin || '')}
              onChangeText={(text) => setDraft((d) => ({ ...d, sumMin: normalizeNumberInput(text) }))}
              placeholder={t('common_from')}
              hideSeparator
              keyboardType="numeric"
            />
            <TextField
              value={String(draft.sumMax || '')}
              onChangeText={(text) => setDraft((d) => ({ ...d, sumMax: normalizeNumberInput(text) }))}
              placeholder={t('common_to')}
              hideSeparator
              keyboardType="numeric"
            />
          </View>
        );
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
            {rolesOptions.map((r, idx) => {
              const selected = Array.isArray(draft.roles) ? draft.roles.includes(r.value) : false;
              const roleKey = String(r?.id ?? r?.value ?? `role-${idx}`);
              return (
                <Pressable
                  key={roleKey}
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
                setAssignmentDraftSelection([...(assignmentBaselineSelection || [])]);
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
                if (isObjectsMode) {
                  const emptyCities = Array.isArray(defaults.cities) ? defaults.cities.map(String) : [];
                  const emptyStreets = Array.isArray(defaults.streets) ? defaults.streets.map(String) : [];
                  const emptyClientIds = Array.isArray(defaults.clientIds) ? defaults.clientIds.map(String) : [];
                  const snapshot = {
                    ...draft,
                    cities: emptyCities,
                    streets: emptyStreets,
                    clientIds: emptyClientIds,
                  };
                  setDraft(snapshot);
                  setBaseline(snapshot);
                  if (setValue) {
                    setValue('cities', emptyCities);
                    setValue('streets', emptyStreets);
                    setValue('clientIds', emptyClientIds);
                  }
                  if (onApply) onApply(snapshot);
                  return;
                }
                if (isOrdersMode) {
                  const snapshot = {
                    workTypes: Array.isArray(defaults.workTypes) ? defaults.workTypes.map(String) : [],
                    statuses: Array.isArray(defaults.statuses) ? defaults.statuses.map(String) : [],
                    executorId:
                      defaults.executorId === null || defaults.executorId === undefined
                        ? null
                        : String(defaults.executorId),
                    departureDateFrom: defaults.departureDateFrom || null,
                    departureDateTo: defaults.departureDateTo || null,
                    departureTimeFrom: defaults.departureTimeFrom || null,
                    departureTimeTo: defaults.departureTimeTo || null,
                    sumMin: defaults.sumMin || '',
                    sumMax: defaults.sumMax || '',
                  };
                  setDraft((prev) => ({ ...prev, ...snapshot }));
                  setBaseline((prev) => ({ ...prev, ...snapshot }));
                  if (setValue) {
                    setValue('workTypes', snapshot.workTypes);
                    setValue('statuses', snapshot.statuses);
                    setValue('executorId', snapshot.executorId);
                    setValue('departureDateFrom', snapshot.departureDateFrom);
                    setValue('departureDateTo', snapshot.departureDateTo);
                    setValue('departureTimeFrom', snapshot.departureTimeFrom);
                    setValue('departureTimeTo', snapshot.departureTimeTo);
                    setValue('sumMin', snapshot.sumMin);
                    setValue('sumMax', snapshot.sumMax);
                  }
                  if (onApply) onApply(snapshot);
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
                  onApply(snapshot);
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
        {shouldShowPreview && resolvedPreviewCount != null ? (
          <View style={styles.previewRow}>
            <Text style={[styles.previewText, { color: previewColor }]}>
              {`${previewCaption}: ${resolvedPreviewCount}`}
            </Text>
          </View>
        ) : null}

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
                  const selection = [...(assignmentDraftSelection || [])];
                  if (typeof assignment?.onApply === 'function') {
                    assignment.onApply(isAssignmentMulti ? selection : (selection[0] ?? null));
                  }
                  setAssignmentBaselineSelection(selection);
                  setAssignmentDraftSelection(selection);
                  if (onClose) onClose();
                  return;
                }
                if (isObjectsMode) {
                  if (setValue) {
                    setValue('cities', Array.isArray(draft.cities) ? draft.cities : []);
                    setValue('streets', Array.isArray(draft.streets) ? draft.streets : []);
                    setValue('clientIds', Array.isArray(draft.clientIds) ? draft.clientIds : []);
                  }
                  const objectSnapshot = {
                    cities: Array.isArray(draft.cities) ? draft.cities : [],
                    streets: Array.isArray(draft.streets) ? draft.streets : [],
                    clientIds: Array.isArray(draft.clientIds) ? draft.clientIds : [],
                  };
                  if (onApply) onApply(objectSnapshot);
                  setBaseline((prev) => ({
                    ...prev,
                    cities: Array.isArray(draft.cities) ? draft.cities : [],
                    streets: Array.isArray(draft.streets) ? draft.streets : [],
                    clientIds: Array.isArray(draft.clientIds) ? draft.clientIds : [],
                  }));
                  if (onClose) onClose();
                  return;
                }
                if (isOrdersMode) {
                  const ordersSnapshot = {
                    workTypes: Array.isArray(draft.workTypes) ? draft.workTypes : [],
                    statuses: Array.isArray(draft.statuses) ? draft.statuses : [],
                    executorId: draft.executorId ?? null,
                    departureDateFrom: draft.departureDateFrom ?? null,
                    departureDateTo: draft.departureDateTo ?? null,
                    departureTimeFrom: draft.departureTimeFrom ?? null,
                    departureTimeTo: draft.departureTimeTo ?? null,
                    sumMin: draft.sumMin || '',
                    sumMax: draft.sumMax || '',
                  };
                  if (setValue) {
                    setValue('workTypes', ordersSnapshot.workTypes);
                    setValue('statuses', ordersSnapshot.statuses);
                    setValue('executorId', ordersSnapshot.executorId);
                    setValue('departureDateFrom', ordersSnapshot.departureDateFrom);
                    setValue('departureDateTo', ordersSnapshot.departureDateTo);
                    setValue('departureTimeFrom', ordersSnapshot.departureTimeFrom);
                    setValue('departureTimeTo', ordersSnapshot.departureTimeTo);
                    setValue('sumMin', ordersSnapshot.sumMin);
                    setValue('sumMax', ordersSnapshot.sumMax);
                  }
                  if (onApply) onApply(ordersSnapshot);
                  setBaseline((prev) => ({ ...prev, ...ordersSnapshot }));
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
                const usersSnapshot = {
                  departments: Array.isArray(draft.departments) ? draft.departments : [],
                  roles: Array.isArray(draft.roles) ? draft.roles : [],
                  suspended: draft.suspended ?? null,
                };
                if (onApply) onApply(usersSnapshot);
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
