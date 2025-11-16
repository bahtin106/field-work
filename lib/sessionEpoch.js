// lib/sessionEpoch.js
// Глобальный «epoch» сессии: инкремент при каждом успешном логине или логауте.
// Используется для сброса локальных загрузочных состояний экранов.
let _epoch = 0;
const _listeners = new Set();

export function bumpSessionEpoch() {
  _epoch += 1;
  for (const cb of Array.from(_listeners)) {
    try {
      cb(_epoch);
    } catch (e) {
      // silent
    }
  }
  return _epoch;
}

export function getSessionEpoch() {
  return _epoch;
}

export function onSessionEpoch(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

export default { bumpSessionEpoch, getSessionEpoch, onSessionEpoch };
