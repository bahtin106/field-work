import LazyRouteScreen from '../../../components/layout/LazyRouteScreen';

export default function CloudStoragesRoute() {
  return (
    <LazyRouteScreen
      cacheKey="company-settings/cloud-storages"
      titleKey="settings_integrations_yandex_disk"
      load={() => import('../../../screens/company_settings/sections/CloudStoragesScreen')}
    />
  );
}
