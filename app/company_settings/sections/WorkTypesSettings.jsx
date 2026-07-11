import LazyRouteScreen from '../../../components/layout/LazyRouteScreen';

export default function WorkTypesSettingsRoute() {
  return (
    <LazyRouteScreen
      cacheKey="company-settings/work-types"
      titleKey="work_types_settings_title"
      load={() => import('../../../screens/company_settings/sections/WorkTypesSettingsScreen')}
    />
  );
}
