import LazyRouteScreen from '../../../components/layout/LazyRouteScreen';

export default function OrderStatusesRoute() {
  return (
    <LazyRouteScreen
      cacheKey="company-settings/order-statuses"
      titleKey="order_statuses_title"
      load={() => import('../../../screens/company_settings/sections/OrderStatusesScreen')}
    />
  );
}
