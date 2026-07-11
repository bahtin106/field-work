import LazyRouteScreen from '../../../components/layout/LazyRouteScreen';

export default function TelegramBotSettingsRoute() {
  return (
    <LazyRouteScreen
      cacheKey="company-settings/messenger-bot"
      titleFallback="Telegram"
      load={() => import('../../../screens/company_settings/sections/MessengerBotSettingsScreen')}
      screenProps={{ provider: 'telegram' }}
    />
  );
}
