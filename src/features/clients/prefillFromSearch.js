import { toE164MobilePhoneOrNull } from '../../shared/validation/phone';

const SURNAME_SUFFIXES = [
  'ов',
  'ова',
  'ев',
  'ева',
  'ин',
  'ина',
  'ын',
  'ына',
  'ский',
  'ская',
  'цкий',
  'цкая',
  'ко',
  'ук',
  'юк',
  'дзе',
  'швили',
];

function wordsFromQuery(value) {
  return String(value || '')
    .replace(/[0-9]+/g, ' ')
    .replace(/[^\p{L}\s-]+/gu, ' ')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeWord(value) {
  return String(value || '').trim().toLowerCase();
}

function looksLikePatronymic(value) {
  const normalized = normalizeWord(value);
  return normalized.endsWith('ич') || normalized.endsWith('на');
}

function looksLikeSurname(value) {
  const normalized = normalizeWord(value);
  return SURNAME_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function detectPhoneRaw(value) {
  const raw = String(value || '');
  if (!raw.trim()) return '';
  const phone = toE164MobilePhoneOrNull(raw);
  if (!phone) return '';
  return raw.trim();
}

export function parseClientPrefillFromSearch(query) {
  const raw = String(query || '').trim();
  const phoneRaw = detectPhoneRaw(raw);
  const tokens = wordsFromQuery(raw);

  let firstName = '';
  let lastName = '';
  let middleName = '';

  if (tokens.length === 1) {
    const token = tokens[0];
    if (looksLikePatronymic(token)) middleName = token;
    else if (looksLikeSurname(token)) lastName = token;
    else firstName = token;
  } else if (tokens.length === 2) {
    const [a, b] = tokens;
    if (looksLikeSurname(a) && !looksLikeSurname(b)) {
      lastName = a;
      firstName = b;
    } else {
      firstName = a;
      lastName = b;
    }
  } else if (tokens.length >= 3) {
    const [a, b, c] = tokens;
    if (looksLikePatronymic(c)) {
      firstName = b;
      lastName = a;
      middleName = c;
    } else {
      firstName = a;
      lastName = b;
      middleName = c;
    }
  }

  return {
    query: raw,
    phoneRaw,
    firstName,
    lastName,
    middleName,
  };
}
