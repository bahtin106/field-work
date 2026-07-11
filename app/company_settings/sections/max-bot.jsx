import LazyRouteScreen from '../../../components/layout/LazyRouteScreen';

export default function MaxBotSettingsRoute() {
  return (
    <LazyRouteScreen
      cacheKey="company-settings/messenger-bot"
      titleFallback="MAX"
      load={() => import('../../../screens/company_settings/sections/MessengerBotSettingsScreen')}
      screenProps={{ provider: 'max' }}
    />
  );
}
