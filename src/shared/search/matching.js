function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function digitsOnly(value) {
  return String(value || '').replace(/\D+/g, '');
}

function normalizeRuPhone(digits) {
  const raw = digitsOnly(digits);
  if (!raw) return '';

  if (raw.length === 11) {
    if (raw.startsWith('8')) return `7${raw.slice(1)}`;
    return raw;
  }

  if (raw.length === 10 && raw.startsWith('9')) return `7${raw}`;
  return raw;
}

function buildPhoneTokens(phoneValue) {
  const raw = digitsOnly(phoneValue);
  const normalized = normalizeRuPhone(raw);
  const tokens = new Set();

  if (raw) tokens.add(raw);
  if (normalized) tokens.add(normalized);

  if (normalized.length === 11) {
    tokens.add(normalized.slice(1)); // 10 digits without country code
    tokens.add(normalized.slice(-7)); // local number tail
  } else if (normalized.length >= 7) {
    tokens.add(normalized.slice(-7));
  }

  if (raw.length === 11 && raw.startsWith('8')) {
    tokens.add(raw.slice(1));
    tokens.add(raw.slice(-7));
  }

  return tokens;
}

function buildPhoneQueryVariants(query) {
  const raw = digitsOnly(query);
  if (!raw) return [];
  const normalized = normalizeRuPhone(raw);
  const set = new Set();

  set.add(raw);
  if (normalized) set.add(normalized);

  // Add interchangeable RU prefixes for both full and partial input:
  // users often type "8..." while data may be stored as "+7...".
  if (raw.length >= 2 && raw.startsWith('8')) {
    set.add(`7${raw.slice(1)}`);
  }
  if (raw.length >= 2 && raw.startsWith('7')) {
    set.add(`8${raw.slice(1)}`);
  }
  if (raw.length >= 1 && raw.startsWith('9')) {
    set.add(`7${raw}`);
    set.add(`8${raw}`);
  }

  if (normalized.length === 11) {
    set.add(normalized.slice(1));
    set.add(normalized.slice(-7));
  } else if (normalized.length >= 7) {
    set.add(normalized.slice(-7));
  }

  return Array.from(set).filter(Boolean);
}

export function buildSearchIndex({ texts = [], phones = [] } = {}) {
  const textHaystack = normalizeText(
    (Array.isArray(texts) ? texts : [texts]).filter(Boolean).join(' '),
  );

  const phoneTokens = new Set();
  const sourcePhones = Array.isArray(phones) ? phones : [phones];
  sourcePhones.forEach((value) => {
    buildPhoneTokens(value).forEach((token) => phoneTokens.add(token));
  });

  return {
    textHaystack,
    phoneTokens: Array.from(phoneTokens),
  };
}

export function matchesSearch(index, query) {
  const qText = normalizeText(query);
  if (!qText) return true;

  if (index?.textHaystack && index.textHaystack.includes(qText)) {
    return true;
  }

  const phoneVariants = buildPhoneQueryVariants(query);
  if (phoneVariants.length === 0) return false;

  const phoneTokens = Array.isArray(index?.phoneTokens) ? index.phoneTokens : [];
  return phoneVariants.some((variant) =>
    phoneTokens.some((token) => token.includes(variant)),
  );
}

export function filterBySearch(list, query, buildIndex) {
  const rows = Array.isArray(list) ? list : [];
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return rows;
  return rows.filter((item) => matchesSearch(buildIndex(item), normalizedQuery));
}
