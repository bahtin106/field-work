import LazyRouteScreen from '../../components/layout/LazyRouteScreen';

export default function AppSettingsRoute() {
  return (
    <LazyRouteScreen
      cacheKey="routes.app_settings/AppSettings"
      titleKey="routes.app_settings/AppSettings"
      load={() => import('../../screens/app_settings/AppSettingsScreen')}
    />
  );
}
