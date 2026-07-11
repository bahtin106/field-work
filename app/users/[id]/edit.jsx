import LazyRouteScreen from '../../../components/layout/LazyRouteScreen';

export default function UserEditRoute() {
  return (
    <LazyRouteScreen
      cacheKey="routes.users/[id]/edit"
      titleKey="routes.users/[id]/edit"
      load={() => import('../../../screens/users/[id]/UserEditScreen')}
    />
  );
}
