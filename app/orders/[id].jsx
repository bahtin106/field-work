import LazyRouteScreen from '../../components/layout/LazyRouteScreen';

export default function OrderDetailsRoute() {
  return (
    <LazyRouteScreen
      cacheKey="routes.orders/[id]"
      titleKey="routes.orders/[id]"
      load={() => import('../../screens/orders/OrderDetailsScreen')}
    />
  );
}
