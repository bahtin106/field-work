import { usePathname, useRouter } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { useCompanySettings } from '../../../hooks/useCompanySettings';
import { useAuthContext } from '../../../providers/SimpleAuthProvider';
import {
  ContextHelpModal,
  HelpSettingsModal,
  SmartTipModal,
} from './HelpCenterModals';
import {
  getFeatureIdsForPath,
  getHelpTopic,
  pickEligibleSmartTip,
} from './helpCatalog';
import { loadSmartFeatureSignals } from './smartFeatureSignals';
import {
  createDefaultHelpCenterState,
  loadHelpCenterState,
  normalizeHelpCenterState,
  saveHelpCenterState,
} from './helpCenterStorage';

const HelpCenterContext = createContext(null);

const ACTIVE_TICK_MS = 30 * 1000;
const MIN_ACTIVE_USE_MS = 20 * 60 * 1000;
const MIN_ACCOUNT_AGE_MS = 24 * 60 * 60 * 1000;
const MIN_SESSION_COUNT = 3;
const MIN_TIP_GAP_MS = 7 * 24 * 60 * 60 * 1000;
const NEW_SESSION_AFTER_MS = 30 * 60 * 1000;
const TIP_ROUTE_SETTLE_MS = 5000;
const FEATURE_SIGNALS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FEATURE_SIGNALS_RETRY_MS = 6 * 60 * 60 * 1000;

const SAFE_TIP_PATHS = new Set([
  '/orders',
  '/orders/',
  '/orders/my-orders',
  '/orders/all-orders',
  '/orders/calendar',
]);

function resolveAccountCreatedAt(user) {
  const value = user?.created_at || user?.createdAt;
  const parsed = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export function HelpCenterProvider({ children }) {
  const router = useRouter();
  const pathname = usePathname() || '';
  const { user, profile } = useAuthContext();
  const userId = String(user?.id || '').trim();
  const companyId = String(profile?.company_id || '').trim() || null;
  const accountType = String(user?.user_metadata?.account_type || '').trim().toLowerCase();
  const isSolo = accountType === 'solo';
  const isAdmin = String(profile?.role || '').trim().toLowerCase() === 'admin';
  const { settings: companySettings } = useCompanySettings(companyId, {
    enabled: !!userId && !!companyId && isAdmin,
    subscribe: false,
  });

  const [state, setState] = useState(() => createDefaultHelpCenterState());
  const [ready, setReady] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [topicId, setTopicId] = useState(null);
  const [currentTip, setCurrentTip] = useState(null);

  const stateRef = useRef(state);
  const userIdRef = useRef(userId);
  const writeQueueRef = useRef(Promise.resolve());
  const appStateRef = useRef(AppState.currentState);
  const activeTickAtRef = useRef(Date.now());
  const backgroundedAtRef = useRef(null);
  const tipShownThisSessionRef = useRef(false);
  const signalRequestRef = useRef(false);
  const signalAttemptAtRef = useRef(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const persist = useCallback((nextState, ownerUserId = userIdRef.current) => {
    if (!ownerUserId) return;
    writeQueueRef.current = writeQueueRef.current
      .catch(() => {})
      .then(() => saveHelpCenterState(ownerUserId, nextState))
      .catch(() => {});
  }, []);

  const commit = useCallback(
    (updater) => {
      if (!userIdRef.current) return;
      setState((previous) => {
        const candidate = typeof updater === 'function' ? updater(previous) : updater;
        const next = normalizeHelpCenterState({ ...candidate, updatedAt: Date.now() });
        stateRef.current = next;
        persist(next);
        return next;
      });
    },
    [persist],
  );

  useEffect(() => {
    userIdRef.current = userId;
    setReady(false);
    setSettingsVisible(false);
    setTopicId(null);
    setCurrentTip(null);
    tipShownThisSessionRef.current = false;
    signalRequestRef.current = false;
    signalAttemptAtRef.current = 0;

    if (!userId) {
      const defaults = createDefaultHelpCenterState();
      stateRef.current = defaults;
      setState(defaults);
      return undefined;
    }

    let active = true;
    loadHelpCenterState(userId).then((loaded) => {
      if (!active || userIdRef.current !== userId) return;
      const now = Date.now();
      const isNewSession =
        !loaded.lastSessionStartedAt || now - loaded.lastSessionStartedAt >= NEW_SESSION_AFTER_MS;
      const next = normalizeHelpCenterState({
        ...loaded,
        sessionCount: loaded.sessionCount + (isNewSession ? 1 : 0),
        lastSessionStartedAt: isNewSession ? now : loaded.lastSessionStartedAt,
      });
      stateRef.current = next;
      setState(next);
      setReady(true);
      activeTickAtRef.current = now;
      if (isNewSession) persist(next, userId);
    });

    return () => {
      active = false;
    };
  }, [persist, userId]);

  const addActiveUse = useCallback(
    (now = Date.now()) => {
      if (!ready || appStateRef.current !== 'active') {
        activeTickAtRef.current = now;
        return;
      }
      const elapsed = Math.max(0, Math.min(now - activeTickAtRef.current, ACTIVE_TICK_MS * 2));
      activeTickAtRef.current = now;
      if (elapsed < 1000) return;
      commit((previous) => ({ ...previous, activeUseMs: previous.activeUseMs + elapsed }));
    },
    [commit, ready],
  );

  useEffect(() => {
    if (!ready || !userId) return undefined;
    appStateRef.current = AppState.currentState || 'active';
    activeTickAtRef.current = Date.now();
    const intervalId = setInterval(() => addActiveUse(Date.now()), ACTIVE_TICK_MS);
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      const now = Date.now();
      const previousAppState = appStateRef.current;
      if (previousAppState === 'active' && nextAppState !== 'active') {
        addActiveUse(now);
        backgroundedAtRef.current = now;
      }
      if (previousAppState !== 'active' && nextAppState === 'active') {
        const awayFor = backgroundedAtRef.current ? now - backgroundedAtRef.current : 0;
        activeTickAtRef.current = now;
        if (awayFor >= NEW_SESSION_AFTER_MS) {
          tipShownThisSessionRef.current = false;
          commit((previous) => ({
            ...previous,
            sessionCount: previous.sessionCount + 1,
            lastSessionStartedAt: now,
          }));
        }
      }
      appStateRef.current = nextAppState;
    });

    return () => {
      clearInterval(intervalId);
      subscription.remove();
    };
  }, [addActiveUse, commit, ready, userId]);

  useEffect(() => {
    if (!ready) return;
    const featureIds = getFeatureIdsForPath(pathname);
    const newFeatureIds = featureIds.filter(
      (featureId) => !stateRef.current.usedFeatureIds.includes(featureId),
    );
    if (newFeatureIds.length === 0) return;
    commit((previous) => ({
      ...previous,
      usedFeatureIds: [...new Set([...previous.usedFeatureIds, ...newFeatureIds])],
    }));
  }, [commit, pathname, ready]);

  const openTopic = useCallback((nextTopicId) => {
    if (!getHelpTopic(nextTopicId)) return false;
    setTopicId(nextTopicId);
    return true;
  }, []);

  const openHelpSettings = useCallback(() => setSettingsVisible(true), []);
  const closeHelpSettings = useCallback(() => setSettingsVisible(false), []);

  const updatePreferences = useCallback(
    (preferences) => {
      const normalizedPreferences = {
        contextualHelpEnabled: preferences?.contextualHelpEnabled !== false,
        smartTipsEnabled: preferences?.smartTipsEnabled !== false,
      };
      commit((previous) => ({ ...previous, preferences: normalizedPreferences }));
      if (!normalizedPreferences.contextualHelpEnabled) setTopicId(null);
      if (!normalizedPreferences.smartTipsEnabled) setCurrentTip(null);
      setSettingsVisible(false);
    },
    [commit],
  );

  const resetHiddenTips = useCallback(() => {
    commit((previous) => ({ ...previous, dismissedTipIds: [], tipStats: {} }));
  }, [commit]);

  useEffect(() => {
    if (!ready || !userId || currentTip || topicId || settingsVisible) return undefined;
    if (state.preferences.smartTipsEnabled === false || tipShownThisSessionRef.current) return undefined;
    if (!SAFE_TIP_PATHS.has(pathname) || AppState.currentState !== 'active') return undefined;
    if (state.activeUseMs < MIN_ACTIVE_USE_MS || state.sessionCount < MIN_SESSION_COUNT) return undefined;
    if (state.lastTipAt && Date.now() - state.lastTipAt < MIN_TIP_GAP_MS) return undefined;
    if (Date.now() - resolveAccountCreatedAt(user) < MIN_ACCOUNT_AGE_MS) return undefined;

    const signalsAreStale =
      !state.featureSignals?.checkedAt ||
      Date.now() - state.featureSignals.checkedAt >= FEATURE_SIGNALS_MAX_AGE_MS;
    const signalRetryAllowed =
      !signalAttemptAtRef.current ||
      Date.now() - signalAttemptAtRef.current >= FEATURE_SIGNALS_RETRY_MS;
    if (isAdmin && companyId && signalsAreStale && signalRetryAllowed && !signalRequestRef.current) {
      signalRequestRef.current = true;
      signalAttemptAtRef.current = Date.now();
      loadSmartFeatureSignals(companyId)
        .then((signals) => {
          if (!signals || userIdRef.current !== userId) return;
          const hasKnownSignal = [
            signals.financeRulesEnabled,
            signals.telegramBotEnabled,
            signals.maxBotEnabled,
            signals.yandexDiskConnected,
          ].some((value) => typeof value === 'boolean');
          if (!hasKnownSignal && !stateRef.current.featureSignals) return;
          commit((previous) => {
            const previousSignals = previous.featureSignals || {};
            const merged = { ...signals };
            Object.keys(merged).forEach((key) => {
              if (key !== 'checkedAt' && typeof merged[key] !== 'boolean') {
                merged[key] = previousSignals[key] ?? null;
              }
            });
            return { ...previous, featureSignals: merged };
          });
        })
        .catch(() => {})
        .finally(() => {
          signalRequestRef.current = false;
        });
    }

    const context = {
      isAdmin,
      isSolo,
      companyId,
      companySettings,
      featureSignals: state.featureSignals,
    };
    const tip = pickEligibleSmartTip(context, state);
    if (!tip) return undefined;

    const timeoutId = setTimeout(() => {
      if (AppState.currentState !== 'active' || !SAFE_TIP_PATHS.has(pathname)) return;
      if (tipShownThisSessionRef.current || stateRef.current.preferences.smartTipsEnabled === false) return;
      tipShownThisSessionRef.current = true;
      setCurrentTip(tip);
      const now = Date.now();
      commit((previous) => ({
        ...previous,
        lastTipAt: now,
        tipStats: {
          ...previous.tipStats,
          [tip.id]: {
            ...previous.tipStats[tip.id],
            shownCount: (previous.tipStats[tip.id]?.shownCount || 0) + 1,
            lastShownAt: now,
          },
        },
      }));
    }, TIP_ROUTE_SETTLE_MS);

    return () => clearTimeout(timeoutId);
  }, [
    commit,
    companyId,
    companySettings,
    currentTip,
    isAdmin,
    isSolo,
    pathname,
    ready,
    settingsVisible,
    state,
    topicId,
    user,
    userId,
  ]);

  const applyTipChoice = useCallback(
    ({ hideTip, disableAll }) => {
      const tip = currentTip;
      if (!tip) return;
      commit((previous) => ({
        ...previous,
        preferences: disableAll
          ? { ...previous.preferences, smartTipsEnabled: false }
          : previous.preferences,
        dismissedTipIds:
          hideTip && !previous.dismissedTipIds.includes(tip.id)
            ? [...previous.dismissedTipIds, tip.id]
            : previous.dismissedTipIds,
      }));
      setCurrentTip(null);
    },
    [commit, currentTip],
  );

  const learnMore = useCallback(() => {
    const tip = currentTip;
    if (!tip) return;
    const now = Date.now();
    commit((previous) => ({
      ...previous,
      usedFeatureIds: previous.usedFeatureIds.includes(tip.id)
        ? previous.usedFeatureIds
        : [...previous.usedFeatureIds, tip.id],
      tipStats: {
        ...previous.tipStats,
        [tip.id]: { ...previous.tipStats[tip.id], learnMoreOpenedAt: now },
      },
    }));
    setCurrentTip(null);
    requestAnimationFrame(() => router.push(tip.route));
  }, [commit, currentTip, router]);

  const contextValue = useMemo(
    () => ({
      ready,
      preferences: state.preferences,
      hiddenTipCount: state.dismissedTipIds.length,
      openTopic,
      openHelpSettings,
      updatePreferences,
      resetHiddenTips,
    }),
    [openHelpSettings, openTopic, ready, resetHiddenTips, state.dismissedTipIds.length, state.preferences, updatePreferences],
  );

  return (
    <HelpCenterContext.Provider value={contextValue}>
      {children}
      <HelpSettingsModal
        visible={settingsVisible}
        preferences={state.preferences}
        hiddenTipCount={state.dismissedTipIds.length}
        onClose={closeHelpSettings}
        onSave={updatePreferences}
        onResetHidden={resetHiddenTips}
      />
      <ContextHelpModal
        visible={!!topicId}
        topic={getHelpTopic(topicId)}
        onClose={() => setTopicId(null)}
      />
      <SmartTipModal
        visible={!!currentTip}
        tip={currentTip}
        onClose={() => setCurrentTip(null)}
        onApply={applyTipChoice}
        onLearnMore={learnMore}
      />
    </HelpCenterContext.Provider>
  );
}

export function useHelpCenter() {
  const context = useContext(HelpCenterContext);
  if (!context) throw new Error('useHelpCenter must be used within HelpCenterProvider');
  return context;
}
