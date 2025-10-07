// constants/routeTitles.js
export const ROUTE_TITLES = {}; // опциональный резерв на будущее

export const getRouteTitle = (path) =>
  (globalThis?.APP_I18N?.routes?.[path]) ?? ROUTE_TITLES[path] ?? '';
