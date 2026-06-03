import LazyRouteScreen from '../../components/layout/LazyRouteScreen';

export default function CompanySettingsRoute() {
  return (
    <LazyRouteScreen
      load={() => import('../../screens/company_settings/CompanySettingsScreen')}
      titleKey="company_settings_title"
      titleFallback="Настройки компании"
    />
  );
}
