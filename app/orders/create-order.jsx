import LazyRouteScreen from '../../components/layout/LazyRouteScreen';

export default function CreateOrderRoute() {
  return (
    <LazyRouteScreen
      load={() => import('../../screens/orders/CreateOrderScreen')}
      titleKey="routes.orders/create-order"
      titleFallback="Новая заявка"
    />
  );
}
