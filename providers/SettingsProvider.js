// providers/SettingsProvider.js
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';

import { supabase } from '../lib/supabase';

const STORAGE_KEY = 'active_settings_v1';

const SettingsContext = createContext({
  ready: false,
  settings: null,
  refreshSettings: async () => {},
  getFieldByKey: (_key) => null,
  isFieldVisible: (_key, _ctx) => false,
  isFieldRequired: (_key) => false,
  mediaRequirements: [],
  presetsByContext: (_ctx) => ({ fields: [], pills: [], secondary: [] }),
  // admin helpers
  fieldsByMode: async (_mode = 'create') => [],
  reloadFormFields: async () => ({ create: [], edit: [] }),
  addField: async (_mode = 'create') => ({}),
  updateField: async (_row) => ({}),
  deleteField: async (_id) => {},
  moveField: async (_id, _dir = 'up', _mode = 'create') => {},
  saving: false,
});

export const useSettings = () => useContext(SettingsContext);

const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

export default function SettingsProvider({ children }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);

  // ===== SETTINGS =====
  const loadFromCache = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) setSettings(JSON.parse(raw));
    } catch (e) {
      void e; // intentionally ignore
    }
  }, []);

  const saveToCache = useCallback(async (obj) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(obj || {}));
    } catch (e) {
      void e; // intentionally ignore
    }
  }, []);

  const fetchRemote = useCallback(async () => {
    // Р•СЃР»Рё РЅРµС‚ Р°РєС‚РёРІРЅРѕР№ СЃРµСЃСЃРёРё вЂ” РїСЂРѕРїСѓСЃРєР°РµРј СѓРґР°Р»С‘РЅРЅС‹Р№ РІС‹Р·РѕРІ (РёРЅР°С‡Рµ РїСЂРёР»РµС‚Р°РµС‚ permission denied)
    try {
      const { data: ses } = await supabase.auth.getSession();
      if (!ses?.session) return null;
    } catch {
      return null; // РѕС€РёР±РєРё РїРѕР»СѓС‡РµРЅРёСЏ СЃРµСЃСЃРёРё РЅРµ РєСЂРёС‚РёС‡РЅС‹ Р·РґРµСЃСЊ
    }
    const { data, error } = await supabase.rpc('get_active_settings');
    if (error) throw error;
    return data || null;
  }, []);

  const refreshSettings = useCallback(async () => {
    try {
      const data = await fetchRemote();
      if (data) {
        setSettings(data);
        await saveToCache(data);
      }
    } catch (e) {
      // safe console access to avoid eslint no-undef
      globalThis?.console?.warn?.('get_active_settings failed:', e?.message || e);
    }
  }, [fetchRemote, saveToCache]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      await loadFromCache();
      try {
        const data = await fetchRemote();
        if (mounted && data) {
          setSettings(data);
          await saveToCache(data);
        }
      } catch (e) {
        // РўРѕР»СЊРєРѕ Р»РѕРіРёСЂСѓРµРј СЂРµР°Р»СЊРЅС‹Рµ РѕС€РёР±РєРё, РѕС‚СЃСѓС‚СЃС‚РІРёРµ СЃРµСЃСЃРёРё Р±РѕР»СЊС€Рµ РЅРµ РІС‹Р·С‹РІР°РµС‚ РёСЃРєР»СЋС‡РµРЅРёРµ
        globalThis?.console?.warn?.('Initial fetch failed:', e?.message || e);
      } finally {
        if (mounted) setReady(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [fetchRemote, loadFromCache, saveToCache]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshSettings();
    });
    return () => sub.remove();
  }, [refreshSettings]);

  useEffect(() => {
    const ch = supabase
      .channel('settings_versions_active')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_settings_versions' },
        () => refreshSettings(),
      )
      .subscribe();
    return () => {
      try {
        supabase.removeChannel(ch);
      } catch (e) {
        void e; // intentionally ignore
      }
    };
  }, [refreshSettings]);

  const fields = useMemo(
    () => (Array.isArray(settings?.fields) ? settings.fields : []),
    [settings],
  );
  const mediaRequirements = useMemo(
    () => (Array.isArray(settings?.media) ? settings.media : []),
    [settings],
  );
  const presets = useMemo(
    () => (Array.isArray(settings?.presets) ? settings.presets : []),
    [settings],
  );

  const getFieldByKey = useCallback(
    (key) => fields.find((f) => f.field_key === key) || null,
    [fields],
  );
  const isFieldVisible = useCallback(
    (key, ctx) => !!getFieldByKey(key)?.visibility?.[ctx],
    [getFieldByKey],
  );
  const isFieldRequired = useCallback((key) => !!getFieldByKey(key)?.required, [getFieldByKey]);
  const presetsByContext = useCallback(
    (ctx) => {
      const p = presets.find((x) => x.context === ctx);
      return p || { fields: [], pills: [], secondary: [] };
    },
    [presets],
  );

  // ===== ADMIN HELPERS (form fields) =====
  const columnsRef = useRef({ present: new Set(), map: {}, supports: {} });
  const detectColumns = (row) => {
    if (!row) return;
    const present = new Set(Object.keys(row));
    const map = {
      id: present.has('id') ? 'id' : Object.keys(row)[0],
      mode: present.has('mode') ? 'mode' : 'form_mode',
      fieldKey: present.has('key') ? 'key' : 'field_key',
      label: present.has('label') ? 'label' : 'title',
      placeholder: present.has('placeholder') ? 'placeholder' : 'hint',
      help: present.has('help_text') ? 'help_text' : null,
      type: present.has('type') ? 'type' : 'field_type',
      options: present.has('options') ? 'options' : null,
      visible: present.has('is_visible') ? 'is_visible' : null,
      required: present.has('is_required') ? 'is_required' : null,
      order: present.has('sort_order') ? 'sort_order' : 'order_index',
    };
    columnsRef.current = { present, map, supports: {} };
  };
  const canon = (row) => {
    const { map } = columnsRef.current;
    return {
      id: row[map.id],
      mode: row[map.mode],
      key: row[map.fieldKey],
      label: row[map.label] ?? '',
      placeholder: map.placeholder ? (row[map.placeholder] ?? '') : '',
      help_text: map.help ? (row[map.help] ?? '') : '',
      type: map.type ? (row[map.type] ?? 'text') : 'text',
      options: map.options ? (row[map.options] ?? null) : null,
      is_visible: map.visible ? !!row[map.visible] : true,
      is_required: map.required ? !!row[map.required] : false,
      sort_order: map.order ? Number(row[map.order] ?? 0) : 0,
    };
  };
  const decanon = (c) => {
    const { map } = columnsRef.current;
    const out = {};
    out[map.id] = c.id;
    out[map.mode] = c.mode;
    out[map.fieldKey] = c.key;
    out[map.label] = c.label;
    if (map.placeholder) out[map.placeholder] = c.placeholder;
    if (map.help) out[map.help] = c.help_text;
    if (map.type) out[map.type] = c.type;
    if (map.options) out[map.options] = c.options;
    if (map.visible) out[map.visible] = c.is_visible;
    if (map.required) out[map.required] = c.is_required;
    if (map.order) out[map.order] = c.sort_order;
    return out;
  };

  const _fetch = async () => {
    const { data, error } = await supabase.from('app_form_fields').select('*');
    if (error) throw error;
    if (data?.length) detectColumns(data[0]);
    return (data || []).map(canon);
  };
  const _group = (rows) => {
    const by = { create: [], edit: [] };
    rows.forEach((r) => (r.mode === 'edit' ? by.edit.push(r) : by.create.push(r)));
    by.create.sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
    by.edit.sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
    return by;
  };
  const reloadFormFields = async () => _group(await _fetch());
  const fieldsByMode = async (mode) => (await reloadFormFields())[mode];

  const addField = async (mode = 'create') => {
    setSaving(true);
    try {
      const grouped = await reloadFormFields();
      const next = (grouped[mode].at(-1)?.sort_order || 0) + 1;
      const c = {
        id: uuid(),
        mode,
        key: `custom_${next}`,
        label: 'РќРѕРІРѕРµ РїРѕР»Рµ',
        placeholder: '',
        help_text: '',
        type: 'text',
        options: null,
        is_visible: true,
        is_required: false,
        sort_order: next,
      };
      const { error } = await supabase
        .from('app_form_fields')
        .upsert(decanon(c), { onConflict: columnsRef.current.map.id });
      if (error) throw error;
      await refreshSettings();
      return c;
    } finally {
      setSaving(false);
    }
  };

  const updateField = async (row) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('app_form_fields')
        .upsert(decanon(row), { onConflict: columnsRef.current.map.id });
      if (error) throw error;
      await refreshSettings();
      return row;
    } finally {
      setSaving(false);
    }
  };

  const deleteField = async (id) => {
    setSaving(true);
    try {
      const { map } = columnsRef.current;
      const { error } = await supabase.from('app_form_fields').delete().eq(map.id, id);
      if (error) throw error;
      await refreshSettings();
    } finally {
      setSaving(false);
    }
  };

  const moveField = async (id, dir, mode = 'create') => {
    setSaving(true);
    try {
      const list = await fieldsByMode(mode);
      const idx = list.findIndex((r) => r.id === id);
      if (idx < 0) return;
      const swap = dir === 'up' ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= list.length) return;
      const a = { ...list[idx], sort_order: list[swap].sort_order };
      const b = { ...list[swap], sort_order: list[idx].sort_order };
      await supabase
        .from('app_form_fields')
        .upsert([decanon(a), decanon(b)], { onConflict: columnsRef.current.map.id });
      await refreshSettings();
    } finally {
      setSaving(false);
    }
  };

  const value = {
    ready,
    settings,
    refreshSettings,
    getFieldByKey,
    isFieldVisible,
    isFieldRequired,
    mediaRequirements,
    presetsByContext,
    // admin
    fieldsByMode,
    reloadFormFields,
    addField,
    updateField,
    deleteField,
    moveField,
    saving,
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

