import { Linking } from 'react-native';

/**
 * Build a single-line address suitable for navigator queries.
 * Accepts an object with possible fields and joins known parts.
 */
export function buildAddressForNavigator(addr = {}) {
  if (!addr || typeof addr !== 'object') return '';
  const parts = [addr.country, addr.region, addr.city, addr.street, addr.house, addr.building];
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

export default { buildAddressForNavigator, openAddressInYandex };
