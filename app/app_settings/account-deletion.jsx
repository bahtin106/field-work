import LazyRouteScreen from '../../components/layout/LazyRouteScreen';

export default function AccountDeletionRoute() {
  return (
    <LazyRouteScreen
      cacheKey="routes.app_settings/account-deletion"
      titleKey="account_deletion_title"
      load={() => import('../../screens/app_settings/AccountDeletionScreen')}
    />
  );
}
