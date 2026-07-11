import LazyRouteScreen from '../../../components/layout/LazyRouteScreen';

export default function EventsSettingsRoute() {
  return (
    <LazyRouteScreen
      cacheKey="app-settings/events"
      titleKey="settings_events_title"
      load={() => import('../../../screens/app_settings/sections/EventsSettingsScreen')}
    />
  );
}
