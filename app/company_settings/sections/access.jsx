import LazyRouteScreen from '../../../components/layout/LazyRouteScreen';

export default function AccessSettingsRoute() {
  return (
    <LazyRouteScreen
      cacheKey="company-settings/access"
      titleKey="settings_management_access"
      load={() => import('../../../screens/company_settings/sections/AccessSettingsScreen')}
    />
  );
}
