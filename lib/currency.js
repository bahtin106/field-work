// lib/currency.js
const SYMBOLS = {
  RUB: '₽',
  USD: '$',
  EUR: '€',
};

function getCurrencySymbol(code) {
  if (!code) return '';
  const c = String(code).toUpperCase();
  return SYMBOLS[c] || c;
}

function formatCurrency(value, currency = 'RUB', locale = 'ru-RU') {
  if (value == null || value === '') return '';
  const n = Number(
    String(value)
      .replace(/[^0-9.,-]/g, '')
      .replace(',', '.'),
  );
  if (!isFinite(n)) return String(value);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n);
  } catch {
    const formatted = n.toLocaleString(locale);
    const sym = getCurrencySymbol(currency);
    return `${formatted} ${sym}`;
  }
}

function formatCurrencyWithOptions(value, currency = 'RUB', locale = 'ru-RU', options = {}) {
  if (value == null || value === '') return '';
  const n = Number(
    String(value)
      .replace(/[^0-9.,-]/g, '')
      .replace(',', '.'),
  );
  if (!isFinite(n)) return String(value);
  try {
    return new Intl.NumberFormat(
      locale,
      Object.assign({ style: 'currency', currency }, options),
    ).format(n);
  } catch {
    const formatted = n.toLocaleString(locale);
    const sym = getCurrencySymbol(currency);
    return `${formatted} ${sym}`;
  }
}

export { formatCurrency, formatCurrencyWithOptions, getCurrencySymbol };
