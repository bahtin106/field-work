import LazyRouteScreen from '../../../../components/layout/LazyRouteScreen';
import Screen from '../../../../components/layout/Screen';
import { useRequireSuperAdmin } from '../../../../hooks/useRequireSuperAdmin';

export default function AdminUserViewRoute() {
  const { isAllowed, isLoading } = useRequireSuperAdmin();
  if (isLoading || !isAllowed) return <Screen background="background" />;

  return (
    <LazyRouteScreen
      cacheKey="routes.admin/users/[id]/index"
      titleKey="routes.users/[id]/index"
      load={() => import('../../../../screens/users/[id]/UserViewScreen')}
      screenProps={{ privilegedAdminAccess: true }}
    />
  );
}
