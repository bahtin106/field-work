import LazyRouteScreen from '../../components/layout/LazyRouteScreen';
import { preloadOrderDetailsScreen } from '../../src/features/requests/orderDetailsPreload';

export default function OrderDetailsRoute() {
  return (
    <LazyRouteScreen
      load={preloadOrderDetailsScreen}
      titleKey="routes.orders/[id]"
    />
  );
}
