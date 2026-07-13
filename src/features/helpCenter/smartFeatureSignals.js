import { messengerBotIntegration } from '../../../lib/messengerBotIntegration';
import { supabase } from '../../../lib/supabase';
import { yandexDiskIntegration } from '../../../lib/yandexDiskIntegration';

function fulfilledValue(result, fallback = null) {
  return result?.status === 'fulfilled' ? result.value : fallback;
}

async function hasEnabledFinanceRule(companyId) {
  const { count, error } = await supabase
    .from('company_finance_rules')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('is_enabled', true);
  if (error) throw error;
  return Number(count || 0) > 0;
}

async function isMessengerBotEnabled(provider) {
  const result = await messengerBotIntegration(provider, 'status');
  return result?.config?.is_enabled === true;
}

async function isYandexDiskConnected() {
  const raw = await yandexDiskIntegration('status');
  const result = raw && typeof raw?.data === 'object' ? raw.data : raw;
  return Boolean(
    result?.connected ||
      result?.is_connected ||
      result?.account ||
      result?.yandex_login ||
      result?.yandex_display_name,
  );
}

// Optional integrations are checked only after the user qualifies for suggestions.
// Failed checks remain unknown, so an offline user never receives a guess presented as fact.
export async function loadSmartFeatureSignals(companyId) {
  if (!companyId) return null;
  const [finance, telegram, max, yandex] = await Promise.allSettled([
    hasEnabledFinanceRule(companyId),
    isMessengerBotEnabled('telegram'),
    isMessengerBotEnabled('max'),
    isYandexDiskConnected(),
  ]);

  return {
    checkedAt: Date.now(),
    financeRulesEnabled: fulfilledValue(finance),
    telegramBotEnabled: fulfilledValue(telegram),
    maxBotEnabled: fulfilledValue(max),
    yandexDiskConnected: fulfilledValue(yandex),
  };
}
