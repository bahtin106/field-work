import LazyRouteScreen from '../../components/layout/LazyRouteScreen';

export default function AllOrdersRoute() {
  return (
    <LazyRouteScreen
      cacheKey="routes.orders/all-orders"
      titleKey="all_orders_title"
      load={() => import('../../screens/orders/AllOrdersScreen')}
    />
  );
}
