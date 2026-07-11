import LazyRouteScreen from '../../../components/layout/LazyRouteScreen';

export default function ObjectViewRoute() {
  return (
    <LazyRouteScreen
      cacheKey="routes.objects/[id]/index"
      titleKey="routes_objects_object"
      load={() => import('../../../screens/objects/[id]/ObjectViewScreen')}
    />
  );
}
