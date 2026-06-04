import LazyRouteScreen from '../../components/layout/LazyRouteScreen';

export default function BillingRoute() {
  return (
    <LazyRouteScreen
      load={() => import('../../screens/billing/BillingScreen')}
      titleKey="routes.billing/index"
    />
  );
}
