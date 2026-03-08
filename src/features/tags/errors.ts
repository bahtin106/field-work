export function resolveTagErrorMessage(error: any, t: (key: string) => string) {
  const code = String(error?.code || '').trim();
  const msg = String(error?.message || '').toLowerCase();

  if (msg.includes('at most 10 tags')) {
    return String(t('tags_max_toast') || 'Maximum {count} tags').replace('{count}', '10');
  }

  if (msg.includes('client tags are disabled') || msg.includes('object tags are disabled')) {
    return String(t('errors_saveGeneric') || 'Failed to save changes');
  }

  if (code === '22023' && msg.includes('tags')) {
    return String(t('errors_saveGeneric') || 'Failed to save changes');
  }

  return null;
}

