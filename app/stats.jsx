import LazyRouteScreen from '../components/layout/LazyRouteScreen';

export default function StatsRoute() {
  return (
    <LazyRouteScreen
      cacheKey="routes.stats"
      titleKey="routes.stats"
      load={() => import('../screens/StatsScreen')}
    />
  );
}
