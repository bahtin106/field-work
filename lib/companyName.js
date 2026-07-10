export const COMPANY_NAME_MAX_LENGTH = 64;

export function normalizeCompanyName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function validateCompanyName(value, t) {
  const name = normalizeCompanyName(value);
  if (!name) return t('errors_companyName_required');
  if (name.length > COMPANY_NAME_MAX_LENGTH) return t('errors_companyName_tooLong');
  return null;
}

