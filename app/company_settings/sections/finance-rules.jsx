import LazyRouteScreen from '../../../components/layout/LazyRouteScreen';

export default function FinanceRulesRoute() {
  return (
    <LazyRouteScreen
      cacheKey="company-settings/finance-rules"
      titleKey="finance_rules_title"
      load={() => import('../../../screens/company_settings/sections/FinanceRulesScreen')}
    />
  );
}
