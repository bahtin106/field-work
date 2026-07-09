export function normalizeNamePart(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function formatPersonNameParts(parts = {}) {
  if (!parts || typeof parts !== 'object') return '';

  const firstName = normalizeNamePart(parts.firstName ?? parts.first_name);
  const middleName = normalizeNamePart(parts.middleName ?? parts.middle_name ?? parts.patronymic);
  const lastName = normalizeNamePart(parts.lastName ?? parts.last_name ?? parts.surname);

  return [lastName, firstName, middleName].filter(Boolean).join(' ');
}

export function formatPersonName(person, fallback = '') {
  if (!person || typeof person !== 'object') return normalizeNamePart(fallback);

  return (
    formatPersonNameParts(person) ||
    normalizeNamePart(
      person.full_name ??
        person.fullName ??
        person.display_name ??
        person.displayName ??
        person.name ??
        fallback,
    )
  );
}

export function formatPersonInitials(person, fallback = '') {
  const name = formatPersonName(person, fallback);
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1))
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
