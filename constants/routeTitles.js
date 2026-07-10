// constants/routeTitles.js
import { t } from '../src/i18n';

export function getRouteTitle(path) {
  const normalizedPath = String(path || '').replace(/^\//, '');
  if (!normalizedPath) return '';
  const key = `routes.${normalizedPath}`;
  const label = t(key);
  return label === key ? '' : label;
}
