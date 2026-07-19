import { toE164MobilePhoneOrNull } from '../../shared/validation/phone';

const SURNAME_SUFFIXES = [
  'ов', 'ова', 'ев', 'ева', 'ин', 'ина', 'ын', 'ына',
  'ский', 'ская', 'цкий', 'цкая', 'ко', 'ук', 'юк', 'дзе', 'швили',
];

const PATRONYMIC_SUFFIXES = [
  'ич', 'ична', 'овна', 'евна', 'оглы', 'кызы', 'уулу',
];

function wordsFromQuery(value) {
  return String(value || '').match(/[\p{L}\p{M}\p{N}]+(?:[’'ʼ-][\p{L}\p{M}\p{N}]+)*/gu) || [];
}

function normalizeWord(value) {
  return String(value || '').trim().toLowerCase();
}

function looksLikePatronymic(value) {
  const normalized = normalizeWord(value);
  return PATRONYMIC_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
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
  const tokens = phoneRaw ? [] : wordsFromQuery(raw);

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
    if (looksLikePatronymic(b) && !looksLikeSurname(a)) {
      firstName = a;
      middleName = b;
    } else if (looksLikePatronymic(a) && !looksLikeSurname(b)) {
      firstName = b;
      middleName = a;
    } else if (looksLikeSurname(a) && !looksLikeSurname(b)) {
      lastName = a;
      firstName = b;
    } else {
      firstName = a;
      lastName = b;
    }
  } else if (tokens.length >= 3) {
    const [a, b] = tokens;
    const finalToken = tokens[tokens.length - 1];
    const patronymicIndex = tokens.findIndex(looksLikePatronymic);

    if (patronymicIndex === tokens.length - 1) {
      middleName = tokens.slice(2).join(' ');
      if (looksLikeSurname(a) && !looksLikeSurname(b)) {
        lastName = a;
        firstName = b;
      } else {
        firstName = a;
        lastName = b;
      }
    } else if (patronymicIndex === 1) {
      firstName = a;
      middleName = b;
      lastName = tokens.slice(2).join(' ');
    } else if (patronymicIndex === 0) {
      middleName = a;
      firstName = b;
      lastName = tokens.slice(2).join(' ');
    } else if (looksLikeSurname(a) && !looksLikeSurname(b)) {
      lastName = a;
      firstName = b;
      middleName = tokens.slice(2).join(' ');
    } else if (looksLikeSurname(b)) {
      firstName = a;
      lastName = b;
      middleName = tokens.slice(2).join(' ');
    } else {
      firstName = a;
      lastName = finalToken;
      middleName = tokens.slice(1, -1).join(' ');
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
