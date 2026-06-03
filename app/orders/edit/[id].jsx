import LazyRouteScreen from '../../../components/layout/LazyRouteScreen';

export default function OrderEditRoute() {
  return (
    <LazyRouteScreen
      load={() => import('../../../screens/orders/edit/OrderEditScreen')}
      titleKey="routes.orders/edit/[id]"
      titleFallback="Редактирование"
    />
  );
}
