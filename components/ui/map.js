import { Linking, Platform } from 'react-native';

/**
 * Build a single-line address suitable for navigator queries.
 * Accepts an object with possible fields and joins known parts.
 */
export function buildAddressForNavigator(addr = {}) {
  if (!addr || typeof addr !== 'object') return '';
  const parts = [addr.country, addr.region, addr.district, addr.city, addr.street, addr.house, addr.apartment];
  return parts.filter(Boolean).map((p) => String(p).trim()).join(', ');
}

/**
 * Open the provided address in Yandex Navigator app or fallback to Yandex.Maps web.
 * This helper centralizes the behavior so all screens reuse the same logic.
 */
export function buildYandexMapsWebUrl(target) {
  if (target?.type === 'coordinates') {
    const lat = Number(target.latitude);
    const lng = Number(target.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return `https://yandex.ru/maps/?pt=${encodeURIComponent(`${lng},${lat}`)}&z=17&l=map`;
    }
  }
  const address = String(target?.address || '').trim();
  return address
    ? `https://yandex.ru/maps/?text=${encodeURIComponent(address)}`
    : 'https://yandex.ru/maps/';
}

function buildMapAppCandidates(target) {
  const isCoordinates = target?.type === 'coordinates';
  const lat = Number(target?.latitude);
  const lng = Number(target?.longitude);
  const address = String(target?.address || '').trim();
  const query = isCoordinates ? `${lat},${lng}` : address;
  const encodedQuery = encodeURIComponent(query);
  const yandexMapsUrl = isCoordinates
    ? `yandexmaps://maps.yandex.ru/?ll=${encodeURIComponent(`${lng},${lat}`)}&z=17`
    : `yandexmaps://maps.yandex.ru/?text=${encodedQuery}`;
  const yandexNavigatorUrl = isCoordinates
    ? `yandexnavi://show_point_on_map?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}&zoom=17`
    : `yandexnavi://map_search?text=${encodedQuery}`;
  const googleMapsUrl = isCoordinates
    ? `comgooglemaps://?q=${encodedQuery}&center=${encodedQuery}`
    : `comgooglemaps://?q=${encodedQuery}`;
  const appleMapsUrl = isCoordinates
    ? `http://maps.apple.com/?ll=${encodedQuery}&q=${encodedQuery}`
    : `http://maps.apple.com/?q=${encodedQuery}`;

  return [
    { id: 'yandex_maps', labelKey: 'map_app_yandex_maps', probe: yandexMapsUrl, url: yandexMapsUrl },
    { id: 'yandex_navigator', labelKey: 'map_app_yandex_navigator', probe: yandexNavigatorUrl, url: yandexNavigatorUrl },
    { id: 'google_maps', labelKey: 'map_app_google_maps', probe: googleMapsUrl, url: googleMapsUrl },
    ...(Platform.OS === 'ios'
      ? [{ id: 'apple_maps', labelKey: 'map_app_apple_maps', probe: appleMapsUrl, url: appleMapsUrl }]
      : []),
  ];
}

export function buildAndroidGeoUrl(target) {
  if (target?.type === 'coordinates') {
    const lat = Number(target.latitude);
    const lng = Number(target.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const point = `${lat},${lng}`;
      return `geo:${point}?q=${encodeURIComponent(point)}`;
    }
  }
  const address = String(target?.address || '').trim();
  return `geo:0,0?q=${encodeURIComponent(address)}`;
}

export async function buildInstalledMapOptions(target) {
  if (Platform.OS === 'web') return [];
  const candidates = buildMapAppCandidates(target);
  const checks = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        return (await Linking.canOpenURL(candidate.probe)) ? candidate : null;
      } catch {
        return null;
      }
    }),
  );
  const installed = checks.filter(Boolean);
  // Expo Go cannot carry this project's Android <queries> declarations, so
  // per-app canOpenURL checks resolve to false there. A geo: ACTION_VIEW keeps
  // the decision inside Android and exposes only apps that can handle maps.
  if (!installed.length && Platform.OS === 'android') {
    const systemUrl = buildAndroidGeoUrl(target);
    return [{
      id: 'android_system_maps',
      labelKey: 'map_app_system_chooser',
      probe: systemUrl,
      url: systemUrl,
    }];
  }
  return installed;
}

export function openAddressInYandex(fullAddress) {
  const address = String(fullAddress || '').trim();
  if (!address) return Promise.resolve(false);
  return Linking.openURL(buildYandexMapsWebUrl({ type: 'address', address }));
}

export function openCoordinatesInYandex(latitude, longitude) {
  const lat = Number(String(latitude ?? '').replace(',', '.'));
  const lng = Number(String(longitude ?? '').replace(',', '.'));
  const target = Number.isFinite(lat) && Number.isFinite(lng)
    ? { type: 'coordinates', latitude: lat, longitude: lng }
    : null;
  return Linking.openURL(buildYandexMapsWebUrl(target));
}

export default {
  buildAddressForNavigator,
  buildAndroidGeoUrl,
  buildInstalledMapOptions,
  buildYandexMapsWebUrl,
  openAddressInYandex,
  openCoordinatesInYandex,
};
