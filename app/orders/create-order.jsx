import LazyRouteScreen from '../../components/layout/LazyRouteScreen';

export default function CreateOrderRoute() {
  return (
    <LazyRouteScreen
      cacheKey="routes.orders/create-order"
      titleKey="routes.orders/create-order"
      load={() => import('../../screens/orders/CreateOrderScreen')}
    />
  );
}
