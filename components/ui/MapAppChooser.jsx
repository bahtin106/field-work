import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { Linking, Platform } from 'react-native';

import { useTranslation } from '../../src/i18n/useTranslation';
import SelectModal from './modals/SelectModal';
import {
  buildInstalledMapOptions,
  buildYandexMapsWebUrl,
} from './map';

const MapAppChooser = forwardRef(function MapAppChooser(_props, ref) {
  const { t } = useTranslation();
  const [target, setTarget] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const resolveItems = useCallback(async (nextTarget) => {
    setLoading(true);
    try {
      const available = await buildInstalledMapOptions(nextTarget);
      if (!available.length) {
        await Linking.openURL(buildYandexMapsWebUrl(nextTarget)).catch(() => {});
        return false;
      }
      setItems(
        available.map((item) => ({
          ...item,
          label: t(item.labelKey),
        })),
      );
      setTarget(nextTarget);
      return true;
    } finally {
      setLoading(false);
    }
  }, [t]);

  useImperativeHandle(ref, () => ({
    openMap() {
      return resolveItems({ type: 'address', address: '' });
    },
    openAddress(address) {
      const value = String(address || '').trim();
      if (!value) return Promise.resolve(false);
      return resolveItems({ type: 'address', address: value });
    },
    openCoordinates(latitude, longitude) {
      const lat = Number(String(latitude ?? '').replace(',', '.'));
      const lng = Number(String(longitude ?? '').replace(',', '.'));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return Linking.openURL(buildYandexMapsWebUrl(null)).then(() => false).catch(() => false);
      }
      return resolveItems({ type: 'coordinates', latitude: lat, longitude: lng });
    },
  }), [resolveItems]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    buildInstalledMapOptions({ type: 'address', address: ' ' }).catch(() => []);
  }, []);

  return (
    <SelectModal
      visible={!!target}
      title={t('map_app_chooser_title')}
      searchable={false}
      loading={loading}
      items={items}
      onClose={() => setTarget(null)}
      onSelect={async (item) => {
        setTarget(null);
        try {
          await Linking.openURL(item.url);
        } catch {
          await Linking.openURL(buildYandexMapsWebUrl(target)).catch(() => {});
        }
      }}
    />
  );
});

export default MapAppChooser;
