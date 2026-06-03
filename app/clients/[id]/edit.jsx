import LazyRouteScreen from '../../../components/layout/LazyRouteScreen';

export default function ClientEditRoute() {
  return (
    <LazyRouteScreen
      load={() => import('../../../screens/clients/[id]/ClientEditScreen')}
      titleKey="routes.clients/[id]/edit"
      titleFallback="Редактирование"
    />
  );
}
