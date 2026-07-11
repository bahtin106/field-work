import LazyRouteScreen from '../../components/layout/LazyRouteScreen';

export default function ClientsIndexRoute() {
  return (
    <LazyRouteScreen
      cacheKey="routes.clients/index"
      titleKey="routes.clients/index"
      load={() => import('../../screens/clients/ClientsIndexScreen')}
    />
  );
}
