import LazyRouteScreen from '../../../../components/layout/LazyRouteScreen';

export default function NewClientObjectRoute() {
  return (
    <LazyRouteScreen
      cacheKey="routes.clients/[id]/objects/new"
      titleKey="routes_objects_new"
      load={() => import('../../../../screens/clients/[id]/objects/NewClientObjectScreen')}
    />
  );
}
