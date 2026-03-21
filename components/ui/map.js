import { Linking } from 'react-native';

/**
 * Build a single-line address suitable for navigator queries.
 * Accepts an object with possible fields and joins known parts.
 */
export function buildAddressForNavigator(addr = {}) {
  if (!addr || typeof addr !== 'object') return '';
  const parts = [addr.country, addr.region, addr.district, addr.city, addr.street, addr.house, addr.office];
  return parts.filter(Boolean).map((p) => String(p).trim()).join(', ');
}

/**
 * Open the provided address in Yandex Navigator app or fallback to Yandex.Maps web.
 * This helper centralizes the behavior so all screens reuse the same logic.
 */
export function openAddressInYandex(fullAddress) {
  const text = String(fullAddress || '').trim();
  if (!text) return;
  const deep = `yandexnavi://map_search?text=${encodeURIComponent(text)}`;
  Linking.openURL(deep).catch(() => {
    const fallback = `https://yandex.ru/maps/?text=${encodeURIComponent(text)}`;
    Linking.openURL(fallback).catch(() => {
      // ignore final failure
    });
  });
}

export function openCoordinatesInYandex(latitude, longitude) {
  const lat = Number(String(latitude || '').replace(',', '.'));
  const lng = Number(String(longitude || '').replace(',', '.'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const fallback = 'https://yandex.ru/maps/';
    Linking.openURL(fallback).catch(() => {});
    return;
  }
  const deep = `yandexnavi://build_route_on_map?lat_to=${encodeURIComponent(String(lat))}&lon_to=${encodeURIComponent(String(lng))}`;
  Linking.openURL(deep).catch(() => {
    const fallbackDeep = `yandexnavi://map_search?text=${encodeURIComponent(`${lat}, ${lng}`)}`;
    Linking.openURL(fallbackDeep).catch(() => {
      const fallback = `https://yandex.ru/maps/?pt=${encodeURIComponent(`${lng},${lat}`)}&z=17&l=map`;
      Linking.openURL(fallback).catch(() => {});
    });
  });
}

export default { buildAddressForNavigator, openAddressInYandex, openCoordinatesInYandex };
