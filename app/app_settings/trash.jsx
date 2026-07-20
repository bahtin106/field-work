import LazyRouteScreen from '../../components/layout/LazyRouteScreen';

export default function TrashRoute() {
  return (
    <LazyRouteScreen
      cacheKey="routes.app_settings/trash"
      titleKey="trash_title"
      load={() => import('../../screens/app_settings/TrashScreen')}
    />
  );
}
