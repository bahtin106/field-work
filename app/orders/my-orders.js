import LazyRouteScreen from '../../components/layout/LazyRouteScreen';

export default function MyOrdersRoute() {
  return (
    <LazyRouteScreen
      load={() => import('../../screens/orders/MyOrdersScreen')}
      titleKey="routes.orders/my-orders"
      titleFallback="Мои заявки"
    />
  );
}

