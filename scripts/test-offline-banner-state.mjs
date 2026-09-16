import assert from 'node:assert/strict';
import {
  POOR_CONNECTION_BANNER_DELAY_MS,
  SYNCING_BANNER_DELAY_MS,
  resolveOfflineBannerPresentation,
} from '../src/shared/offline/offlineBannerState.mjs';

const healthy = {
  isNetworkKnown: true,
  isOnline: true,
  isPoorConnection: false,
  isSyncing: false,
};

assert.equal(
  resolveOfflineBannerPresentation({ ...healthy, isSyncing: true }, {}),
  null,
  'an empty background sync must not flash the global banner',
);

assert.equal(
  resolveOfflineBannerPresentation(
    { ...healthy, isSyncing: true },
    { pending: 1 },
  ),
  null,
  'a fast real sync must not shift the UI before the visibility delay',
);

assert.deepEqual(
  resolveOfflineBannerPresentation(
    { ...healthy, isSyncing: true },
    { pending: 1 },
    { syncingVisible: true },
  ),
  {
    tone: 'warning',
    isOnline: true,
    showPoorConnection: false,
    showSyncing: true,
    pending: 1,
    conflicts: 0,
    failed: 0,
  },
);

assert.equal(
  resolveOfflineBannerPresentation(
    { ...healthy, isPoorConnection: true },
    {},
  ),
  null,
  'a transient poor-connection sample must wait for visual confirmation',
);

assert.equal(
  resolveOfflineBannerPresentation(
    { ...healthy, isPoorConnection: true },
    {},
    { poorConnectionVisible: true },
  )?.showPoorConnection,
  true,
);

assert.equal(
  resolveOfflineBannerPresentation(
    { ...healthy, isOnline: false },
    {},
  )?.tone,
  'primary',
  'a confirmed offline state must remain visible',
);

assert.equal(
  resolveOfflineBannerPresentation(healthy, { conflicts: 1 })?.tone,
  'danger',
  'conflicts must remain immediately visible',
);

assert.ok(POOR_CONNECTION_BANNER_DELAY_MS >= 1_500);
assert.ok(SYNCING_BANNER_DELAY_MS >= 750);

console.log('Offline banner stability scenarios passed.');
