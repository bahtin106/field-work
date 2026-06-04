import LazyRouteScreen from '../../components/layout/LazyRouteScreen';

export default function UserNewRoute() {
  return (
    <LazyRouteScreen
      load={() => import('../../screens/users/UserNewScreen')}
      titleKey="routes.users/new"
    />
  );
}

