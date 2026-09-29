/* Dziennik formy: loading and saving data.
   Single source of truth: data/health.json in a GitHub repo, read and written through the
   GitHub Contents API. Claude edits the same file from chat, so every save re-reads the file
   first and merges field by field instead of overwriting it. */
(function (DF) {
  'use strict';

  const U = DF.utils;

  const KEY_GITHUB = 'dziennik-formy.github';
  const KEY_TOKEN = 'dziennik-formy.token';
  const API = 'https://api.github.com';
  const LOCAL_FILE = '../data/health.json';

  const DEFAULT_SETTINGS = Object.freeze({
    name: 'Maciej',
    startDate: '2026-09-28',
    startWeight: 86,
    targetWeight: 78,
    targetDate: '2027-03-31',
    kcalTarget: 2450,
    weeklyTrainings: 4,
    trainings: Object.freeze(['Upper A', 'Lower', 'Upper B', 'Rower'])
  });
  const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);
  const ENTRY_FIELDS = ['weight', 'kcal', 'training', 'mood', 'note'];

  class StoreError extends Error {
    constructor(kind, message, status) {
      super(message);
      this.name = 'StoreError';
      this.kind = kind;
      this.status = status || 0;
    }
  }

  // ---------- browser storage ----------

  function readLocal(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function writeLocal(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (_) { /* storage blocked: the app still works for this session */ }
  }

  // ---------- data format ----------

  function normalizeSettings(raw) {
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const d = DEFAULT_SETTINGS;
    const num = (v, fallback, lo, hi) => {
      const n = U.parseNumber(v);
      return n != null && n >= lo && n <= hi ? n : fallback;
    };
    const out = {
      name: typeof src.name === 'string' ? src.name.trim().slice(0, 40) : d.name,
      startDate: U.isValidKey(src.startDate) ? src.startDate : d.startDate,
      startWeight: num(src.startWeight, d.startWeight, 20, 400),
      targetWeight: num(src.targetWeight, d.targetWeight, 20, 400),
      targetDate: U.isValidKey(src.targetDate) ? src.targetDate : d.targetDate,
      kcalTarget: Math.round(num(src.kcalTarget, d.kcalTarget, 500, 20000)),
      weeklyTrainings: Math.round(num(src.weeklyTrainings, d.weeklyTrainings, 0, 14)),
      trainings: Array.isArray(src.trainings)
        ? [...new Set(src.trainings.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()))]
        : d.trainings.slice()
    };
    // Keys this app doesn't know about survive a save untouched.
    Object.keys(src).forEach((k) => { if (!(k in out)) out[k] = src[k]; });
    return out;
  }

  function cleanEntry(raw) {
    if (!raw || typeof raw !== 'object' || !U.isValidKey(raw.date)) return null;
    const e = { date: raw.date };
    const weight = U.parseNumber(raw.weight);
    if (weight != null && weight > 0) e.weight = Math.round(weight * 100) / 100;
    const kcal = U.parseNumber(raw.kcal);
    if (kcal != null && kcal >= 0) e.kcal = Math.round(kcal);
    if (typeof raw.training === 'string' && raw.training.trim()) e.training = raw.training.trim();
    const mood = U.parseNumber(raw.mood);
    if (mood != null && mood >= 1 && mood <= 5) e.mood = Math.round(mood);
    if (typeof raw.note === 'string' && raw.note.trim()) e.note = raw.note.trim().slice(0, 280);
    Object.keys(raw).forEach((k) => {
      if (k === 'date' || ENTRY_FIELDS.includes(k)) return;
      if (raw[k] !== null && raw[k] !== undefined && raw[k] !== '') e[k] = raw[k];
    });
    return Object.keys(e).length > 1 ? e : null;
  }

  // One entry per day, sorted by date. Duplicated days are merged, later values win.
  function normalize(raw) {
    const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const byDate = new Map();
    (Array.isArray(src.entries) ? src.entries : []).forEach((r) => {
      const e = cleanEntry(r);
      if (e) byDate.set(e.date, Object.assign(byDate.get(e.date) || {}, e));
    });
    const data = {
      settings: normalizeSettings(src.settings),
      entries: [...byDate.values()].sort(DF.stats.byDate)
    };
    Object.keys(src).forEach((k) => { if (k !== 'settings' && k !== 'entries') data[k] = src[k]; });
    return data;
  }

  const inlineJson = (obj, keys) =>
    '{' + keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(obj[k])}`).join(', ') + '}';

  function entryKeys(e) {
    return ['date',
      ...ENTRY_FIELDS.filter((k) => e[k] !== undefined),
      ...Object.keys(e).filter((k) => k !== 'date' && !ENTRY_FIELDS.includes(k))];
  }

  function settingValue(v) {
    if (Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object')) {
      return '[' + v.map((x) => JSON.stringify(x)).join(', ') + ']';
    }
    return JSON.stringify(v);
  }

  // Settings one key per line, entries one per line: small, readable diffs in every commit.
  function serialize(data) {
    const s = data.settings;
    const sKeys = [...SETTING_KEYS.filter((k) => s[k] !== undefined), ...Object.keys(s).filter((k) => !SETTING_KEYS.includes(k))];
    const settings = '{\n' + sKeys.map((k) => `    ${JSON.stringify(k)}: ${settingValue(s[k])}`).join(',\n') + '\n  }';
    const entries = data.entries.length
      ? '[\n' + data.entries.map((e) => '    ' + inlineJson(e, entryKeys(e))).join(',\n') + '\n  ]'
      : '[]';
    const extra = Object.keys(data)
      .filter((k) => k !== 'settings' && k !== 'entries')
      .map((k) => `,\n  ${JSON.stringify(k)}: ${JSON.stringify(data[k])}`)
      .join('');
    return `{\n  "settings": ${settings},\n  "entries": ${entries}${extra}\n}\n`;
  }

  function parse(text, path) {
    if (!text.trim()) return normalize({});
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new StoreError('parse',
        `Plik ${path} ma błąd składni JSON (${err.message}). Popraw go w repozytorium. Do tego czasu aplikacja nic nie zapisze.`);
    }
    return normalize(raw);
  }

  // ---------- configuration ----------

  // https://<owner>.github.io/<repo>/ means the app knows its repo without any setup.
  function detectFromLocation() {
    if (typeof location === 'undefined') return null;
    const m = /^([a-z0-9-]+)\.github\.io$/i.exec(location.hostname);
    if (!m) return null;
    const first = location.pathname.split('/').filter(Boolean)[0];
    const repo = first && !/\.html?$/i.test(first) ? decodeURIComponent(first) : `${m[1]}.github.io`;
    return { owner: m[1], repo };
  }

  function readSavedConfig() {
    try { return JSON.parse(readLocal(KEY_GITHUB) || 'null'); } catch (_) { return null; }
  }

  // First complete source wins: this browser's settings, then config.js, then the page address.
  function getConfig() {
    const sources = [
      ['browser', readSavedConfig()],
      ['config.js', typeof window !== 'undefined' ? window.APP_CONFIG : null],
      ['address', detectFromLocation()]
    ];
    for (const [source, c] of sources) {
      if (c && typeof c.owner === 'string' && c.owner.trim() && typeof c.repo === 'string' && c.repo.trim()) {
        return {
          owner: c.owner.trim(),
          repo: c.repo.trim(),
          branch: (typeof c.branch === 'string' && c.branch.trim()) || 'main',
          path: ((typeof c.path === 'string' && c.path.trim()) || (typeof c.dataPath === 'string' && c.dataPath.trim()) || 'data/health.json').replace(/^\/+/, ''),
          source
        };
      }
    }
    return null;
  }

  function saveConfig(cfg) {
    writeLocal(KEY_GITHUB, JSON.stringify({
      owner: cfg.owner.trim(), repo: cfg.repo.trim(),
      branch: (cfg.branch || '').trim() || 'main',
      path: ((cfg.path || '').trim() || 'data/health.json').replace(/^\/+/, '')
    }));
  }

  const clearConfig = () => writeLocal(KEY_GITHUB, null);
  const getToken = () => (readLocal(KEY_TOKEN) || '').trim();
  const setToken = (token) => writeLocal(KEY_TOKEN, token.trim() || null);
  const clearToken = () => writeLocal(KEY_TOKEN, null);

  function fileUrl(cfg) {
    const path = cfg.path.split('/').map(encodeURIComponent).join('/');
    return `https://github.com/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/blob/${encodeURIComponent(cfg.branch)}/${path}`;
  }

  // ---------- GitHub Contents API ----------

  function decodeBase64(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function encodeBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  function contentsUrl(cfg) {
    const path = cfg.path.split('/').map(encodeURIComponent).join('/');
    return `${API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${path}`;
  }

  async function httpError(res, cfg, method) {
    let detail = '';
    try { detail = (await res.json()).message || ''; } catch (_) { /* body isn't JSON */ }
    const s = res.status;
    const hasToken = !!getToken();
    if (s === 401) {
      return new StoreError('auth', 'GitHub odrzucił token (401). Mógł wygasnąć albo został wklejony z błędem. Wygeneruj nowy i wklej go w ustawieniach.', s);
    }
    if (s === 429 || (s === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(detail)))) {
      return new StoreError('rate', hasToken
        ? 'Limit zapytań do GitHuba na tę godzinę się wyczerpał. Spróbuj za kilka minut.'
        : 'Limit zapytań do GitHuba bez tokenu (60 na godzinę) się wyczerpał. Dodaj token w ustawieniach albo spróbuj później.', s);
    }
    if (s === 403) {
      return new StoreError('forbidden', `Token nie ma dostępu do ${cfg.owner}/${cfg.repo}${detail ? ` (${detail})` : ''}. ` +
        `W ustawieniach tokenu na GitHubie: Repository access → Only select repositories → ${cfg.repo}, ` +
        'a w Repository permissions → Contents: Read and write. Sam wybór „Public repositories” daje tylko odczyt.', s);
    }
    if (s === 404) {
      const where = `${cfg.path} w ${cfg.owner}/${cfg.repo} (gałąź ${cfg.branch})`;
      if (method === 'GET') {
        return new StoreError('not-found', hasToken
          ? `Nie znaleziono ${where}. Jeśli nazwy się zgadzają, pierwszy zapis utworzy ten plik.`
          : `Nie znaleziono ${where}. Jeśli repozytorium jest prywatne, dodaj token w ustawieniach.`, s);
      }
      return new StoreError('not-found', `Nie można zapisać do ${where}. Sprawdź nazwę repozytorium i gałęzi oraz to, czy token ma do nich dostęp.`, s);
    }
    if (s === 409 || (s === 422 && /sha/i.test(detail))) {
      return new StoreError('conflict', 'Plik na GitHubie zmienił się w trakcie zapisu. Spróbuj jeszcze raz.', s);
    }
    if (s === 422) return new StoreError('invalid', `GitHub odrzucił zapis: ${detail || 'nieprawidłowe dane'}.`, s);
    return new StoreError('http', `GitHub zwrócił błąd ${s}${detail ? `: ${detail}` : ''}.`, s);
  }

  async function request(cfg, method, body) {
    const headers = { Accept: 'application/vnd.github+json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';
    const url = contentsUrl(cfg) + (method === 'GET' ? `?ref=${encodeURIComponent(cfg.branch)}` : '');
    let res;
    try {
      res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    } catch (_) {
      throw new StoreError('network', 'Brak połączenia z GitHubem. Sprawdź internet i spróbuj ponownie.');
    }
    if (res.ok) return res.json();
    throw await httpError(res, cfg, method);
  }

  async function fetchFile(cfg) {
    const json = await request(cfg, 'GET');
    if (Array.isArray(json) || json.type !== 'file') {
      throw new StoreError('invalid', `${cfg.path} w repozytorium nie jest plikiem.`);
    }
    if (typeof json.content !== 'string' || (json.content === '' && json.size > 0)) {
      throw new StoreError('invalid', `${cfg.path} jest za duży dla GitHub Contents API (limit 1 MB).`);
    }
    return { data: parse(decodeBase64(json.content), cfg.path), sha: json.sha };
  }

  function putFile(cfg, text, sha, message) {
    const body = { message, content: encodeBase64(text), branch: cfg.branch };
    if (sha) body.sha = sha;
    return request(cfg, 'PUT', body);
  }

  // ---------- state ----------

  const state = {
    mode: 'empty', // 'github' | 'local' (read-only file next to the app) | 'demo' | 'empty'
    data: normalize({}),
    sha: null,
    config: null,
    loadedAt: 0,
    error: null
  };
  let beforeDemo = null;

  async function load() {
    if (state.mode === 'demo') return state;
    const cfg = getConfig();
    state.config = cfg;
    if (cfg) {
      try {
        const file = await fetchFile(cfg);
        Object.assign(state, { mode: 'github', data: file.data, sha: file.sha, error: null });
      } catch (err) {
        // Keep whatever was shown before; the banner explains what went wrong.
        Object.assign(state, { mode: 'github', error: err instanceof StoreError ? err : new StoreError('http', String(err)) });
      }
      state.loadedAt = Date.now();
      return state;
    }
    // No repo configured: try the data file next to the app (IntelliJ preview, local server).
    try {
      const res = await fetch(LOCAL_FILE, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      Object.assign(state, { mode: 'local', data: parse(await res.text(), 'data/health.json'), sha: null, error: null });
    } catch (err) {
      if (err instanceof StoreError) Object.assign(state, { mode: 'local', error: err });
      else Object.assign(state, { mode: 'empty', data: normalize({}), sha: null, error: null });
    }
    state.loadedAt = Date.now();
    return state;
  }

  function canWrite() {
    if (state.mode === 'demo') return true;
    return state.mode === 'github' && !!getToken() && !(state.error && state.error.kind === 'parse');
  }

  const clone = (x) => JSON.parse(JSON.stringify(x));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Every save: fetch the current file and sha, apply the change to that, write it back.
  // A 409 means someone (usually Claude) committed in between, so the whole cycle repeats.
  async function commit(mutate, message) {
    if (state.mode === 'demo') {
      state.data = normalize(mutate(clone(state.data)));
      return { url: null };
    }
    if (!canWrite()) {
      throw new StoreError('readonly', 'Tylko podgląd. Dodaj token w ustawieniach, żeby zapisywać.');
    }
    const cfg = getConfig();
    for (let attempt = 1; ; attempt++) {
      let fresh;
      try {
        fresh = await fetchFile(cfg);
      } catch (err) {
        if (err.kind !== 'not-found') throw err;
        fresh = { data: normalize({}), sha: null }; // no file yet: this save creates it
      }
      const next = normalize(mutate(clone(fresh.data)));
      if (fresh.sha && serialize(next) === serialize(fresh.data)) {
        Object.assign(state, { mode: 'github', data: next, sha: fresh.sha, error: null, loadedAt: Date.now() });
        return { url: null, unchanged: true };
      }
      const msg = typeof message === 'function' ? message(next) : message;
      try {
        const res = await putFile(cfg, serialize(next), fresh.sha, msg);
        Object.assign(state, { mode: 'github', data: next, sha: res.content ? res.content.sha : null, error: null, loadedAt: Date.now() });
        return { url: res.commit && res.commit.html_url ? res.commit.html_url : null };
      } catch (err) {
        if (err.kind === 'conflict' && attempt < 3) {
          await sleep(500 * attempt);
          continue;
        }
        throw err;
      }
    }
  }

  const blank = (v) => v === undefined || v === null || v === '';
  const sameValue = (a, b) => (blank(a) ? undefined : a) === (blank(b) ? undefined : b);

  function entryMessage(e, date) {
    if (!e) return `log: ${date}`;
    const parts = [];
    if (e.weight != null) parts.push(`${e.weight} kg`);
    if (e.kcal != null) parts.push(`${e.kcal} kcal`);
    if (e.training) parts.push(e.training);
    if (e.mood != null) parts.push(`${e.mood}/5`);
    if (!parts.length && e.note) parts.push('notatka');
    return parts.length ? `log: ${date} (${parts.join(', ')})` : `log: ${date}`;
  }

  // `values` is the form content, `original` the entry as it looked when the form was filled.
  // Fields the user didn't touch keep the value that is on GitHub now, so an edit made from
  // chat in the meantime isn't overwritten by stale form data.
  function upsertEntry(values, original) {
    const date = values.date;
    return commit((data) => {
      const i = data.entries.findIndex((e) => e.date === date);
      const server = i >= 0 ? data.entries[i] : null;
      const merged = Object.assign({}, server || {}, { date });
      ENTRY_FIELDS.forEach((f) => {
        const mine = values[f];
        const touched = !server || !sameValue(mine, original ? original[f] : undefined);
        if (!touched) return;
        if (blank(mine)) delete merged[f];
        else merged[f] = mine;
      });
      if (i >= 0) data.entries[i] = merged;
      else data.entries.push(merged);
      return data;
    }, (next) => entryMessage(next.entries.find((e) => e.date === date), date));
  }

  function deleteEntry(date) {
    return commit((data) => {
      data.entries = data.entries.filter((e) => e.date !== date);
      return data;
    }, `log: usuń ${date}`);
  }

  function saveSettings(patch) {
    return commit((data) => {
      data.settings = normalizeSettings(Object.assign({}, data.settings, patch));
      return data;
    }, (next) => {
      const s = next.settings;
      return `settings: cel ${s.targetWeight} kg do ${s.targetDate}, ${s.kcalTarget} kcal, ${s.weeklyTrainings} treningi/tydz.`;
    });
  }

  // ---------- demo ----------

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Ten weeks of believable data ending today: slow downward trend, water bumps on Mondays,
  // a few heavy weekends, one plan of 4 sessions a week kept about 90% of the time.
  function demoData(today) {
    const end = today || U.todayKey();
    const rnd = mulberry32(20260928);
    const DAYS = 70;
    const start = U.addDays(end, -(DAYS - 1));
    const settings = normalizeSettings(Object.assign({}, DEFAULT_SETTINGS, {
      startDate: start, startWeight: 85, targetDate: U.addDays(start, 184)
    }));
    const missed = new Set([9, 23, 24, 41, 57]);
    const plan = { 0: 'Upper A', 2: 'Lower', 3: 'Upper B', 6: 'Rower' };
    const entries = [];
    for (let i = 0; i < DAYS; i++) {
      const r = [rnd(), rnd(), rnd(), rnd(), rnd(), rnd()]; // fixed draws per day keep the data stable
      if (missed.has(i)) continue;
      const date = U.addDays(start, i);
      const wd = U.weekdayIndex(date);
      const isToday = i === DAYS - 1;
      const e = { date };
      if (r[0] > 0.06 || isToday) {
        e.weight = Math.round((85.2 - 0.055 * i + (r[1] - 0.5) * 0.7 + (wd === 0 ? 0.35 : 0)) * 10) / 10;
      }
      if (!isToday) {
        const binge = wd >= 5 && r[2] < 0.35;
        e.kcal = Math.round((binge ? 2800 + r[3] * 500 : 2300 + r[3] * 300) / 10) * 10;
        if (plan[wd] && r[4] < 0.9) e.training = plan[wd];
        const mood = 3.4 + (r[5] - 0.5) * 2.2 + (e.training ? 0.5 : 0) - (binge ? 0.3 : 0);
        e.mood = U.clamp(Math.round(mood), 2, 5);
      }
      entries.push(e);
    }
    const note = (test, text) => {
      const e = entries.find(test);
      if (e && !e.note) e.note = text;
    };
    const idx = (e) => U.diffDays(start, e.date);
    note((e) => e.training === 'Lower' && idx(e) >= 4, 'Przysiad 100 kg × 5, nowy rekord.');
    note((e) => e.mood === 2 && idx(e) >= 12, 'Słabo spałem, trening na pół gwizdka.');
    note((e) => e.kcal >= 3000 && idx(e) >= 25, 'Wesele u znajomych.');
    note((e) => e.training === 'Rower' && idx(e) >= 40, 'Rower 48 km, spokojne tempo.');
    note((e) => e.training === 'Upper B' && idx(e) >= 55, 'Wyciskanie 80 kg × 6.');
    return normalize({ settings, entries });
  }

  function enterDemo() {
    if (state.mode !== 'demo') {
      beforeDemo = { mode: state.mode, data: state.data, sha: state.sha, error: state.error, loadedAt: state.loadedAt, config: state.config };
    }
    Object.assign(state, { mode: 'demo', data: demoData(), sha: null, error: null });
  }

  function exitDemo() {
    if (state.mode !== 'demo') return;
    Object.assign(state, beforeDemo || { mode: 'empty', data: normalize({}), sha: null, error: null, loadedAt: 0, config: null });
    beforeDemo = null;
  }

  DF.store = {
    DEFAULT_SETTINGS, ENTRY_FIELDS, StoreError, state,
    load, canWrite, upsertEntry, deleteEntry, saveSettings, enterDemo, exitDemo,
    getConfig, saveConfig, clearConfig, getToken, setToken, clearToken, fileUrl,
    normalize, normalizeSettings, cleanEntry, serialize, parse, entryMessage, demoData
  };
})(window.DF = window.DF || {});
