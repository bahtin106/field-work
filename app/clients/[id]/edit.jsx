import LazyRouteScreen from '../../../components/layout/LazyRouteScreen';

export default function ClientEditRoute() {
  return (
    <LazyRouteScreen
      cacheKey="routes.clients/[id]/edit"
      titleKey="routes.clients/[id]/edit"
      load={() => import('../../../screens/clients/[id]/ClientEditScreen')}
    />
  );
}
