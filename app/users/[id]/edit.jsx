import LazyRouteScreen from '../../../components/layout/LazyRouteScreen';

export default function UserEditRoute() {
  return (
    <LazyRouteScreen
      load={() => import('../../../screens/users/[id]/UserEditScreen')}
      titleKey="routes.users/[id]/edit"
      titleFallback="Редактирование"
    />
  );
}
