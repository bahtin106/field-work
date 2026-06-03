import LazyRouteScreen from '../../../components/layout/LazyRouteScreen';

export default function UserViewRoute() {
  return (
    <LazyRouteScreen
      load={() => import('../../../screens/users/[id]/UserViewScreen')}
      titleKey="profile_title"
      titleFallback="Profile"
    />
  );
}
