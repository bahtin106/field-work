import LazyRouteScreen from '../../../components/layout/LazyRouteScreen';

export default function OrderEditRoute() {
  return (
    <LazyRouteScreen
      cacheKey="routes.orders/edit/[id]"
      titleKey="routes.orders/edit/[id]"
      load={() => import('../../../screens/orders/edit/OrderEditScreen')}
    />
  );
}
