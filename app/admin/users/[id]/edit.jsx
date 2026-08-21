import LazyRouteScreen from '../../../../components/layout/LazyRouteScreen';
import Screen from '../../../../components/layout/Screen';
import { useRequireSuperAdmin } from '../../../../hooks/useRequireSuperAdmin';

export default function AdminUserEditRoute() {
  const { isAllowed, isLoading } = useRequireSuperAdmin();
  if (isLoading || !isAllowed) return <Screen background="background" />;

  return (
    <LazyRouteScreen
      cacheKey="routes.admin/users/[id]/edit"
      titleKey="routes.users/[id]/edit"
      load={() => import('../../../../screens/users/[id]/UserEditScreen')}
      screenProps={{ privilegedAdminAccess: true }}
    />
  );
}
