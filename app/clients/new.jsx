import LazyRouteScreen from '../../components/layout/LazyRouteScreen';

export default function NewClientRoute() {
  return (
    <LazyRouteScreen
      cacheKey="routes.clients/new"
      titleKey="routes.clients/new"
      load={() => import('../../screens/clients/NewClientScreen')}
    />
  );
}
