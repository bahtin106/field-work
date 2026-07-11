import LazyRouteScreen from '../../components/layout/LazyRouteScreen';

export default function CompanySettingsRoute() {
  return (
    <LazyRouteScreen
      cacheKey="company_settings_title"
      titleKey="company_settings_title"
      load={() => import('../../screens/company_settings/CompanySettingsScreen')}
    />
  );
}
