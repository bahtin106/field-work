import assert from 'node:assert/strict';
import { didBackgroundSyncComplete } from '../src/shared/offline/backgroundSyncOutcome.mjs';

const fulfilled = (value) => ({ status: 'fulfilled', value });
const base = [
  fulfilled({ completed: 2, failed: 0, pending: 0 }),
  fulfilled({ pending: 0, failed: 0 }),
  fulfilled({ pending: 0, conflicts: 0, failed: 0 }),
];

assert.equal(didBackgroundSyncComplete(base), true);
assert.equal(didBackgroundSyncComplete([
  fulfilled({ completed: 0, failed: 1 }),
  base[1],
  base[2],
]), false);
assert.equal(didBackgroundSyncComplete([
  fulfilled({ completed: 0, failed: 0, pending: 1 }),
  base[1],
  base[2],
]), false);
assert.equal(didBackgroundSyncComplete([
  base[0],
  fulfilled({ pending: 1, failed: 0 }),
  base[2],
]), false);
assert.equal(didBackgroundSyncComplete([
  base[0],
  base[1],
  fulfilled({ pending: 1, conflicts: 0, failed: 0 }),
]), false);
assert.equal(didBackgroundSyncComplete([
  base[0],
  fulfilled({ pending: 0, failed: 3 }),
  fulfilled({ pending: 0, conflicts: 2, failed: 4 }),
]), true);
assert.equal(didBackgroundSyncComplete([
  base[0],
  { status: 'rejected', reason: new Error('network') },
  base[2],
]), false);

console.log('Background sync outcome regression tests passed.');
