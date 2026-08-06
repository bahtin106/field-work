import Feather from '@expo/vector-icons/Feather';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTranslation } from '../../src/i18n/useTranslation';
import { useTheme } from '../../theme/ThemeProvider';
import { withAlpha } from '../../theme/colors';
import Button from '../ui/Button';
import TextField from '../ui/TextField';
import AnimatedFullscreenModal from '../ui/modals/AnimatedFullscreenModal';

const EMPTY_FILTERS = Object.freeze({
  employeeIds: [],
  departmentIds: [],
  includeNoDepartment: false,
  workTypeIds: [],
  includeNoWorkType: false,
});

function normalizeIds(values) {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function normalizeFilters(value = EMPTY_FILTERS) {
  return {
    employeeIds: normalizeIds(value.employeeIds),
    departmentIds: normalizeIds(value.departmentIds),
    includeNoDepartment: value.includeNoDepartment === true,
    workTypeIds: normalizeIds(value.workTypeIds),
    includeNoWorkType: value.includeNoWorkType === true,
  };
}

function areSameIds(left, right) {
  const a = normalizeIds(left).sort();
  const b = normalizeIds(right).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function areSameFilters(left, right) {
  return (
    areSameIds(left?.employeeIds, right?.employeeIds)
    && areSameIds(left?.departmentIds, right?.departmentIds)
    && Boolean(left?.includeNoDepartment) === Boolean(right?.includeNoDepartment)
    && areSameIds(left?.workTypeIds, right?.workTypeIds)
    && Boolean(left?.includeNoWorkType) === Boolean(right?.includeNoWorkType)
  );
}

function matchesQuery(item, query) {
  if (!query) return true;
  const source = `${item?.label || ''} ${item?.subtitle || ''}`.toLowerCase();
  return source.includes(query);
}

export default function StatisticsFiltersPanel({
  visible,
  value,
  employees = [],
  departments = [],
  useDepartments = false,
  workTypes = [],
  useWorkTypes = false,
  onApply,
  onClose,
}) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const s = React.useMemo(() => styles(theme), [theme]);
  const normalizedValue = React.useMemo(
    () => normalizeFilters(value),
    [value],
  );
  const sections = React.useMemo(
    () => [
      { id: 'employees', label: t('stats_employees'), visible: Array.isArray(employees) && employees.length > 0 },
      { id: 'departments', label: t('stats_departments'), visible: useDepartments === true },
      { id: 'work-types', label: t('stats_work_types'), visible: useWorkTypes === true },
    ].filter((section) => section.visible),
    [employees, t, useDepartments, useWorkTypes],
  );
  const [draft, setDraft] = React.useState(normalizedValue);
  const [baseline, setBaseline] = React.useState(normalizedValue);
  const [activeSection, setActiveSection] = React.useState('employees');
  const [query, setQuery] = React.useState('');

  React.useEffect(() => {
    if (!visible) return;
    setDraft(normalizedValue);
    setBaseline(normalizedValue);
    setQuery('');
    setActiveSection((current) => (
      sections.some((section) => section.id === current)
        ? current
        : sections[0]?.id || 'employees'
    ));
  }, [normalizedValue, sections, visible]);

  const hasChanges = !areSameFilters(draft, baseline);
  const hasActiveFilters = draft.employeeIds.length > 0
    || draft.departmentIds.length > 0
    || draft.includeNoDepartment
    || draft.workTypeIds.length > 0
    || draft.includeNoWorkType;
  const normalizedQuery = String(query || '').trim().toLowerCase();
  const visibleEmployees = React.useMemo(
    () => (Array.isArray(employees) ? employees : []).filter((item) => matchesQuery(item, normalizedQuery)),
    [employees, normalizedQuery],
  );
  const visibleDepartments = React.useMemo(
    () => (Array.isArray(departments) ? departments : []).filter((item) => matchesQuery(item, normalizedQuery)),
    [departments, normalizedQuery],
  );
  const visibleWorkTypes = React.useMemo(
    () => (Array.isArray(workTypes) ? workTypes : []).filter((item) => matchesQuery(item, normalizedQuery)),
    [normalizedQuery, workTypes],
  );

  const closeWithoutApplying = React.useCallback(() => {
    setDraft(baseline);
    onClose?.();
  }, [baseline, onClose]);
  const applyDraft = React.useCallback(() => {
    const next = normalizeFilters(draft);
    onApply?.(next);
    setBaseline(next);
    onClose?.();
  }, [draft, onApply, onClose]);
  const resetFilters = React.useCallback(() => {
    const next = normalizeFilters(EMPTY_FILTERS);
    setDraft(next);
    setBaseline(next);
    onApply?.(next);
  }, [onApply]);
  const toggleEmployee = React.useCallback((id) => {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) return;
    setDraft((current) => ({
      ...current,
      employeeIds: current.employeeIds.includes(normalizedId)
        ? current.employeeIds.filter((value) => value !== normalizedId)
        : [...current.employeeIds, normalizedId],
    }));
  }, []);
  const toggleDepartment = React.useCallback((id) => {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) return;
    setDraft((current) => ({
      ...current,
      departmentIds: current.departmentIds.includes(normalizedId)
        ? current.departmentIds.filter((value) => value !== normalizedId)
        : [...current.departmentIds, normalizedId],
    }));
  }, []);
  const toggleWorkType = React.useCallback((id) => {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) return;
    setDraft((current) => ({
      ...current,
      workTypeIds: current.workTypeIds.includes(normalizedId)
        ? current.workTypeIds.filter((value) => value !== normalizedId)
        : [...current.workTypeIds, normalizedId],
    }));
  }, []);

  const renderCheckbox = (selected) => (
    <View style={[s.checkbox, selected && s.checkboxSelected]}>
      {selected ? <Feather name="check" size={theme.icons.sm} color={theme.colors.onPrimary} strokeWidth={3} /> : null}
    </View>
  );
  const renderOption = ({ id, label, subtitle, selected, onPress, testID }) => (
    <Pressable
      key={testID || id}
      onPress={onPress}
      style={({ pressed }) => [s.optionRow, pressed && s.pressed]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
    >
      {renderCheckbox(selected)}
      <View style={s.optionText}>
        <Text style={[s.optionLabel, selected && s.optionLabelSelected]} numberOfLines={1}>{label}</Text>
        {subtitle ? <Text style={s.optionSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
    </Pressable>
  );

  const options = activeSection === 'employees'
    ? (
      <>
        {renderOption({
          id: 'all-employees',
          label: t('stats_all_employees'),
          selected: draft.employeeIds.length === 0,
          onPress: () => setDraft((current) => ({ ...current, employeeIds: [] })),
        })}
        {visibleEmployees.map((employee) => renderOption({
          id: employee.value || employee.id,
          label: employee.label,
          subtitle: employee.subtitle,
          selected: draft.employeeIds.includes(String(employee.value || employee.id)),
          onPress: () => toggleEmployee(employee.value || employee.id),
        }))}
      </>
    )
    : activeSection === 'departments'
      ? (
      <>
        {renderOption({
          id: 'all-departments',
          label: t('stats_all_departments'),
          selected: draft.departmentIds.length === 0 && !draft.includeNoDepartment,
          onPress: () => setDraft((current) => ({ ...current, departmentIds: [], includeNoDepartment: false })),
        })}
        {renderOption({
          id: 'no-department',
          label: t('stats_without_department'),
          selected: draft.includeNoDepartment,
          onPress: () => setDraft((current) => ({ ...current, includeNoDepartment: !current.includeNoDepartment })),
        })}
        {visibleDepartments.map((department) => renderOption({
          id: department.value || department.id,
          label: department.label,
          subtitle: department.subtitle,
          selected: draft.departmentIds.includes(String(department.value || department.id)),
          onPress: () => toggleDepartment(department.value || department.id),
        }))}
      </>
    )
    : (
      <>
        {renderOption({
          id: 'all-work-types',
          label: t('stats_all_work_types'),
          selected: draft.workTypeIds.length === 0 && !draft.includeNoWorkType,
          onPress: () => setDraft((current) => ({ ...current, workTypeIds: [], includeNoWorkType: false })),
        })}
        {renderOption({
          id: 'no-work-type',
          label: t('stats_without_work_type'),
          selected: draft.includeNoWorkType,
          onPress: () => setDraft((current) => ({ ...current, includeNoWorkType: !current.includeNoWorkType })),
        })}
        {visibleWorkTypes.map((workType) => renderOption({
          id: workType.value || workType.id,
          label: workType.label,
          subtitle: workType.subtitle,
          selected: draft.workTypeIds.includes(String(workType.value || workType.id)),
          onPress: () => toggleWorkType(workType.value || workType.id),
        }))}
      </>
    );

  return (
    <AnimatedFullscreenModal
      visible={visible}
      onRequestClose={closeWithoutApplying}
      statusBarTranslucent
    >
      <SafeAreaView style={s.safeArea} edges={['top', 'bottom']}>
        <View style={s.header}>
          <Pressable
            onPress={closeWithoutApplying}
            style={({ pressed }) => [s.backButton, pressed && s.pressed]}
            hitSlop={theme.components.interactive?.hitSlop ?? 8}
            accessibilityRole="button"
            accessibilityLabel={t('common_back')}
          >
            <Feather name="chevron-left" size={theme.icons.md} color={theme.colors.text} />
          </Pressable>
          <Text style={s.title}>{t('stats_filters')}</Text>
          {hasActiveFilters ? (
            <Pressable
              onPress={resetFilters}
              style={({ pressed }) => [s.resetButton, pressed && s.pressed]}
              accessibilityRole="button"
              accessibilityLabel={t('stats_reset_filters')}
            >
              <Text style={s.resetText}>{t('stats_reset_filters')}</Text>
            </Pressable>
          ) : <View style={s.resetButton} />}
        </View>

        <Text style={s.hint}>{t('stats_filters_help')}</Text>

        <View style={s.content}>
          <View style={s.categories}>
            {sections.map((section) => {
              const active = section.id === activeSection;
              return (
                <Pressable
                  key={section.id}
                  onPress={() => {
                    setActiveSection(section.id);
                    setQuery('');
                  }}
                  style={({ pressed }) => [s.category, active && s.categoryActive, pressed && s.pressed]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[s.categoryText, active && s.categoryTextActive]} numberOfLines={2}>
                    {section.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={s.options}>
            <View style={s.searchWrap}>
              <TextField
                value={query}
                onChangeText={setQuery}
                placeholder={t('common_search')}
                autoCapitalize="none"
                autoCorrect={false}
                hideSeparator
                rightSlot={query ? (
                  <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('common_clear')}>
                    <Feather name="x" size={theme.icons.sm} color={theme.colors.textSecondary} />
                  </Pressable>
                ) : <Feather name="search" size={theme.icons.sm} color={theme.colors.textSecondary} />}
              />
            </View>
            <ScrollView contentContainerStyle={s.optionsContent} keyboardShouldPersistTaps="handled">
              {options}
              {activeSection === 'employees' && visibleEmployees.length === 0 && normalizedQuery ? (
                <Text style={s.emptyText}>{t('empty_noResults')}</Text>
              ) : null}
              {activeSection === 'departments' && visibleDepartments.length === 0 && normalizedQuery ? (
                <Text style={s.emptyText}>{t('empty_noResults')}</Text>
              ) : null}
              {activeSection === 'work-types' && visibleWorkTypes.length === 0 && normalizedQuery ? (
                <Text style={s.emptyText}>{t('empty_noResults')}</Text>
              ) : null}
            </ScrollView>
          </View>
        </View>

        {hasChanges ? (
          <View style={s.applyBar}>
            <Button title={t('btn_apply')} onPress={applyDraft} />
          </View>
        ) : null}
      </SafeAreaView>
    </AnimatedFullscreenModal>
  );
}

const styles = (theme) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    minHeight: theme.components.input.height,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  backButton: {
    width: theme.components.input.height,
    height: theme.components.input.height,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.pill,
  },
  title: {
    flex: 1,
    color: theme.colors.text,
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weight.bold,
    textAlign: 'center',
  },
  resetButton: {
    width: theme.spacing.xxl * 2 + theme.spacing.lg,
    minHeight: theme.components.input.height,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  resetText: {
    color: theme.colors.primary,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weight.semibold,
  },
  hint: {
    color: theme.colors.textSecondary,
    fontSize: theme.typography.sizes.sm,
    lineHeight: Math.round(theme.typography.sizes.sm * theme.typography.lineHeights.relaxed),
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  content: { flex: 1, flexDirection: 'row', minHeight: 0 },
  categories: {
    width: '35%',
    maxWidth: theme.spacing.xxl * 5 + theme.spacing.sm,
    minWidth: theme.spacing.xxl * 4,
    paddingTop: theme.spacing.xs,
    backgroundColor: theme.colors.button.secondaryBg,
  },
  category: {
    minHeight: theme.components.listItem.height,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
    borderLeftWidth: theme.spacing.xs,
    borderLeftColor: 'transparent',
  },
  categoryActive: {
    borderLeftColor: theme.colors.primary,
    backgroundColor: theme.colors.surface,
  },
  categoryText: { color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm },
  categoryTextActive: { color: theme.colors.text, fontWeight: theme.typography.weight.semibold },
  options: { flex: 1, minWidth: 0, backgroundColor: theme.colors.surface },
  searchWrap: {
    margin: theme.spacing.md,
    borderWidth: theme.components.button.borderWidth,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.inputBg,
    overflow: 'hidden',
  },
  optionsContent: { paddingBottom: theme.spacing.lg },
  optionRow: {
    minHeight: theme.components.listItem.height,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  checkbox: {
    width: theme.components.checkbox?.size ?? theme.spacing.lg,
    height: theme.components.checkbox?.size ?? theme.spacing.lg,
    borderWidth: theme.components.checkbox?.borderWidth ?? theme.components.button.borderWidth,
    borderColor: theme.colors.inputBorder,
    borderRadius: theme.components.checkbox?.radius ?? theme.radii.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  optionText: { flex: 1, minWidth: 0 },
  optionLabel: { color: theme.colors.text, fontSize: theme.typography.sizes.md },
  optionLabelSelected: { fontWeight: theme.typography.weight.semibold },
  optionSubtitle: { color: theme.colors.textSecondary, fontSize: theme.typography.sizes.xs, marginTop: theme.spacing.xs },
  emptyText: { color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm, padding: theme.spacing.md },
  applyBar: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
    backgroundColor: withAlpha(theme.colors.surface, 0.98),
  },
  pressed: { opacity: theme.components.interactive?.pressedOpacity ?? 0.72 },
});
