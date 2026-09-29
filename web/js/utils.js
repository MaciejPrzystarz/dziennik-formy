/* Dziennik formy: date, number and text helpers. No dependencies. */
(function (DF) {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');
  const MINUS = '\u2212';

  const WEEKDAYS = ['pn', 'wt', 'śr', 'czw', 'pt', 'sob', 'nd'];
  const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
  const MONTHS_GENITIVE = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca',
    'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
  const MONTHS = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień',
    'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];

  // A "key" is a local calendar day in YYYY-MM-DD form. Keys compare correctly as strings.
  function toKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function fromKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function todayKey() {
    return toKey(new Date());
  }

  function addDays(key, days) {
    const d = fromKey(key);
    d.setDate(d.getDate() + days);
    return toKey(d);
  }

  // Whole days from `fromK` to `toK` (positive when toK is later). Rounding absorbs DST shifts.
  function diffDays(fromK, toK) {
    return Math.round((fromKey(toK) - fromKey(fromK)) / 86400000);
  }

  function isValidKey(key) {
    return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key) && toKey(fromKey(key)) === key;
  }

  function weekdayIndex(key) {
    return (fromKey(key).getDay() + 6) % 7; // 0 = Monday
  }

  function weekStart(key) {
    return addDays(key, -weekdayIndex(key));
  }

  function dayRange(fromK, toK) {
    const out = [];
    for (let k = fromK; k <= toK; k = addDays(k, 1)) out.push(k);
    return out;
  }

  const nf1 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf0 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 });

  const nfW = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 2 });

  const fmt1 = (n) => nf1.format(n);
  const fmt2 = (n) => nf2.format(n);
  const fmtInt = (n) => nf0.format(Math.round(n));
  const fmtWeight = (n) => nfW.format(n); // recorded weight: "84,2", "84,35"

  // Signed number with a real minus sign; never prints "−0,0".
  function signed(n, format = fmt1) {
    const abs = format(Math.abs(n));
    if (abs === format(0)) return abs;
    return (n < 0 ? MINUS : '+') + abs;
  }

  // Weight as typed in the form: "84,35" keeps precision, "84" stays "84".
  function weightInput(n) {
    return String(Math.round(n * 100) / 100).replace('.', ',');
  }

  function fmtDay(key) {
    const d = fromKey(key);
    return `${WEEKDAYS[weekdayIndex(key)]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
  }

  function fmtShort(key) {
    const d = fromKey(key);
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
  }

  // Week label: "21–27.09" inside one month, "28.09–04.10" across two.
  function fmtRange(fromK, toK) {
    const a = fromKey(fromK);
    const b = fromKey(toK);
    const sameMonth = a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
    return `${sameMonth ? pad(a.getDate()) : fmtShort(fromK)}–${fmtShort(toK)}`;
  }

  function fmtLong(key, withYear) {
    const d = fromKey(key);
    const year = withYear === undefined ? d.getFullYear() !== new Date().getFullYear() : withYear;
    return `${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]}${year ? ' ' + d.getFullYear() : ''}`;
  }

  function fmtRelative(key, today = todayKey()) {
    const diff = diffDays(key, today);
    if (diff === 0) return 'dziś';
    if (diff === 1) return 'wczoraj';
    return fmtDay(key);
  }

  function monthTitle(key) {
    const d = fromKey(key);
    return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }

  function monthShort(key) {
    return MONTHS_SHORT[fromKey(key).getMonth()];
  }

  // Accepts numbers and user text like "84,2" or "2 450". Returns null when empty or invalid.
  function parseNumber(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const s = String(value).trim().replace(/\s/g, '').replace(',', '.');
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  // Polish plural: 1 trening, 2 treningi, 5 treningów.
  function plural(n, one, few, many) {
    if (n === 1) return one;
    const n10 = n % 10;
    const n100 = n % 100;
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
    return many;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  DF.utils = {
    MINUS, WEEKDAYS,
    toKey, fromKey, todayKey, addDays, diffDays, isValidKey, weekdayIndex, weekStart, dayRange,
    fmt1, fmt2, fmtInt, fmtWeight, signed, weightInput, fmtDay, fmtShort, fmtRange, fmtLong, fmtRelative, monthTitle, monthShort,
    parseNumber, plural, escapeHtml, clamp
  };
})(window.DF = window.DF || {});
