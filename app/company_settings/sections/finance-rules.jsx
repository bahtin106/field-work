import LazyRouteScreen from '../../../components/layout/LazyRouteScreen';

export default function FinanceRulesRoute() {
  return (
    <LazyRouteScreen
      load={() => import('../../../screens/company_settings/sections/FinanceRulesScreen')}
      titleKey="settings_sections_finance_rules_title"
    />
  );
}
