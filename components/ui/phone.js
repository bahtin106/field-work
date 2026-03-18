// src/utils/phone.js

const onlyDigits = (s = '') => (s.match(/\d/g) || []).join('');

/** Приводим ввод к российскому набору цифр с кодом страны 7 */
export function normalizeRu(raw = '') {
  let d = onlyDigits(raw);
  if (!d) return '';

  // 8… → 7… (в РФ «8» = выход на межгород, эквивалент +7)
  if (d[0] === '8') {
    d = '7' + d.slice(1);
  // 9… → 79… (мобильный без кода страны)
  } else if (d[0] === '9') {
    d = '7' + d;
  // любая другая первая цифра, кроме 7 — добавляем код страны
  } else if (d[0] !== '7') {
    d = '7' + d;
  }

  // Российский номер: 7 + 10 цифр = максимум 11
  if (d.length > 11) d = d.slice(0, 11);

  return d;
}

/** Маска "+7 (XXX) XXX-XX-XX" формируется по мере ввода */
export function formatRuMask(raw = '') {
  const d = normalizeRu(raw);
  if (!d) return '';

  const local = d.slice(1); // цифры после кода страны
  if (!local) return '+7';

  const code = local.slice(0, 3);
  const p1   = local.slice(3, 6);
  const p2   = local.slice(6, 8);
  const p3   = local.slice(8, 10);

  let out = '+7 (' + code;
  if (code.length === 3 && (p1 || p2 || p3)) out += ')';
  if (p1) out += ' ' + p1;
  if (p2) out += '-' + p2;
  if (p3) out += '-' + p3;

  return out;
}

/** Валиден ли номер РФ: ровно 11 цифр, код страны 7 (мобильный, городской, 8-800 и т.д.) */
export function isValidRu(raw = '') {
  const d = normalizeRu(raw);
  return d.length === 11 && d[0] === '7';
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
