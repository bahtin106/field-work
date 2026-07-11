import LazyRouteScreen from '../../../components/layout/LazyRouteScreen';

export default function UserViewRoute() {
  return (
    <LazyRouteScreen
      cacheKey="routes.users/[id]/index"
      titleKey="routes.users/[id]/index"
      load={() => import('../../../screens/users/[id]/UserViewScreen')}
    />
  );
}
