import LazyRouteScreen from '../../components/layout/LazyRouteScreen';

export default function AppSettingsRoute() {
  return (
    <LazyRouteScreen
      load={() => import('../../screens/app_settings/AppSettingsScreen')}
      titleKey="routes.app_settings/AppSettings"
      titleFallback="Настройки приложения"
    />
  );
}
