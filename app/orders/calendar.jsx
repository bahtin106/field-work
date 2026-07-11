import LazyRouteScreen from '../../components/layout/LazyRouteScreen';

export default function CalendarRoute() {
  return (
    <LazyRouteScreen
      cacheKey="routes.orders/calendar"
      titleKey="routes.orders/calendar"
      load={() => import('../../screens/orders/CalendarScreen')}
    />
  );
}
