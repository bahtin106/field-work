import LazyRouteScreen from '../../components/layout/LazyRouteScreen';

export default function BillingRoute() {
  return (
    <LazyRouteScreen
      cacheKey="routes.billing/index"
      titleKey="routes.billing/index"
      load={() => import('../../screens/billing/BillingScreen')}
    />
  );
}
