// UIKit can only reliably present one React Native Modal controller at a time.
// Nested sheets are therefore suspended and restored as a stack.
let nextId = 1;
const entries = new Map();
const suspendedStack = [];
let activeId = null;
let pendingId = null;

const removeFromStack = (id) => {
  for (let index = suspendedStack.length - 1; index >= 0; index -= 1) {
    if (suspendedStack[index] === id) suspendedStack.splice(index, 1);
  }
};

const present = (id, { resuming = false } = {}) => {
  const entry = entries.get(id);
  if (!entry || !entry.requested) return false;
  activeId = id;
  if (resuming) entry.resume();
  else entry.present();
  return true;
};

const resumePrevious = () => {
  while (suspendedStack.length) {
    if (present(suspendedStack.pop(), { resuming: true })) return;
  }
};

export const registerIOSModal = ({ present: presentModal, resume: resumeModal, suspend: suspendModal }) => {
  const id = nextId++;
  entries.set(id, {
    present: presentModal,
    requested: false,
    resume: resumeModal || presentModal,
    suspend: suspendModal,
  });
  return id;
};

export const unregisterIOSModal = (id) => {
  const wasActive = activeId === id;
  entries.delete(id);
  removeFromStack(id);
  if (pendingId === id) pendingId = null;
  if (wasActive) {
    activeId = null;
    resumePrevious();
  }
};

export const requestIOSModalPresentation = (id) => {
  const entry = entries.get(id);
  if (!entry) return;
  entry.requested = true;
  if (activeId === id) {
    entry.resume();
    return;
  }
  if (pendingId === id) return;
  if (activeId == null) {
    present(id);
    return;
  }
  const activeEntry = entries.get(activeId);
  if (!activeEntry) {
    activeId = null;
    present(id);
    return;
  }
  removeFromStack(activeId);
  suspendedStack.push(activeId);
  pendingId = id;
  activeEntry.suspend();
};

export const releaseIOSModal = (id) => {
  const entry = entries.get(id);
  if (entry) entry.requested = false;
  removeFromStack(id);
  if (pendingId === id) pendingId = null;
};

export const notifyIOSModalDismissed = (id) => {
  if (activeId === id) activeId = null;
  if (pendingId != null) {
    const nextPendingId = pendingId;
    pendingId = null;
    if (present(nextPendingId)) return;
  }
  resumePrevious();
};
