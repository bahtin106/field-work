// src/i18n/index.js
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import ru from './ru';

function applyReleaseLegalCopy(dict, locale) {
  if (!dict || typeof dict !== 'object') return dict;
  const isEnglish = locale === 'en';
  dict.privacy_policy_body = isEnglish
    ? 'The current privacy policy is published at https://monitorapp.ru/privacy. For privacy requests, contact support@monitorapp.ru. Account and associated data deletion instructions: https://monitorapp.ru/data-deletion.'
    : 'Актуальная политика обработки персональных данных опубликована на https://monitorapp.ru/privacy. По вопросам обработки данных: support@monitorapp.ru. Порядок удаления аккаунта и связанных данных: https://monitorapp.ru/data-deletion.';
  dict.settings_sections_legal_title = isEnglish ? 'Documents and data' : 'Документы и данные';
  dict['settings_sections_legal_items_privacy-policy'] = isEnglish
    ? 'Privacy policy'
    : 'Политика обработки персональных данных';
  dict.settings_sections_legal_items_terms = isEnglish ? 'Terms of service' : 'Публичная оферта';
  dict['settings_sections_legal_items_delete-account'] = isEnglish
    ? 'Delete account and data'
    : 'Удалить аккаунт и данные';
  return dict;
}

applyReleaseLegalCopy(ru, 'ru');

// --- simple global store ---
let _dict = ru; // default dictionary
let _locale = 'ru';
let _version = 0;
const _listeners = new Set();

function notify() {
  _version++;
  _listeners.forEach((fn) => {
    try {
      fn(_version);
    } catch {}
  });
}

export function getLocale() {
  return _locale;
}
export function getDict() {
  return _dict;
}
export function getVersion() {
  return _version;
}

// Какие языки показываем в UI-переключателе
// Карта загрузчиков словарей (добавишь файлы по мере надобности)
const loaders = {
  ru: async () => (await import('./ru')).default,
  en: async () => (await import('./en')).default,
};

export const availableLocales = Object.freeze(Object.keys(loaders));
export const getSupportedLocales = () => availableLocales;

const STORAGE_KEY = '@i18n_locale';

// Вызови один раз при старте приложения (например, в App.js)
export async function initI18n() {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (saved && saved !== _locale) {
      await setLocale(saved);
      return;
    }
  } catch {}
  // на первый рендер уведомим подписчиков
}

// Меняем язык: строкой ('en') или напрямую объектом словаря
export async function setLocale(next) {
  try {
    let dict = null;
    if (typeof next === 'string') {
      const key = next.toLowerCase();
      if (key === _locale) {
        try {
          await AsyncStorage.setItem(STORAGE_KEY, _locale);
        } catch {}
        return true;
      }
      const loader = loaders[key];
      dict = loader ? applyReleaseLegalCopy(await loader(), key) : null;
      if (!dict) throw new Error('LOCALE_NOT_FOUND');
      _locale = key;
    } else if (next && typeof next === 'object') {
      dict = next;
      _locale = next?.__code || 'custom';
    } else {
      throw new Error('INVALID_LOCALE');
    }
    _dict = dict;
    try {
      await AsyncStorage.setItem(STORAGE_KEY, _locale);
    } catch {}
    notify();
    return true;
  } catch {
    return false;
  }
}

// --- resolver ---
function resolve(obj, path) {
  try {
    if (obj && Object.prototype.hasOwnProperty.call(obj, path)) {
      return obj[path];
    }
    return String(path)
      .split('.')
      .reduce((acc, k) => (acc != null ? acc[k] : undefined), obj);
  } catch {
    return undefined;
  }
}

export function t(key, fallback) {
  let v = resolve(_dict, key);
  return v == null || v === '' ? (fallback ?? key) : String(v);
}
export function getLabel(key, fallback) {
  return t(key, fallback);
}
export const labels = ru; // legacy compatibility

// --- hook for reactivity ---
export function useI18nVersion() {
  const [, setTick] = React.useState(_version);
  React.useEffect(() => {
    const cb = () => setTick((v) => v + 1);
    _listeners.add(cb);
    return () => {
      _listeners.delete(cb);
    };
  }, []);
  return _version;
}
