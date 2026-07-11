import LazyRouteScreen from '../../components/layout/LazyRouteScreen';

export default function UsersIndexRoute() {
  return (
    <LazyRouteScreen
      cacheKey="routes.users/index"
      titleKey="routes.users/index"
      load={() => import('../../screens/users/UsersIndexScreen')}
    />
  );
}
