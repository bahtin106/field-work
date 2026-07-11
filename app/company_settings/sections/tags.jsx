import LazyRouteScreen from '../../../components/layout/LazyRouteScreen';

export default function TagsSettingsRoute() {
  return (
    <LazyRouteScreen
      cacheKey="company-settings/tags"
      titleKey="settings_sections_reference_items_tags"
      load={() => import('../../../screens/company_settings/sections/TagsSettingsScreen')}
    />
  );
}
