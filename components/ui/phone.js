// src/utils/phone.js

const onlyDigits = (s = '') => (s.match(/\d/g) || []).join('');

/** Приводим ввод к российскому набору цифр с кодом страны 7 */
export function normalizeRu(raw = '') {
  let d = onlyDigits(raw);

  // если 8XXXXXXXXXX -> 7XXXXXXXXXX
  if (d.length >= 1 && d[0] === '8') d = '7' + d.slice(1);

  // если начинается с 7 или 9 (часто вводят 9XXXXXXXXX)
  if (d[0] === '9') d = '7' + d;            // 9XXXXXXXXX -> 79XXXXXXXXX
  if (d[0] !== '7') d = (d[0] ? '7' : '') + d.slice(1);

  // оставляем максимум 11 цифр
  if (d.length > 11) d = d.slice(0, 11);

  return d;
}

/** Маска "+7 (XXX) XXX-XX-XX" формируется по мере ввода */
export function formatRuMask(raw = '') {
  const d = normalizeRu(raw);
  if (!d) return '';

  const local = d.slice(1); // без кода страны
  const a = local.slice(0, 3);
  const b = local.slice(3, 6);
  const c = local.slice(6, 8);
  const e = local.slice(8, 10);

  let out = '+7';
  out += ' ';
  out += '(' + a;
  if (a.length === 3) out += ')';
  if (b) out += ' ' + b;
  if (c) out += '-' + c;
  if (e) out += '-' + e;

  return out;
}

/** Валиден ли номер РФ: ровно 11 цифр и начинается на 79 */
export function isValidRu(raw = '') {
  const d = normalizeRu(raw);
  return d.length === 11 && d.startsWith('79');
}

/** Возвращает e164 или null, если номер ещё не полон/невалиден */
export function toE164(raw = '') {
  const d = normalizeRu(raw);
  return d.length === 11 && d.startsWith('7') ? '+' + d : null;
}

/** Удобный хелпер для onChange: принимает что угодно, отдаёт маску/e164/валидность */
export function maskApply(raw = '') {
  const masked = formatRuMask(raw);
  const e164 = toE164(masked);
  const valid = isValidRu(masked);
  return { masked, e164, valid };
}
