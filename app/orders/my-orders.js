import LazyRouteScreen from '../../components/layout/LazyRouteScreen';

export default function MyOrdersRoute() {
  return (
    <LazyRouteScreen
      cacheKey="routes.orders/my-orders"
      titleKey="routes.orders/my-orders"
      load={() => import('../../screens/orders/MyOrdersScreen')}
    />
  );
}
