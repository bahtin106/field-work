export const POOR_CONNECTION_BANNER_DELAY_MS = 2_000;
export const SYNCING_BANNER_DELAY_MS = 900;

function count(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export function resolveOfflineBannerPresentation(
  snapshot = {},
  outbox = {},
  { poorConnectionVisible = false, syncingVisible = false } = {},
) {
  const isNetworkKnown = snapshot?.isNetworkKnown === true;
  const isOnline = snapshot?.isOnline === true;
  const pending = count(outbox?.pending);
  const conflicts = count(outbox?.conflicts);
  const failed = count(outbox?.failed);
  const showPoorConnection =
    isOnline && snapshot?.isPoorConnection === true && poorConnectionVisible === true;
  // Reading an empty outbox briefly toggles the internal sync flag. That is
  // background bookkeeping, not user-visible work, and must not shift the UI.
  const isActivelySyncing = isOnline && snapshot?.isSyncing === true && pending > 0;
  const showSyncing = isActivelySyncing && syncingVisible === true;
  const hasQueueState = pending > 0 || conflicts > 0 || failed > 0;

  if (!isNetworkKnown && !hasQueueState && !showSyncing) return null;
  if (
    isActivelySyncing &&
    !showSyncing &&
    !showPoorConnection &&
    conflicts === 0 &&
    failed === 0
  ) return null;
  if (isOnline && !showPoorConnection && !showSyncing && !hasQueueState) return null;

  return {
    tone: conflicts > 0 || failed > 0 ? 'danger' : isOnline ? 'warning' : 'primary',
    isOnline,
    showPoorConnection,
    showSyncing,
    pending,
    conflicts,
    failed,
  };
}
