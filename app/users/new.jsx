import LazyRouteScreen from '../../components/layout/LazyRouteScreen';

export default function UserNewRoute() {
  return (
    <LazyRouteScreen
      cacheKey="routes.users/new"
      titleKey="routes.users/new"
      load={() => import('../../screens/users/UserNewScreen')}
    />
  );
}
