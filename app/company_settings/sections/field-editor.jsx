import LazyRouteScreen from '../../../components/layout/LazyRouteScreen';

export default function FieldEditorRoute() {
  return (
    <LazyRouteScreen
      cacheKey="company-settings/field-editor"
      titleKey="settings_management_form_builder"
      load={() => import('../../../screens/company_settings/sections/FieldEditorScreen')}
    />
  );
}
