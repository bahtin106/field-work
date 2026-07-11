import LazyRouteScreen from '../../../components/layout/LazyRouteScreen';

export default function DepartmentsSettingsRoute() {
  return (
    <LazyRouteScreen
      cacheKey="company-settings/departments"
      titleKey="departments_settings_title"
      load={() => import('../../../screens/company_settings/sections/DepartmentsSettingsScreen')}
    />
  );
}
