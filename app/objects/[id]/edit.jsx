import LazyRouteScreen from '../../../components/layout/LazyRouteScreen';

export default function ObjectEditRoute() {
  return (
    <LazyRouteScreen
      load={() => import('../../../screens/objects/[id]/ObjectEditScreen')}
      titleKey="routes.objects/[id]/edit"
      titleFallback="Редактирование"
    />
  );
}

