import LazyRouteScreen from '../../components/layout/LazyRouteScreen';

export default function CalendarRoute() {
  return (
    <LazyRouteScreen
      load={() => import('../../screens/orders/CalendarScreen')}
      titleKey="routes.orders/calendar"
      titleFallback="Календарь"
    />
  );
}
