import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';
import MonitorMapApps from '../../modules/monitor-map-apps';

export const MAP_APP_PREFERENCE_KEY = '@monitor/map-app-preference/v1';

const MAP_APP_IDS = new Set([
  'yandex_maps',
  'yandex_navigator',
  'google_maps',
  'apple_maps',
]);

const ANDROID_MAP_APP_ID_PATTERN = /^android:[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/;

const MAP_PROBE_TARGET = Object.freeze({
  type: 'coordinates',
  latitude: 55.751244,
  longitude: 37.618423,
});

/** Build a single-line address suitable for map queries. */
export function buildAddressForNavigator(addr = {}) {
  if (!addr || typeof addr !== 'object') return '';
  const parts = [addr.country, addr.region, addr.district, addr.city, addr.street, addr.house, addr.apartment];
  return parts.filter(Boolean).map((part) => String(part).trim()).filter(Boolean).join(', ');
}

function normalizeMapTarget(target) {
  if (target?.type === 'coordinates') {
    const latitude = Number(String(target.latitude ?? '').replace(',', '.'));
    const longitude = Number(String(target.longitude ?? '').replace(',', '.'));
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { type: 'coordinates', latitude, longitude };
    }
  }

  const address = String(target?.address || '').trim();
  if (address) return { type: 'address', address };
  return { type: 'map' };
}

function getTargetQuery(target) {
  const normalized = normalizeMapTarget(target);
  if (normalized.type === 'coordinates') {
    return `${normalized.latitude},${normalized.longitude}`;
  }
  return normalized.type === 'address' ? normalized.address : '';
}

function isValidMapAppId(appId) {
  return MAP_APP_IDS.has(appId) || ANDROID_MAP_APP_ID_PATTERN.test(appId);
}

function buildAndroidGeoUrl(target) {
  const normalized = normalizeMapTarget(target);
  if (normalized.type === 'coordinates') {
    const coordinates = `${normalized.latitude},${normalized.longitude}`;
    return `geo:${coordinates}?q=${encodeURIComponent(coordinates)}`;
  }
  if (normalized.type === 'address') {
    return `geo:0,0?q=${encodeURIComponent(normalized.address)}`;
  }
  return 'geo:0,0';
}

export function buildYandexMapsWebUrl(target) {
  const normalized = normalizeMapTarget(target);
  if (normalized.type === 'coordinates') {
    return `https://yandex.ru/maps/?pt=${encodeURIComponent(`${normalized.longitude},${normalized.latitude}`)}&z=17&l=map`;
  }
  if (normalized.type === 'address') {
    return `https://yandex.ru/maps/?text=${encodeURIComponent(normalized.address)}`;
  }
  return 'https://yandex.ru/maps/';
}

function buildMapAppCandidates(target) {
  const normalized = normalizeMapTarget(target);
  const query = getTargetQuery(normalized);
  const encodedQuery = encodeURIComponent(query);
  const isCoordinates = normalized.type === 'coordinates';

  const yandexMapsUrl = isCoordinates
    ? `yandexmaps://maps.yandex.ru/?ll=${encodeURIComponent(`${normalized.longitude},${normalized.latitude}`)}&z=17`
    : normalized.type === 'address'
      ? `yandexmaps://maps.yandex.ru/?text=${encodedQuery}`
      : 'yandexmaps://maps.yandex.ru/';
  const yandexNavigatorUrl = isCoordinates
    ? `yandexnavi://show_point_on_map?lat=${encodeURIComponent(String(normalized.latitude))}&lon=${encodeURIComponent(String(normalized.longitude))}&zoom=17`
    : normalized.type === 'address'
      ? `yandexnavi://map_search?text=${encodedQuery}`
      : 'yandexnavi://';
  const googleMapsUrl = Platform.OS === 'android'
    ? query
      ? `https://www.google.com/maps/search/?api=1&query=${encodedQuery}`
      : 'https://www.google.com/maps/@?api=1&map_action=map'
    : query
      ? `comgooglemaps://?q=${encodedQuery}${isCoordinates ? `&center=${encodedQuery}` : ''}`
      : 'comgooglemaps://';
  const appleMapsUrl = isCoordinates
    ? `http://maps.apple.com/?ll=${encodedQuery}&q=${encodedQuery}`
    : normalized.type === 'address'
      ? `http://maps.apple.com/?q=${encodedQuery}`
      : 'http://maps.apple.com/';

  return [
    {
      id: 'yandex_maps',
      labelKey: 'map_app_yandex_maps',
      probe: 'yandexmaps://maps.yandex.ru/',
      url: yandexMapsUrl,
    },
    {
      id: 'yandex_navigator',
      labelKey: 'map_app_yandex_navigator',
      probe: 'yandexnavi://',
      url: yandexNavigatorUrl,
    },
    {
      id: 'google_maps',
      labelKey: 'map_app_google_maps',
      probe: Platform.OS === 'android' ? 'google.navigation:q=0,0' : 'comgooglemaps://',
      url: googleMapsUrl,
    },
    ...(Platform.OS === 'ios'
      ? [{
          id: 'apple_maps',
          labelKey: 'map_app_apple_maps',
          probe: 'http://maps.apple.com/',
          url: appleMapsUrl,
        }]
      : []),
  ];
}

export async function buildInstalledMapOptions(target = MAP_PROBE_TARGET) {
  const normalized = normalizeMapTarget(target);
  if (Platform.OS === 'web') return [];

  if (
    Platform.OS === 'android' &&
    typeof MonitorMapApps?.getInstalledMapAppsAsync === 'function'
  ) {
    try {
      const installedApps = await MonitorMapApps.getInstalledMapAppsAsync();
      if (Array.isArray(installedApps)) {
        const geoUrl = buildAndroidGeoUrl(normalized);
        return installedApps
          .map((app) => {
            const packageName = String(app?.packageName || '').trim();
            const id = String(app?.id || `android:${packageName}`).trim();
            const label = String(app?.label || '').trim();
            if (!packageName || !label || !isValidMapAppId(id)) return null;
            return { id, label, packageName, url: geoUrl };
          })
          .filter(Boolean);
      }
    } catch {
      // Native discovery may be unavailable in Expo Go. Known URL schemes below
      // keep development usable without changing release behavior.
    }
  }

  const candidates = buildMapAppCandidates(normalized);
  const checks = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        return (await Linking.canOpenURL(candidate.probe)) ? candidate : null;
      } catch {
        return null;
      }
    }),
  );
  return checks.filter(Boolean);
}

async function readPreferredMapAppId() {
  try {
    const stored = String((await AsyncStorage.getItem(MAP_APP_PREFERENCE_KEY)) || '').trim();
    if (!stored) return null;
    if (isValidMapAppId(stored)) return stored;
    await AsyncStorage.removeItem(MAP_APP_PREFERENCE_KEY);
    return null;
  } catch {
    return null;
  }
}

async function clearPreferredMapAppId() {
  try {
    await AsyncStorage.removeItem(MAP_APP_PREFERENCE_KEY);
  } catch {}
}

export async function setPreferredMapAppId(appId) {
  const normalized = String(appId || '').trim();
  if (!isValidMapAppId(normalized)) return false;
  try {
    await AsyncStorage.setItem(MAP_APP_PREFERENCE_KEY, normalized);
    return true;
  } catch {
    return false;
  }
}

export async function getMapAppPreferenceState(target = MAP_PROBE_TARGET) {
  const options = await buildInstalledMapOptions(target);
  const storedId = await readPreferredMapAppId();
  const selected = options.find((option) => option.id === storedId) || options[0] || null;

  if (selected && selected.id !== storedId) {
    await setPreferredMapAppId(selected.id);
  } else if (!selected && storedId) {
    await clearPreferredMapAppId();
  }

  return {
    options,
    selectedId: selected?.id || null,
  };
}

export async function openPreferredMapTarget(target) {
  const normalized = normalizeMapTarget(target);
  const { options, selectedId } = await getMapAppPreferenceState(normalized);
  const preferred = options.find((option) => option.id === selectedId);
  const fallbacks = options.filter((option) => option.id !== selectedId);

  for (const option of [preferred, ...fallbacks].filter(Boolean)) {
    try {
      if (
        Platform.OS === 'android' &&
        option.packageName &&
        typeof MonitorMapApps?.openMapAppAsync === 'function'
      ) {
        const opened = await MonitorMapApps.openMapAppAsync(option.packageName, option.url);
        if (!opened) continue;
      } else {
        await Linking.openURL(option.url);
      }
      if (option.id !== selectedId) await setPreferredMapAppId(option.id);
      return { opened: true, appId: option.id, fallbackUsed: option.id !== selectedId };
    } catch {
      // The app can be removed between canOpenURL and openURL. Continue with
      // the next installed handler and persist the working fallback.
    }
  }

  try {
    await Linking.openURL(buildYandexMapsWebUrl(normalized));
    return { opened: true, appId: null, fallbackUsed: true };
  } catch {}

  return { opened: false, appId: null, fallbackUsed: true };
}

export function openPreferredMap() {
  return openPreferredMapTarget({ type: 'map' });
}

export function openAddressInPreferredMap(fullAddress) {
  const address = String(fullAddress || '').trim();
  if (!address) return Promise.resolve({ opened: false, appId: null, fallbackUsed: false });
  return openPreferredMapTarget({ type: 'address', address });
}

export function openCoordinatesInPreferredMap(latitude, longitude) {
  const lat = Number(String(latitude ?? '').replace(',', '.'));
  const lng = Number(String(longitude ?? '').replace(',', '.'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Promise.resolve({ opened: false, appId: null, fallbackUsed: false });
  }
  return openPreferredMapTarget({ type: 'coordinates', latitude: lat, longitude: lng });
}

export default {
  buildAddressForNavigator,
  buildInstalledMapOptions,
  buildYandexMapsWebUrl,
  getMapAppPreferenceState,
  openAddressInPreferredMap,
  openCoordinatesInPreferredMap,
  openPreferredMap,
  openPreferredMapTarget,
  setPreferredMapAppId,
};
