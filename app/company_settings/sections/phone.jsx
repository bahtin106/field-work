import LazyRouteScreen from '../../../components/layout/LazyRouteScreen';

export default function PhoneSettingsRoute() {
  return (
    <LazyRouteScreen
      cacheKey="company-settings/phone"
      titleKey="phone_visibility_title"
      load={() => import('../../../screens/company_settings/sections/PhoneSettingsScreen')}
    />
  );
}
