import LazyRouteScreen from '../../components/layout/LazyRouteScreen';

export default function OrderDetailsRoute() {
  return (
    <LazyRouteScreen
      load={() => import('../../screens/orders/OrderDetailsScreen')}
      titleKey="routes.orders/[id]"
      titleFallback="Заявка"
    />
  );
}
