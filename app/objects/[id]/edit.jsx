import LazyRouteScreen from '../../../components/layout/LazyRouteScreen';

export default function ObjectEditRoute() {
  return (
    <LazyRouteScreen
      cacheKey="routes.objects/[id]/edit"
      titleKey="routes.objects/[id]/edit"
      load={() => import('../../../screens/objects/[id]/ObjectEditScreen')}
    />
  );
}
