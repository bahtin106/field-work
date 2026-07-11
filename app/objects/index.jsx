import LazyRouteScreen from '../../components/layout/LazyRouteScreen';

export default function ObjectsIndexRoute() {
  return (
    <LazyRouteScreen
      cacheKey="routes.objects/index"
      titleKey="clients_objects_section"
      load={() => import('../../screens/objects/ObjectsIndexScreen')}
    />
  );
}
