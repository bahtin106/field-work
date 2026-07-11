import LazyRouteScreen from '../../../components/layout/LazyRouteScreen';

export default function ClientViewRoute() {
  return (
    <LazyRouteScreen
      cacheKey="routes.clients/[id]/index"
      titleKey="routes.clients/[id]/index"
      load={() => import('../../../screens/clients/[id]/ClientViewScreen')}
    />
  );
}
