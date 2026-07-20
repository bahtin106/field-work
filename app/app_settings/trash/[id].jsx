import LazyRouteScreen from '../../../components/layout/LazyRouteScreen';

export default function TrashDetailRoute() {
  return (
    <LazyRouteScreen
      cacheKey="routes.app_settings/trash/[id]"
      titleKey="trash_title"
      load={() => import('../../../screens/app_settings/TrashDetailScreen')}
    />
  );
}
