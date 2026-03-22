import {
  CLIENT_OBJECT_ADDRESS_FIELDS,
  buildClientObjectShortAddress,
} from './addressing';

const TEXT_FIELDS = ['country', 'region', 'district', 'city', 'street', 'postal_code'];
const EXACT_FIELDS = ['house', 'entrance', 'apartment', 'floor'];
const OPTIONAL_TEXT_FIELDS = ['comment'];
const STREET_SYNONYMS = new Map([
  ['ул', 'улица'],
  ['ул.', 'улица'],
  ['пр', 'проспект'],
  ['пр.', 'проспект'],
  ['пр-т', 'проспект'],
  ['просп', 'проспект'],
  ['д', 'дом'],
  ['д.', 'дом'],
]);

function trimToEmpty(value) {
  return String(value || '').trim();
}

function normalizeText(value) {
  const base = trimToEmpty(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,/#!$%^&*;:{}=\-_`~()"'\\[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) return '';
  return base
    .split(' ')
    .map((token) => STREET_SYNONYMS.get(token) || token)
    .join(' ')
    .trim();
}

function normalizeNumberLike(value) {
  return trimToEmpty(value)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^\p{L}\p{N}/-]+/gu, '');
}

function levenshteinDistance(left, right) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array(right.length + 1);

  for (let i = 0; i < left.length; i += 1) {
    current[0] = i + 1;
    for (let j = 0; j < right.length; j += 1) {
      const substitutionCost = left[i] === right[j] ? 0 : 1;
      current[j + 1] = Math.min(
        current[j] + 1,
        previous[j + 1] + 1,
        previous[j] + substitutionCost,
      );
    }
    for (let j = 0; j < current.length; j += 1) previous[j] = current[j];
  }

  return previous[right.length];
}

function similarityScore(left, right) {
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  if (left === right) return 1;
  const maxLength = Math.max(left.length, right.length);
  if (!maxLength) return 1;
  return 1 - levenshteinDistance(left, right) / maxLength;
}

function normalizeObjectForMatch(objectLike) {
  const normalized = {};
  for (const field of CLIENT_OBJECT_ADDRESS_FIELDS) {
    if (TEXT_FIELDS.includes(field) || OPTIONAL_TEXT_FIELDS.includes(field)) {
      if (field === 'comment') {
        normalized[field] = normalizeText(objectLike?.comment || objectLike?.entrance_info);
      } else {
        normalized[field] = normalizeText(objectLike?.[field]);
      }
    } else if (EXACT_FIELDS.includes(field)) {
      if (field === 'apartment') {
        normalized[field] = normalizeNumberLike(objectLike?.apartment || objectLike?.office);
      } else {
        normalized[field] = normalizeNumberLike(objectLike?.[field]);
      }
    } else {
      normalized[field] = trimToEmpty(objectLike?.[field]);
    }
  }
  normalized.name = trimToEmpty(objectLike?.name);
  return normalized;
}

export function findExactMatchingClientObject(draftObject, clientObjects) {
  if (!draftObject || !Array.isArray(clientObjects) || clientObjects.length === 0) return null;

  const normalizedDraft = normalizeObjectForMatch(draftObject);

  return (
    clientObjects.find((candidateRaw) => {
      const normalizedCandidate = normalizeObjectForMatch(candidateRaw);
      if (normalizedDraft.name !== normalizedCandidate.name) return false;
      return (
        ['country', 'region', 'district', 'city', 'street', 'postal_code'].every(
          (field) => normalizedDraft[field] === normalizedCandidate[field],
        ) &&
        ['house', 'entrance', 'apartment', 'floor'].every(
          (field) => normalizedDraft[field] === normalizedCandidate[field],
        ) &&
        ['comment'].every(
          (field) => normalizedDraft[field] === normalizedCandidate[field],
        )
      );
    }) || null
  );
}

function hasStrictFieldConflict(draft, candidate) {
  return EXACT_FIELDS.some((field) => {
    if (!draft[field] || !candidate[field]) return false;
    return draft[field] !== candidate[field];
  });
}

function weightedSimilarity(draft, candidate) {
  const streetScore = similarityScore(draft.street, candidate.street);
  const cityScore =
    draft.city && candidate.city ? similarityScore(draft.city, candidate.city) : 0.88;
  const regionScore =
    draft.region && candidate.region ? similarityScore(draft.region, candidate.region) : 0.92;
  const districtScore =
    draft.district && candidate.district ? similarityScore(draft.district, candidate.district) : 0.92;
  const houseScore =
    draft.house && candidate.house ? (draft.house === candidate.house ? 1 : 0) : 0;
  const apartmentScore =
    draft.apartment && candidate.apartment
      ? draft.apartment === candidate.apartment
        ? 1
        : 0
      : 1;
  const entranceScore =
    draft.entrance && candidate.entrance
      ? draft.entrance === candidate.entrance
        ? 1
        : 0
      : 1;

  return (
    streetScore * 0.36 +
    cityScore * 0.2 +
    regionScore * 0.08 +
    districtScore * 0.04 +
    houseScore * 0.22 +
    apartmentScore * 0.07 +
    entranceScore * 0.03
  );
}

export function findBestMatchingClientObject(draftObject, clientObjects) {
  if (!draftObject || !Array.isArray(clientObjects) || clientObjects.length === 0) return null;

  const normalizedDraft = normalizeObjectForMatch(draftObject);
  if (!normalizedDraft.street || !normalizedDraft.house) return null;

  let bestMatch = null;

  clientObjects.forEach((candidateRaw) => {
    const normalizedCandidate = normalizeObjectForMatch(candidateRaw);
    if (!normalizedCandidate.street || !normalizedCandidate.house) return;
    if (hasStrictFieldConflict(normalizedDraft, normalizedCandidate)) return;

    const streetScore = similarityScore(normalizedDraft.street, normalizedCandidate.street);
    const cityScore =
      normalizedDraft.city && normalizedCandidate.city
        ? similarityScore(normalizedDraft.city, normalizedCandidate.city)
        : 0.88;
    const houseMatches = normalizedDraft.house === normalizedCandidate.house;

    if (!houseMatches) return;
    if (streetScore < 0.72) return;
    if (cityScore < 0.72) return;

    const score = weightedSimilarity(normalizedDraft, normalizedCandidate);
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        object: candidateRaw,
        score,
      };
    }
  });

  if (!bestMatch || bestMatch.score < 0.82) return null;

  return {
    object: bestMatch.object,
    score: bestMatch.score,
    shortAddress: buildClientObjectShortAddress(bestMatch.object),
    signature: JSON.stringify({
      clientId: String(bestMatch.object?.client_id || ''),
      objectId: String(bestMatch.object?.id || ''),
      street: normalizeText(draftObject?.street),
      house: normalizeNumberLike(draftObject?.house),
      city: normalizeText(draftObject?.city),
      apartment: normalizeNumberLike(draftObject?.apartment || draftObject?.office),
      entrance: normalizeNumberLike(draftObject?.entrance),
    }),
  };
}
