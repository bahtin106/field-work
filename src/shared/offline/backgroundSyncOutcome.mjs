function fulfilledValue(result) {
  if (!result || result.status !== 'fulfilled') return null;
  const value = result.value;
  return value && typeof value === 'object' ? value : null;
}

export function didBackgroundSyncComplete(results) {
  if (!Array.isArray(results) || results.length !== 3) return false;
  const [photoResult, financeResult, genericResult] = results;
  const photos = fulfilledValue(photoResult);
  const finance = fulfilledValue(financeResult);
  const generic = fulfilledValue(genericResult);
  if (!photos || !finance || !generic) return false;

  // Conflicts and terminal failures are surfaced to the user and must not make
  // the operating system spin the background job forever. Pending work and a
  // photo failure remain retryable, so the scheduler should try again later.
  return (
    Number(photos.failed || 0) === 0 &&
    Number(photos.pending || 0) === 0 &&
    Number(finance.pending || 0) === 0 &&
    Number(generic.pending || 0) === 0
  );
}
