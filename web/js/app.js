/* Dziennik formy: the UI. Data comes from DF.store, numbers from DF.stats. */
(function (DF) {
  'use strict';

  const U = DF.utils;
  const S = DF.stats;
  const store = DF.store;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = U.escapeHtml;

  const WEEKDAYS_LONG = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'];
  const TRAINING_COLORS = ['blue', 'red', 'yellow', 'green', 'steel', 'white'];
  const SEEN_PREFIX = 'dziennik-formy.seen:';
  const RANGE_KEY = 'dziennik-formy.range';
  const HEAT_WEEKS = 20;

  const ui = {
    vm: null,
    range: 30,
    logLimit: 21,
    weekLimit: 8,
    busy: false,
    loading: false,
    original: null, // the entry as it was when the form was filled; used to merge on save
    snap: null, // barbell and badges as last shown; new ones get celebrated
    deleteArmed: false,
    deleteTimer: 0
  };

  const entrySheet = $('#entry-sheet');
  const settingsSheet = $('#settings-sheet');

  // ---------- model ----------

  function compute() {
    const { settings, entries } = store.state.data;
    const today = U.todayKey();
    const prog = S.progress(entries, settings);
    const latest = S.latestWeight(entries);
    const asOf = latest ? latest.date : today;
    const slopeDay = S.slope(entries, today, 21);
    const plan = S.planWeightAt(settings, asOf);
    const planDiff = prog.trend != null ? prog.trend - plan : null;
    const streak = S.streaks(entries, today);
    const week = S.weekSummary(entries, today);
    const kcal = S.kcalSummary(entries, today, settings.kcalTarget);
    const mood = S.moodSummary(entries, today);
    const sleep = S.sleepSummary(entries, today);
    const macros = S.macroSummary(entries, today);
    return {
      settings, entries, today, prog, latest, slopeDay, plan, planDiff, streak, week, kcal, mood, sleep, macros,
      pl: S.plates(prog),
      eta: S.eta(prog.trend, settings.targetWeight, slopeDay, asOf),
      badges: S.badges(entries, settings, today, prog),
      insights: S.insights(entries, today),
      byDate: new Map(entries.map((e) => [e.date, e])),
      coach: S.coachMessage({ settings, entries, today, prog, mood, slopeDay, kcal, week, streak, planDiff, sleep, macros })
    };
  }

  // "B 160 · T 70 · W 290 g", only the macros that are there.
  function macroLine(src, fmt = (x) => x) {
    const parts = S.MACROS.filter(({ key }) => src && src[key] != null).map(({ key, short }) => `${short} ${U.fmtInt(fmt(src[key]))}`);
    return parts.length ? `${parts.join(' · ')} g` : '';
  }

  function trainingColor(name, settings) {
    const i = settings.trainings.indexOf(name);
    return i >= 0 && i < TRAINING_COLORS.length ? TRAINING_COLORS[i] : 'steel';
  }

  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function entrySummary(e) {
    const parts = [];
    if (typeof e.weight === 'number') parts.push(`${U.fmtWeight(e.weight)} kg`);
    if (typeof e.kcal === 'number') parts.push(`${U.fmtInt(e.kcal)} kcal`);
    if (S.isTraining(e)) parts.push(e.training);
    if (!parts.length && S.hasMacros(e)) parts.push(macroLine(e));
    if (!parts.length && e.mood) parts.push(`samopoczucie ${S.MOODS[e.mood].label.toLowerCase()}`);
    if (!parts.length && typeof e.sleep === 'number') parts.push(`sen ${U.fmtHours(e.sleep)} h`);
    if (!parts.length && typeof e.sleepScore === 'number') parts.push(`sen ${e.sleepScore}/100`);
    if (!parts.length && garminParts(e).length) parts.push('dane z Garmina');
    if (!parts.length) parts.push('notatka');
    return parts.join(', ');
  }

  const HRV_LABELS = { balanced: 'zrównoważony', unbalanced: 'niezrównoważony', low: 'niski', poor: 'słaby' };

  // Garmin's numbers for a day: "8 432 kroki · tętno 52 · stres 31 · Body Battery 85→20 · HRV 48 ms (zrównoważony) · VO₂max 47".
  function garminParts(e) {
    const parts = [];
    if (typeof e.steps === 'number') parts.push(`${U.fmtInt(e.steps)} ${U.plural(e.steps, 'krok', 'kroki', 'kroków')}`);
    if (typeof e.restingHr === 'number') parts.push(`tętno spocz. ${e.restingHr}`);
    if (typeof e.stress === 'number') parts.push(`stres ${e.stress}`);
    const bbHigh = typeof e.bodyBatteryHigh === 'number';
    const bbLow = typeof e.bodyBatteryLow === 'number';
    if (bbHigh || bbLow) parts.push(`Body Battery ${bbHigh ? e.bodyBatteryHigh : '–'}→${bbLow ? e.bodyBatteryLow : '–'}`);
    if (typeof e.hrv === 'number') parts.push(`HRV ${e.hrv} ms${e.hrvStatus ? ` (${HRV_LABELS[e.hrvStatus]})` : ''}`);
    else if (e.hrvStatus) parts.push(`HRV ${HRV_LABELS[e.hrvStatus]}`);
    if (typeof e.vo2max === 'number') parts.push(`VO₂max ${U.fmt1(e.vo2max)}`);
    if (e.activity) parts.push(e.activity);
    return parts;
  }

  // Everything logged for a day, for the heatmap caption.
  function dayDetails(e) {
    const parts = [S.isTraining(e) ? e.training : 'bez treningu'];
    if (typeof e.weight === 'number') parts.push(`${U.fmtWeight(e.weight)} kg`);
    if (typeof e.kcal === 'number') parts.push(`${U.fmtInt(e.kcal)} kcal`);
    if (S.hasMacros(e)) parts.push(macroLine(e));
    if (e.mood) parts.push(`samopoczucie ${S.MOODS[e.mood].emoji} ${S.MOODS[e.mood].label.toLowerCase()}`);
    if (typeof e.sleep === 'number') parts.push(`sen ${U.fmtHours(e.sleep)} h`);
    if (typeof e.sleepScore === 'number') parts.push(`ocena snu ${e.sleepScore}/100`);
    return parts.concat(garminParts(e)).join(', ');
  }

  // ---------- render ----------

  function render(vm, anim) {
    document.body.classList.remove('is-loading');
    renderChrome(vm);
    renderPlatform(vm, anim);
    const has = vm.entries.length > 0;
    $('#week').hidden = !has;
    $('#columns').hidden = !has;
    $('#weeks').hidden = !has;
    $('#logbook').hidden = !has;
    if (!has) return;
    renderWeek(vm);
    renderCharts(vm);
    renderWeeks(vm);
    renderHeatmap(vm);
    renderInsights(vm);
    renderBadges(vm);
    renderLog(vm);
  }

  function renderChrome(vm) {
    const n = vm.streak.current;
    const streak = $('#streak');
    streak.hidden = n < 2;
    streak.textContent = `🔥 ${n} ${n === 1 ? 'dzień' : 'dni'}`;
    streak.title = `Dni z wpisem bez przerwy. Rekord: ${vm.streak.best}.`;
    $('#fab').hidden = !store.canWrite(); // also on an empty diary: adding is the point of the page
    $('#btn-refresh').hidden = store.state.mode === 'demo';
    renderBanner(vm.entries.length > 0);
  }

  // Info banners only matter once there is data; the empty state has its own buttons.
  function renderBanner(hasEntries) {
    const st = store.state;
    let kind = 'info';
    let text = '';
    let label = '';
    let action = null;
    if (st.mode === 'demo') {
      kind = 'demo';
      text = 'Przykładowe dane. Nic nie trafia na GitHuba.';
      label = 'Wróć do moich danych';
      action = leaveDemo;
    } else if (st.error) {
      kind = 'error';
      text = st.error.message;
      const inSettings = ['auth', 'forbidden', 'not-found'].includes(st.error.kind);
      label = inSettings ? 'Otwórz ustawienia' : 'Spróbuj ponownie';
      action = inSettings ? openSettings : () => refresh(true);
    } else if (!hasEntries) {
      text = '';
    } else if (st.mode === 'github' && !store.getToken()) {
      text = 'Tylko podgląd. Dodaj token w ustawieniach, żeby zapisywać.';
      label = 'Dodaj token';
      action = openSettings;
    } else if (st.mode === 'local') {
      text = 'Dane z pliku na dysku, tylko podgląd. Dodaj token w ustawieniach, żeby zapisywać.';
      label = 'Dodaj token';
      action = openSettings;
    }
    const banner = $('#banner');
    banner.hidden = !text;
    banner.className = `banner is-${kind}`;
    $('#banner-text').textContent = text;
    const btn = $('#banner-action');
    btn.textContent = label;
    btn.hidden = !action;
    btn.onclick = action;
  }

  function renderPlatform(vm, anim) {
    const s = vm.settings;
    const has = vm.entries.length > 0;
    $('#hello').textContent = s.name ? `Cześć, ${s.name}.` : 'Cześć.';

    const date = `${capitalize(WEEKDAYS_LONG[U.weekdayIndex(vm.today)])}, ${U.fmtLong(vm.today, false)}.`;
    const todays = vm.byDate.get(vm.today);
    let status = '';
    if (has) status = todays ? `Dzisiejszy wpis zapisany: ${entrySummary(todays)}.` : 'Dzisiejszy wpis czeka.';
    $('#today-line').textContent = status ? `${date} ${status}` : date;

    DF.barbell.render($('#barbell'), vm.pl, anim);
    $('#barbell-caption').textContent = barbellCaption(vm);

    const showReadout = vm.prog.trend != null && vm.latest;
    $('#readout').hidden = !showReadout;
    if (showReadout) {
      $('#trend-weight').innerHTML = `${esc(U.fmt1(vm.prog.trend))}<span class="unit">kg</span>`;
      $('#trend-sub').textContent =
        `średnia z 7 dni, ostatni pomiar ${U.fmtWeight(vm.latest.weight)} kg (${U.fmtRelative(vm.latest.date, vm.today)})`;
      $('#facts').innerHTML = facts(vm)
        .map(([dt, dd, sub]) => `<div><dt>${esc(dt)}</dt><dd>${esc(dd)}</dd><dd class="sub">${esc(sub)}</dd></div>`)
        .join('');
    }

    const empty = $('#empty-actions');
    empty.hidden = has;
    if (!has) {
      const first = $('#btn-first');
      first.textContent = 'Dodaj pierwszy wpis';
      first.onclick = () => openEntry();
    }

    const coach = $('#coach');
    coach.hidden = false;
    coach.textContent = vm.coach;
  }

  function barbellCaption(vm) {
    const { pl, prog } = vm;
    const first = Math.abs(pl.per - 1) < 1e-9
      ? 'Każdy zrzucony kilogram to talerz na sztandze.'
      : `Każde zrzucone ${U.fmt1(pl.per)} kg to talerz na sztandze.`;
    if (prog.trend == null) return first;
    if (pl.full >= pl.count) return `${first} Wszystkie talerze założone.`;
    const toNext = Math.max(0.1, (pl.full + 1) * pl.per - Math.max(0, prog.lost));
    return `${first} Założone ${pl.full} z ${pl.count}, następny za ${U.fmt1(toNext)} kg.`;
  }

  function facts(vm) {
    const s = vm.settings;
    const out = [
      ['Zrzucone', `${U.fmt1(Math.max(0, vm.prog.lost))} kg`, `od ${U.fmtWeight(s.startWeight)} kg`],
      ['Zostało', `${U.fmt1(vm.prog.left)} kg`, `do ${U.fmtWeight(s.targetWeight)} kg`]
    ];
    const d = vm.planDiff;
    const planText = Math.abs(d) < 0.1 ? 'równo z planem' : d < 0 ? `${U.fmt1(-d)} kg przed planem` : `${U.fmt1(d)} kg za planem`;
    const planDay = vm.latest.date === vm.today ? 'dziś' : U.fmtShort(vm.latest.date);
    out.push(['Plan', planText, `plan na ${planDay}: ${U.fmt1(vm.plan)} kg`]);

    let eta = 'brak';
    let etaSub = 'za mało pomiarów z 3 tygodni';
    if (vm.prog.trend <= s.targetWeight) {
      eta = 'cel osiągnięty';
      etaSub = `średnia poniżej ${U.fmtWeight(s.targetWeight)} kg`;
    } else if (vm.eta) {
      eta = U.fmtLong(vm.eta);
      etaSub = vm.eta > s.targetDate
        ? `${U.fmtWeight(s.targetWeight)} kg, po terminie ${U.fmtLong(s.targetDate)}`
        : `${U.fmtWeight(s.targetWeight)} kg przy obecnym tempie`;
    } else if (vm.slopeDay != null) {
      etaSub = 'średnia z 3 tygodni nie spada';
    }
    out.push(['Prognoza', eta, etaSub]);
    return out;
  }

  function renderWeek(vm) {
    const s = vm.settings;
    const done = vm.week.trainings;

    const slotsCount = Math.max(s.weeklyTrainings, done.length);
    const slots = Array.from({ length: slotsCount }, (_, i) => {
      const e = done[i];
      return e
        ? `<i class="slot t-${trainingColor(e.training, s)}" title="${esc(`${U.fmtDay(e.date)}: ${e.training}`)}"></i>`
        : '<i class="slot is-open"></i>';
    }).join('');
    const left = s.weeklyTrainings - done.length;
    const trainSub = s.weeklyTrainings === 0 ? 'bez celu tygodniowego' : left > 0 ? `jeszcze ${left}` : 'komplet w tym tygodniu';

    const k = vm.kcal;
    const kcalState = k ? S.kcalState(k.avg, s.kcalTarget) : null;
    const kcalValue = k ? `${U.fmtInt(k.avg)}<small>kcal</small>` : '–';
    const kcalSub = k
      ? `średnia 7 dni, w celu ${k.ok} z ${k.logged} ${k.logged === 1 ? 'dnia' : 'dni'}`
      : 'brak kalorii z 7 dni';

    const mc = vm.macros;
    const protein = mc && mc.protein;
    const proteinValue = protein ? `${U.fmtInt(protein.avg)}<small>g</small>` : '–';
    const rest = mc ? macroLine({ fat: mc.fat && mc.fat.avg, carbs: mc.carbs && mc.carbs.avg }) : '';
    const proteinSub = !mc
      ? 'brak makro z 7 dni'
      : [s.proteinTarget ? `cel ${U.fmtInt(s.proteinTarget)} g` : 'średnia 7 dni', rest].filter(Boolean).join(', ');

    const perWeek = vm.slopeDay != null ? vm.slopeDay * 7 : null;
    const planDays = Math.max(1, U.diffDays(s.startDate, s.targetDate));
    const planWeek = ((s.targetWeight - s.startWeight) / planDays) * 7;
    const paceValue = perWeek != null ? `${U.signed(perWeek)}<small>kg/tydz.</small>` : '–';
    const paceSub = perWeek != null
      ? `ostatnie 3 tygodnie, plan ${U.signed(planWeek, U.fmt2)}`
      : 'za mało pomiarów';

    const m = vm.mood;
    const moodValue = m ? `<span class="emoji" aria-hidden="true">${S.MOODS[Math.round(m.avg)].emoji}</span>${U.fmt1(m.avg)}` : '–';
    const moodRow = U.dayRange(U.addDays(vm.today, -6), vm.today).map((key) => {
      const e = vm.byDate.get(key);
      return e && e.mood
        ? `<span title="${esc(`${U.fmtDay(key)}: ${S.MOODS[e.mood].label}`)}">${S.MOODS[e.mood].emoji}</span>`
        : `<i class="gap" title="${esc(`${U.fmtDay(key)}: brak oceny`)}"></i>`;
    }).join('');

    const sl = vm.sleep;
    const sleepValue = sl && sl.hours != null ? `${U.fmt1(sl.hours)}<small>h</small>` : '–';
    const sleepSub = !sl
      ? 'brak snu z 7 dni'
      : sl.score != null ? `średnia 7 dni, ocena ${U.fmtInt(sl.score)}/100` : 'średnia 7 dni, bez oceny';

    $('#week').innerHTML = `
      <div class="stat">
        <p class="stat-label">Treningi w tym tygodniu</p>
        <p class="stat-value">${done.length}<small>/${s.weeklyTrainings}</small></p>
        <div class="slots" aria-hidden="true">${slots}</div>
        <p class="stat-sub">${esc(trainSub)}</p>
      </div>
      <div class="stat">
        <p class="stat-label">Kalorie</p>
        <p class="stat-value${kcalState === 'over' ? ' is-over' : ''}">${kcalValue}</p>
        <p class="stat-sub">${esc(kcalSub)}</p>
      </div>
      <div class="stat">
        <p class="stat-label">Białko</p>
        <p class="stat-value">${proteinValue}</p>
        <p class="stat-sub">${esc(proteinSub)}</p>
      </div>
      <div class="stat">
        <p class="stat-label">Tempo</p>
        <p class="stat-value">${paceValue}</p>
        <p class="stat-sub">${esc(paceSub)}</p>
      </div>
      <div class="stat">
        <p class="stat-label">Samopoczucie</p>
        <p class="stat-value">${moodValue}</p>
        <p class="mood-row" aria-label="Samopoczucie z ostatnich 7 dni">${moodRow}</p>
      </div>
      <div class="stat">
        <p class="stat-label">Sen</p>
        <p class="stat-value">${sleepValue}</p>
        <p class="stat-sub">${esc(sleepSub)}</p>
      </div>`;
  }

  // Week by week, newest first: a calendar row of days plus what the week averaged out to.
  function renderWeeks(vm) {
    const all = S.weeks(vm.entries, vm.today);
    const rows = all.slice().reverse();
    const writable = store.canWrite();
    $('#weeks-list').innerHTML = rows.slice(0, ui.weekLimit).map((w) => weekCard(w, vm, writable)).join('');
    $('#btn-weeks-more').hidden = rows.length <= ui.weekLimit;
    $('#weeks-note').textContent = `${all.length} ${U.plural(all.length, 'tydzień', 'tygodnie', 'tygodni')} od pierwszego wpisu`;
  }

  function weekDelta(delta) {
    if (delta == null) return '';
    const d = Math.round(delta * 10) / 10; // one decimal, like the average it sits next to
    const title = 'Zmiana średniej wobec poprzedniego tygodnia z pomiarami';
    if (d === 0) return ` <em class="delta" title="${esc(title)}">bez zmian</em>`;
    return ` <em class="delta is-${d < 0 ? 'down' : 'up'}" title="${esc(title)}">${d < 0 ? '▼' : '▲'} ${U.fmt1(Math.abs(d))}</em>`;
  }

  function weekDay(d, vm, writable) {
    const e = d.entry;
    const cls = ['wk-day'];
    if (d.key === vm.today) cls.push('is-today');
    if (d.future) cls.push('is-future');
    else if (!e) cls.push('is-empty');
    const what = e ? entrySummary(e) : d.future ? 'jeszcze przed nami' : 'brak wpisu';
    const label = `${U.fmtDay(d.key)}: ${what}`;
    const weight = e && typeof e.weight === 'number' ? U.fmtWeight(e.weight) : '';
    const marks = e
      ? (S.isTraining(e) ? `<i class="dot t-${trainingColor(e.training, vm.settings)}"></i>` : '') +
        (e.mood ? `<span class="emoji">${S.MOODS[e.mood].emoji}</span>` : '')
      : '';
    const tag = writable && !d.future ? 'button' : 'div';
    const attrs = tag === 'button' ? ` type="button" data-date="${d.key}"` : '';
    return `<${tag} class="${cls.join(' ')}"${attrs} title="${esc(label)}" aria-label="${esc(label)}">` +
      `<span class="wk-num">${U.fromKey(d.key).getDate()}</span>` +
      `<span class="wk-kg">${weight}</span>` +
      `<span class="wk-mark">${marks}</span>` +
      `</${tag}>`;
  }

  function weekCard(w, vm, writable) {
    const s = vm.settings;
    const current = w.start === U.weekStart(vm.today);
    const avg = w.weight
      ? `${U.fmt1(w.weight.avg)}<small>kg</small>${weekDelta(w.delta)}`
      : '<span class="none">–</span>';
    const sub = w.weight
      ? `średnia z ${w.weight.count} ${U.plural(w.weight.count, 'pomiaru', 'pomiarów', 'pomiarów')}`
      : 'bez pomiarów wagi';
    const kcal = w.kcal
      ? `<span class="kcal-${S.kcalState(w.kcal.avg, s.kcalTarget)}">${U.fmtInt(w.kcal.avg)}<small> kcal/dzień</small></span>`
      : '<span class="none">–</span>';
    const trainings = `${w.trainings.length}${s.weeklyTrainings > 0 ? `<small>/${s.weeklyTrainings}</small>` : ''}`;
    const mood = w.mood
      ? `<span class="emoji">${S.MOODS[Math.round(w.mood.avg)].emoji}</span>${U.fmt1(w.mood.avg)}`
      : '<span class="none">–</span>';
    const sleepParts = [];
    if (w.sleep) sleepParts.push(`${U.fmt1(w.sleep.avg)}<small> h</small>`);
    if (w.sleepScore) sleepParts.push(`${U.fmtInt(w.sleepScore.avg)}<small>/100</small>`);
    const sleep = sleepParts.length ? sleepParts.join(' <small>·</small> ') : '<span class="none">–</span>';
    const macros = w.macros
      ? esc(macroLine({ protein: w.macros.protein && w.macros.protein.avg, fat: w.macros.fat && w.macros.fat.avg, carbs: w.macros.carbs && w.macros.carbs.avg }))
      : '<span class="none">–</span>';
    const g = w.garmin || {};
    const garminFacts = (g.steps ? `<div><dt>Kroki</dt><dd>${U.fmtInt(g.steps.avg)}<small>/dzień</small></dd></div>` : '') +
      (g.restingHr || g.hrv
        ? `<div><dt>Tętno · HRV</dt><dd>${g.restingHr ? U.fmtInt(g.restingHr.avg) : '–'}<small> bpm</small> <small>·</small> ${g.hrv ? U.fmtInt(g.hrv.avg) : '–'}<small> ms</small></dd></div>`
        : '');
    return `<article class="wk${current ? ' is-current' : ''}">` +
      '<div class="wk-top">' +
        `<h3 class="wk-range">${U.fmtRange(w.start, w.end)}${current ? '<span class="wk-tag">ten tydzień</span>' : ''}</h3>` +
        `<p class="wk-avg">${avg}</p>` +
        `<p class="wk-sub">${esc(sub)}</p>` +
      '</div>' +
      `<div class="wk-days">${w.days.map((d) => weekDay(d, vm, writable)).join('')}</div>` +
      '<dl class="wk-facts">' +
        `<div><dt>Kalorie</dt><dd>${kcal}</dd></div>` +
        `<div><dt>Makro</dt><dd title="Białko, tłuszcze, węgle: średnia na dzień">${macros}</dd></div>` +
        `<div><dt>Treningi</dt><dd>${trainings}</dd></div>` +
        `<div><dt>Samopoczucie</dt><dd>${mood}</dd></div>` +
        `<div><dt>Sen</dt><dd>${sleep}</dd></div>` +
        garminFacts +
        `<div><dt>Wpisy</dt><dd>${w.logged}<small>/7</small></dd></div>` +
      '</dl>' +
      '</article>';
  }

  function renderCharts(vm) {
    if (!vm || !vm.entries.length || !DF.charts.setup()) return;
    $$('#range button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === String(ui.range))));
    DF.charts.weight($('#chart-weight'), vm, ui.range);
    DF.charts.kcal($('#chart-kcal'), vm, ui.range);
    DF.charts.macro($('#chart-macro'), vm, ui.range);
    const s = vm.settings;
    $('#macro-note').textContent = S.MACROS.some(({ key }) => s[`${key}Target`] != null)
      ? `cel: ${macroLine({ protein: s.proteinTarget, fat: s.fatTarget, carbs: s.carbsTarget })}`
      : '';
    DF.charts.sleep($('#chart-sleep'), vm, ui.range);
    DF.charts.sleepScore($('#chart-sleep-score'), vm, ui.range);
  }

  function moodAlpha(mood) {
    return mood ? [0, 0.35, 0.5, 0.68, 0.84, 1][mood] : 0.9;
  }

  function renderHeatmap(vm) {
    const s = vm.settings;
    const firstSunday = U.addDays(U.weekStart(vm.today), -7 * (HEAT_WEEKS - 1));
    const lastDay = U.addDays(U.weekStart(vm.today), 6);
    const cells = [];
    const starts = [];
    let trainings = 0;

    for (let w = 0; w < HEAT_WEEKS; w++) {
      for (let d = 0; d < 7; d++) {
        const key = U.addDays(firstSunday, w * 7 + d);
        if (U.fromKey(key).getDate() === 1) starts.push([w, key]);
        const e = vm.byDate.get(key);
        let cls = 'hm-cell';
        let style = `grid-column:${w + 2};grid-row:${d + 2}`;
        if (key > vm.today) {
          cls += ' is-future';
        } else if (e && S.isTraining(e)) {
          cls += ` t-${trainingColor(e.training, s)}`;
          style += `;--a:${moodAlpha(e.mood)}`;
          trainings++;
        } else {
          cls += e ? ' is-rest' : ' is-empty';
        }
        if (key === vm.today) cls += ' is-today';
        cells.push(`<span class="${cls}" style="${style}" data-key="${key}"></span>`);
      }
    }
    if (!starts.length || starts[0][0] >= 3) starts.unshift([0, firstSunday]);
    const months = starts
      .filter(([w]) => w <= HEAT_WEEKS - 3) // a label in the last columns would stick out of the grid
      .map(([w, key]) => `<span class="hm-month" style="grid-column:${w + 2}">${U.monthShort(key)}</span>`);
    const weekdays = [[3, 'pn'], [5, 'śr'], [7, 'pt']].map(([row, t]) => `<span class="hm-wd" style="grid-row:${row}">${t}</span>`);

    const heat = $('#heatmap');
    heat.innerHTML = months.join('') + weekdays.join('') + cells.join('');
    heat.setAttribute('aria-label', `Treningi od ${U.fmtShort(firstSunday)} do ${U.fmtShort(lastDay)}: ${trainings}.`);

    const total = vm.entries.filter(S.isTraining).length;
    $('#train-count').textContent = `${total} ${U.plural(total, 'trening', 'treningi', 'treningów')} od startu`;
    $('#heat-caption').textContent = 'Mocniejszy kolor to lepsze samopoczucie. Stuknij dzień, żeby zobaczyć szczegóły.';
    $('#heat-legend').innerHTML = s.trainings
      .map((t) => `<span class="lg"><i class="sw sw-sq t-${trainingColor(t, s)}"></i>${esc(t)}</span>`)
      .concat('<span class="lg"><i class="sw sw-sq is-rest"></i>bez treningu</span>')
      .join('');
  }

  const INSIGHT_WORDS = {
    mood: { fmt: (v) => U.fmt1(v), unit: '', subject: 'samopoczucie jest średnio', more: 'wyższe', less: 'niższe', flat: 'Samopoczucie podobne w obu przypadkach.' },
    kcal: { fmt: (v) => U.fmtInt(v), unit: ' kcal', subject: 'jesz średnio', more: 'więcej', less: 'mniej', flat: 'Kalorie podobne w obu przypadkach.' },
    hours: { fmt: (v) => U.fmt1(v), unit: ' h', subject: 'śpisz średnio', more: 'dłużej', less: 'krócej', flat: 'Sen podobny w obu przypadkach.' }
  };

  function insightValue(kind, v) {
    const w = INSIGHT_WORDS[kind];
    const emoji = kind === 'mood' ? `<span class="emoji" aria-hidden="true">${S.MOODS[U.clamp(Math.round(v), 1, 5)].emoji}</span>` : '';
    return `${emoji}${esc(w.fmt(v))}<small>${w.unit}</small>`;
  }

  function insightItem(it) {
    const w = INSIGHT_WORDS[it.kind];
    const days = (n) => `${n} ${U.plural(n, 'dzień', 'dni', 'dni')}`;
    if (!it.ready) {
      const need = [[it.labelA, it.a.n], [it.labelB, it.b.n]]
        .filter(([, n]) => n < S.INSIGHT_MIN)
        .map(([label, n]) => `${label}: ${n} z ${S.INSIGHT_MIN}`);
      return `<li class="insight is-pending"><h3>${esc(it.title)}</h3><p>Za mało danych (${esc(need.join(', '))}).</p></li>`;
    }
    const text = it.strong
      ? `${capitalize(it.labelA)} ${w.subject} o ${w.fmt(Math.abs(it.diff))}${w.unit} ${it.diff > 0 ? w.more : w.less} niż ${it.labelB}.`
      : w.flat;
    const row = (label, g) => `<div><dt>${esc(label)}</dt><dd>${insightValue(it.kind, g.avg)}</dd><dd class="n">${esc(days(g.n))}</dd></div>`;
    return `<li class="insight${it.strong ? ' is-strong' : ''}"><h3>${esc(it.title)}</h3><p>${esc(text)}</p>` +
      `<dl>${row(it.labelA, it.a)}${row(it.labelB, it.b)}</dl></li>`;
  }

  function renderInsights(vm) {
    // Strong findings first, then the rest that have data, then the ones still waiting.
    const rank = (it) => (it.strong ? 0 : it.ready ? 1 : 2);
    const list = vm.insights.slice().sort((a, b) => rank(a) - rank(b));
    $('#insights').innerHTML = list.map(insightItem).join('');
    const ready = list.filter((it) => it.ready).length;
    $('#insights-caption').textContent = ready
      ? 'Średnie z Twoich wpisów, nie dowód przyczyny. Im więcej dni, tym pewniejszy wynik.'
      : `Każde porównanie potrzebuje co najmniej ${S.INSIGHT_MIN} dni w obu grupach. Sen z danego dnia to noc przed nim.`;
  }

  function renderBadges(vm) {
    const on = vm.badges.filter((b) => b.unlocked).length;
    $('#badges-count').textContent = `${on} z ${vm.badges.length}`;
    $('#badges').innerHTML = vm.badges.map((b) => `
      <li>
        <button type="button" class="badge b-${b.color} ${b.unlocked ? 'is-on' : 'is-off'}" data-id="${b.id}"
          aria-label="${esc(`${b.title}. ${b.desc}. ${b.unlocked ? 'Zdobyta' : 'Do zdobycia'}.`)}">
          <span class="badge-plate" aria-hidden="true"><span>${esc(b.mark)}</span></span>
          <span class="badge-title" aria-hidden="true">${esc(b.title)}</span>
        </button>
      </li>`).join('');
    $('#badge-caption').textContent = 'Stuknij odznakę, żeby zobaczyć, za co jest.';
  }

  function renderLog(vm) {
    const s = vm.settings;
    const all = S.sorted(vm.entries);
    const prevWeight = new Map();
    let last = null;
    all.forEach((e) => {
      if (typeof e.weight === 'number') {
        prevWeight.set(e.date, last);
        last = e.weight;
      }
    });
    const rows = all.reverse();
    const writable = store.canWrite();
    let html = '';
    let month = '';
    rows.slice(0, ui.logLimit).forEach((e) => {
      const m = U.monthTitle(e.date);
      if (m !== month) {
        html += `${month ? '</ul>' : ''}<h3 class="log-month">${m}</h3><ul class="log-list">`;
        month = m;
      }
      html += `<li>${logRow(e, prevWeight.get(e.date), s, writable, vm.today)}</li>`;
    });
    if (month) html += '</ul>';
    $('#log').innerHTML = html;
    $('#btn-more').hidden = rows.length <= ui.logLimit;
    $('#log-count').textContent = `${rows.length} ${U.plural(rows.length, 'wpis', 'wpisy', 'wpisów')}`;
  }

  function logRow(e, prev, s, writable, today) {
    const tag = writable ? 'button' : 'div';
    const attrs = writable ? ` type="button" data-date="${e.date}" title="Edytuj wpis"` : '';
    const none = '<span class="none">–</span>';

    let weight = none;
    if (typeof e.weight === 'number') {
      weight = `${U.fmtWeight(e.weight)}<small> kg</small>`;
      const diff = prev != null ? Math.round((e.weight - prev) * 100) / 100 : 0;
      if (diff < 0) weight += ` <em class="delta is-down" title="Mniej niż w poprzednim pomiarze">▼ ${U.fmtWeight(-diff)}</em>`;
      else if (diff > 0) weight += ` <em class="delta is-up" title="Więcej niż w poprzednim pomiarze">▲ ${U.fmtWeight(diff)}</em>`;
    }
    const macros = S.hasMacros(e) ? `<small class="log-macro" title="Białko, tłuszcze, węgle">${esc(macroLine(e))}</small>` : '';
    const kcal = (typeof e.kcal === 'number'
      ? `<span class="kcal-${S.kcalState(e.kcal, s.kcalTarget)}">${U.fmtInt(e.kcal)}<small> kcal</small></span>`
      : macros ? '' : none) + macros;
    const training = S.isTraining(e)
      ? `<i class="dot t-${trainingColor(e.training, s)}"></i>${esc(e.training)}`
      : '<span class="none">bez treningu</span>';
    const mood = e.mood ? `<span title="${S.MOODS[e.mood].label}">${S.MOODS[e.mood].emoji}</span>` : '';
    const sleepParts = [];
    if (typeof e.sleep === 'number') sleepParts.push(`${U.fmtHours(e.sleep)}<small> h</small>`);
    if (typeof e.sleepScore === 'number') sleepParts.push(`<small title="Ocena snu">${e.sleepScore}/100</small>`);
    const sleep = sleepParts.length ? `<span class="log-sleep" title="Sen">${sleepParts.join(' ')}</span>` : '';
    const garmin = garminParts(e);
    const garminLine = garmin.length ? `<span class="log-garmin" title="Z Garmina">${esc(garmin.join(' · '))}</span>` : '';
    const note = e.note ? `<span class="log-note">${esc(e.note)}</span>` : '';

    return `<${tag} class="log-row${e.date === today ? ' is-today' : ''}"${attrs}>` +
      `<span class="log-day"><b>${U.fromKey(e.date).getDate()}</b><small>${U.WEEKDAYS[U.weekdayIndex(e.date)]}</small></span>` +
      `<span class="log-weight">${weight}</span>` +
      `<span class="log-kcal">${kcal}</span>` +
      `<span class="log-train">${training}</span>` +
      `<span class="log-mood">${mood}</span>` +
      sleep +
      garminLine +
      note +
      `</${tag}>`;
  }

  // ---------- updates and celebrations ----------

  function snapshot(vm) {
    return { full: vm.pl.full, count: vm.pl.count, badges: vm.badges.filter((b) => b.unlocked).map((b) => b.id) };
  }

  function seenKey() {
    const cfg = store.getConfig();
    return SEEN_PREFIX + (cfg ? `${cfg.owner}/${cfg.repo}` : 'local');
  }

  function readSeen() {
    try { return JSON.parse(localStorage.getItem(seenKey()) || 'null'); } catch (_) { return null; }
  }

  function writeSeen(snap) {
    try { localStorage.setItem(seenKey(), JSON.stringify(snap)); } catch (_) { /* ignore */ }
  }

  // kind: 'init' (first render or back from demo), 'demo', 'save', 'reload'
  function update(kind, info = {}) {
    const vm = compute();
    ui.vm = vm;
    const before = kind === 'init' ? readSeen() : kind === 'demo' ? null : ui.snap;
    const after = snapshot(vm);
    const grew = !!before && before.count === after.count && after.full > before.full;
    const fresh = kind === 'init' || kind === 'demo';

    if (grew && !fresh) {
      const r = $('#barbell').getBoundingClientRect();
      if (r.bottom < 60) window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    render(vm, { animateFrom: fresh ? 0 : grew ? before.full : null, delay: grew && !fresh ? 350 : 0 });

    if (before && kind !== 'demo') {
      const landed = fresh ? 150 + after.full * 110 + 650 : 350 + 700;
      celebrate(before, after, vm, info, landed);
    }
    ui.snap = after;
    if (store.state.mode === 'github' || store.state.mode === 'local') writeSeen(after);
  }

  function celebrate(before, after, vm, info, delay) {
    const news = [];
    if (before.count === after.count && after.full > before.full) {
      const n = after.full - before.full;
      news.push(`${n === 1 ? 'Nowy talerz' : `${n} ${U.plural(n, 'nowy talerz', 'nowe talerze', 'nowych talerzy')}`} na sztandze. ${U.fmt1(vm.prog.lost)} kg w dół.`);
    }
    vm.badges
      .filter((b) => b.unlocked && !before.badges.includes(b.id))
      .forEach((b) => news.push(`Nowa odznaka: ${b.title}.`));
    if (info.weightDate && vm.latest && vm.latest.date === info.weightDate && S.isNewLow(vm.entries, vm.today)) {
      news.push('Najniższa waga od startu.');
    }
    if (!news.length) return;
    setTimeout(() => DF.confetti.burst(barbellOrigin()), delay);
    news.forEach((text, i) => setTimeout(() => toast(text), delay + i * 400));
  }

  function barbellOrigin() {
    const r = $('#barbell').getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.45 };
  }

  async function refresh(manual) {
    if (ui.loading || store.state.mode === 'demo') return;
    ui.loading = true;
    $('#btn-refresh').classList.add('is-spinning');
    await store.load();
    ui.loading = false;
    $('#btn-refresh').classList.remove('is-spinning');
    update('reload');
    if (manual && !store.state.error) toast('Dane odświeżone');
  }

  function showDemo() {
    store.enterDemo();
    closeSheet(settingsSheet, true);
    ui.logLimit = 21;
    ui.weekLimit = 8;
    update('demo');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function leaveDemo() {
    store.exitDemo();
    closeSheet(settingsSheet, true);
    ui.logLimit = 21;
    ui.weekLimit = 8;
    update('init');
    await refresh(false);
  }

  // ---------- toasts, sheets, busy state ----------

  function toast(text, action, isError) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = `toast${isError ? ' is-error' : ''}`;
    const p = document.createElement('p');
    p.textContent = text;
    el.append(p);
    if (action) {
      const a = document.createElement('a');
      a.href = action.href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = action.label;
      el.append(a);
    }
    box.append(el);
    while (box.children.length > 4) box.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 300);
    }, isError ? 7000 : 4500);
  }

  function showSheet(dialog) {
    if (!dialog.open) dialog.showModal();
  }

  function closeSheet(dialog, force) {
    if (ui.busy && !force) return;
    if (dialog.open) dialog.close();
  }

  function setBusy(on, button, label) {
    ui.busy = on;
    document.body.classList.toggle('is-busy', on);
    if (!button) return;
    if (on) {
      button.dataset.label = button.textContent;
      button.textContent = label;
      button.disabled = true;
    } else {
      if (button.dataset.label) button.textContent = button.dataset.label;
      button.disabled = false;
    }
  }

  function showMsg(sel, text, isError) {
    const el = $(sel);
    el.hidden = false;
    el.textContent = text;
    el.classList.toggle('is-error', !!isError);
  }

  function hideMsg(sel) {
    $(sel).hidden = true;
  }

  // ---------- entry form ----------

  const blank = (v) => v === undefined || v === null || v === '';
  const same = (a, b) => (blank(a) ? undefined : a) === (blank(b) ? undefined : b);

  function readForm() {
    const weightRaw = $('#f-weight').value.trim();
    const kcalRaw = $('#f-kcal').value.trim();
    const training = $('#f-trainings [aria-pressed="true"]');
    const mood = $('#f-moods [aria-pressed="true"]');
    const sleepRaw = $('#f-sleep').value.trim();
    const sleepScoreRaw = $('#f-sleep-score').value.trim();
    const macroRaw = {};
    const macros = {};
    S.MACROS.forEach(({ key }) => {
      macroRaw[key] = $(`#f-${key}`).value.trim();
      macros[key] = U.parseNumber(macroRaw[key]);
    });
    return {
      date: $('#f-date').value,
      weightRaw,
      kcalRaw,
      sleepRaw,
      sleepScoreRaw,
      macroRaw,
      ...macros,
      weight: U.parseNumber(weightRaw),
      kcal: U.parseNumber(kcalRaw),
      training: training ? training.dataset.training : '',
      mood: mood ? Number(mood.dataset.mood) : null,
      sleep: U.parseNumber(sleepRaw),
      sleepScore: U.parseNumber(sleepScoreRaw),
      note: $('#f-note').value.trim()
    };
  }

  function formEntry(v) {
    const e = { date: v.date };
    if (v.weight != null) e.weight = Math.round(v.weight * 100) / 100;
    if (v.kcal != null) e.kcal = Math.round(v.kcal);
    S.MACROS.forEach(({ key }) => { if (v[key] != null) e[key] = Math.round(v[key]); });
    if (v.training) e.training = v.training;
    if (v.mood) e.mood = v.mood;
    if (v.sleep != null) e.sleep = Math.round(v.sleep * 100) / 100;
    if (v.sleepScore != null) e.sleepScore = Math.round(v.sleepScore);
    if (v.note) e.note = v.note.slice(0, 280);
    return e;
  }

  function validate(v) {
    const L = store.LIMITS;
    const out = (n, [lo, hi]) => n != null && (n < lo || n > hi);
    const range = ([lo, hi]) => `${U.fmtInt(lo)}–${U.fmtInt(hi)}`;
    if (!U.isValidKey(v.date)) return 'Wybierz dzień.';
    if (v.date > U.todayKey()) return 'Nie da się dodać wpisu z przyszłości.';
    if (v.weightRaw && v.weight == null) return 'Waga musi być liczbą, np. 84,2.';
    if (out(v.weight, L.weight)) return `Waga poza zakresem ${range(L.weight)} kg.`;
    if (v.kcalRaw && v.kcal == null) return 'Kalorie muszą być liczbą, np. 2450.';
    if (out(v.kcal, L.kcal)) return `Kalorie poza zakresem ${range(L.kcal)}.`;
    for (const { key, label } of S.MACROS) {
      if (v.macroRaw[key] && v[key] == null) return `${label} musi być liczbą gramów, np. 160.`;
      if (out(v[key], L.macro)) return `${label} poza zakresem ${range(L.macro)} g.`;
    }
    if (v.sleepRaw && v.sleep == null) return 'Sen musi być liczbą godzin, np. 7,5.';
    if (out(v.sleep, L.sleep)) return `Sen poza zakresem ${range(L.sleep)} h.`;
    if (v.sleepScoreRaw && v.sleepScore == null) return 'Ocena snu musi być liczbą, np. 82.';
    if (out(v.sleepScore, L.sleepScore)) return `Ocena snu poza zakresem ${range(L.sleepScore)}.`;
    const noMacros = S.MACROS.every(({ key }) => v[key] == null);
    if (v.weight == null && v.kcal == null && noMacros && !v.training && !v.mood && v.sleep == null && v.sleepScore == null && !v.note) {
      return 'Wpisz przynajmniej jedną rzecz: wagę, kalorie, makro, trening, samopoczucie, sen albo notatkę.';
    }
    return null;
  }

  function isDirty() {
    const now = formEntry(readForm());
    const was = ui.original || {};
    return store.FORM_FIELDS.some((f) => !same(now[f], was[f]));
  }

  function showFormError(text) {
    const el = $('#entry-error');
    el.hidden = false;
    el.textContent = text;
  }

  function hideFormError() {
    $('#entry-error').hidden = true;
  }

  function pressOnly(container, match) {
    $$('[aria-pressed]', container).forEach((b) => b.setAttribute('aria-pressed', String(match(b))));
  }

  function buildTrainingChips(settings, current) {
    const names = settings.trainings.slice();
    if (current && !names.includes(current)) names.push(current);
    $('#f-trainings').innerHTML = names
      .map((t) => `<button type="button" class="chip" data-training="${esc(t)}" aria-pressed="false"><i class="dot t-${trainingColor(t, settings)}"></i>${esc(t)}</button>`)
      .concat('<button type="button" class="chip" data-training="" aria-pressed="false">Bez treningu</button>')
      .join('');
  }

  function weightPlaceholder(date) {
    const before = S.weightEntries(ui.vm.entries).filter((e) => e.date <= date);
    const ref = before.length ? before[before.length - 1] : ui.vm.latest;
    return ref ? U.weightInput(ref.weight) : U.weightInput(ui.vm.settings.startWeight);
  }

  function updateDayChips() {
    const date = $('#f-date').value;
    $$('.day-chip').forEach((b) => {
      b.setAttribute('aria-pressed', String(date === U.addDays(U.todayKey(), Number(b.dataset.offset))));
    });
  }

  function updateKcalHint() {
    const target = ui.vm.settings.kcalTarget;
    const k = U.parseNumber($('#f-kcal').value);
    const hint = $('#kcal-hint');
    hint.className = 'hint';
    if (k == null || k < 0) {
      hint.textContent = `Cel: ${U.fmtInt(target)} kcal`;
      return;
    }
    const state = S.kcalState(k, target);
    const diff = Math.round(k - target);
    hint.textContent = state === 'ok'
      ? `W celu (${U.signed(diff, U.fmtInt)} kcal)`
      : state === 'over' ? `${U.fmtInt(diff)} kcal ponad cel` : `${U.fmtInt(-diff)} kcal poniżej celu`;
    hint.classList.add(`is-${state}`);
  }

  // Calories implied by the typed macros, and how far they are from the typed calories.
  function updateMacroHint() {
    const v = readForm();
    const hint = $('#macro-hint');
    const s = ui.vm.settings;
    const fromMacros = S.macroKcal(v);
    const goal = macroLine({ protein: s.proteinTarget, fat: s.fatTarget, carbs: s.carbsTarget });
    if (fromMacros == null) {
      hint.textContent = goal ? `Cel: ${goal}` : 'Opcjonalnie. Z trzech wartości policzę kalorie.';
      $('#f-kcal').placeholder = 'np. 2450';
      return;
    }
    $('#f-kcal').placeholder = String(Math.round(fromMacros));
    const typed = v.kcal;
    const off = typed != null && typed > 0 ? Math.abs(fromMacros - typed) / typed : 0;
    hint.textContent = `Z makro wychodzi ${U.fmtInt(fromMacros)} kcal` +
      (off > 0.1 ? `, a w kaloriach jest ${U.fmtInt(typed)}. Sprawdź, czy wszystko się zgadza.` : typed == null ? '. Puste pole kalorii uzupełni się tą wartością.' : '.');
  }

  // keepTyped: switching to a day without an entry keeps what the user already typed.
  function fillForm(date, keepTyped) {
    const e = ui.vm.byDate.get(date) || null;
    ui.original = e ? Object.assign({}, e) : null;
    $('#entry-title').textContent = e ? 'Edytuj wpis' : 'Nowy wpis';
    $('#btn-delete').hidden = !e;
    disarmDelete();
    hideFormError();
    $('#f-weight').placeholder = weightPlaceholder(date);
    updateDayChips();
    if (!e && keepTyped) return;
    $('#f-weight').value = e && typeof e.weight === 'number' ? U.weightInput(e.weight) : '';
    $('#f-kcal').value = e && typeof e.kcal === 'number' ? String(e.kcal) : '';
    S.MACROS.forEach(({ key }) => { $(`#f-${key}`).value = e && typeof e[key] === 'number' ? String(e[key]) : ''; });
    buildTrainingChips(ui.vm.settings, e && e.training);
    pressOnly($('#f-trainings'), (b) => !!e && b.dataset.training === (e.training || ''));
    pressOnly($('#f-moods'), (b) => !!e && Number(b.dataset.mood) === e.mood);
    $('#f-sleep').value = e && typeof e.sleep === 'number' ? U.fmtHours(e.sleep) : '';
    $('#f-sleep-score').value = e && typeof e.sleepScore === 'number' ? String(e.sleepScore) : '';
    $('#f-note').value = e && e.note ? e.note : '';
    updateKcalHint();
    updateMacroHint();
  }

  function openEntry(date) {
    if (!store.canWrite()) {
      toast('Dodaj token w ustawieniach, żeby zapisywać wpisy.');
      openSettings();
      return;
    }
    const d = date || U.todayKey();
    const input = $('#f-date');
    input.max = U.todayKey();
    input.value = d;
    fillForm(d, false);
    showSheet(entrySheet);
    if (window.matchMedia('(pointer: fine)').matches) $('#f-weight').focus();
  }

  function stepWeight(step) {
    const input = $('#f-weight');
    const current = U.parseNumber(input.value);
    const base = current != null ? current : U.parseNumber(input.placeholder);
    if (base == null) return;
    input.value = U.weightInput(Math.round((base + (current != null ? step : 0)) * 100) / 100);
  }

  function disarmDelete() {
    clearTimeout(ui.deleteTimer);
    ui.deleteArmed = false;
    const btn = $('#btn-delete');
    btn.textContent = 'Usuń wpis';
    btn.classList.remove('is-armed');
  }

  async function onSave(ev) {
    ev.preventDefault();
    if (ui.busy) return;
    const v = readForm();
    const error = validate(v);
    if (error) {
      showFormError(error);
      return;
    }
    hideFormError();
    const entry = formEntry(v);
    const fromMacros = S.macroKcal(entry);
    if (entry.kcal == null && fromMacros != null) entry.kcal = Math.round(fromMacros);
    const btn = $('#btn-save');
    setBusy(true, btn, 'Zapisuję…');
    try {
      const res = await store.upsertEntry(entry, ui.original);
      setBusy(false, btn);
      closeSheet(entrySheet, true);
      update('save', { weightDate: entry.weight != null ? entry.date : null });
      toast(res.unchanged ? 'Bez zmian' : 'Wpis zapisany');
    } catch (err) {
      setBusy(false, btn);
      showFormError(err.message);
    }
  }

  async function onDelete() {
    if (ui.busy || !ui.original) return;
    const btn = $('#btn-delete');
    if (!ui.deleteArmed) {
      ui.deleteArmed = true;
      btn.textContent = 'Na pewno usunąć?';
      btn.classList.add('is-armed');
      ui.deleteTimer = setTimeout(disarmDelete, 4000);
      return;
    }
    disarmDelete();
    const date = ui.original.date;
    setBusy(true, btn, 'Usuwam…');
    try {
      const res = await store.deleteEntry(date);
      setBusy(false, btn);
      closeSheet(entrySheet, true);
      update('save');
      toast('Wpis usunięty');
    } catch (err) {
      setBusy(false, btn);
      showFormError(err.message);
    }
  }

  // ---------- settings ----------

  function renderConnStatus() {
    const cfg = store.getConfig();
    const token = store.getToken();
    const st = store.state;
    let html;
    if (!cfg) {
      html = 'Nie wiadomo, z którego repozytorium czytać. Uzupełnij owner i repo w pliku web/config.js.';
    } else {
      const branch = st.branch || cfg.staging;
      const link = `<a href="${esc(store.fileUrl(cfg, branch))}" target="_blank" rel="noopener">${esc(`${cfg.owner}/${cfg.repo}`)}</a>`;
      const write = token ? 'Zapis włączony.' : 'Bez tokenu: tylko podgląd.';
      const weekly = cfg.staging === cfg.branch ? ''
        : ` Wpisy zapisują się na gałęzi ${esc(cfg.staging)}, a do ${esc(cfg.branch)} trafiają jednym commitem w niedzielę o 10:00 (tydzień od niedzieli do soboty).`;
      html = st.mode !== 'demo' && st.error
        ? `Połączenie z ${link} nie działa. ${esc(st.error.message)}`
        : `Dane z ${link}, gałąź ${esc(branch)}. ${write}${weekly}`;
    }
    $('#conn-status').innerHTML = html;
  }

  function fillGoals() {
    const s = store.state.data.settings;
    $('#g-name').value = s.name || '';
    $('#g-startDate').value = s.startDate;
    $('#g-startWeight').value = U.weightInput(s.startWeight);
    $('#g-targetDate').value = s.targetDate;
    $('#g-targetWeight').value = U.weightInput(s.targetWeight);
    $('#g-kcal').value = String(s.kcalTarget);
    S.MACROS.forEach(({ key }) => { $(`#g-${key}`).value = s[`${key}Target`] != null ? String(s[`${key}Target`]) : ''; });
    updateGoalsMacroHint();
    $('#g-weekly').value = String(s.weeklyTrainings);
    $('#g-trainings').value = s.trainings.join(', ');
    const writable = store.canWrite();
    $('#btn-save-goals').disabled = !writable;
    $('#goals-hint').textContent = writable
      ? 'Zapisują się w pliku z danymi, więc Claude też je widzi.'
      : 'Tylko podgląd. Po dodaniu tokenu cele zapiszesz w pliku z danymi.';
  }

  function openSettings() {
    $('#s-token').value = '';
    $('#s-token').placeholder = store.getToken() ? 'Token zapisany. Wklej nowy, żeby go zmienić.' : 'github_pat_…';
    $('#btn-forget-token').hidden = !store.getToken();
    $('#btn-demo').textContent = store.state.mode === 'demo' ? 'Wróć do moich danych' : 'Pokaż przykładowe dane';
    hideMsg('#gh-msg');
    hideMsg('#goals-msg');
    renderConnStatus();
    fillGoals();
    showSheet(settingsSheet);
  }

  // The repo comes from config.js, so the only thing to set up here is the token.
  async function onSaveToken(ev) {
    ev.preventDefault();
    if (ui.busy) return;
    const token = $('#s-token').value.trim();
    if (!token && !store.getToken()) {
      showMsg('#gh-msg', 'Wklej token, żeby zapisywać wpisy.', true);
      return;
    }
    if (token) store.setToken(token);
    if (store.state.mode === 'demo') store.exitDemo();

    const btn = $('#btn-connect');
    setBusy(true, btn, 'Sprawdzam…');
    await store.load();
    setBusy(false, btn);
    ui.logLimit = 21;
    ui.weekLimit = 8;
    update('init');

    $('#s-token').value = '';
    $('#s-token').placeholder = store.getToken() ? 'Token zapisany. Wklej nowy, żeby go zmienić.' : 'github_pat_…';
    $('#btn-forget-token').hidden = !store.getToken();
    $('#btn-demo').textContent = 'Pokaż przykładowe dane';
    renderConnStatus();
    fillGoals();
    if (store.state.error) {
      showMsg('#gh-msg', store.state.error.message, true);
    } else {
      const n = store.state.data.entries.length;
      showMsg('#gh-msg', `Token zapisany. W pliku ${U.plural(n, 'jest', 'są', 'jest')} ${n} ${U.plural(n, 'wpis', 'wpisy', 'wpisów')}.${store.canWrite() ? '' : ' Bez tokenu tylko podgląd.'}`);
    }
  }

  function onForgetToken() {
    store.clearToken();
    $('#btn-forget-token').hidden = true;
    $('#s-token').placeholder = 'github_pat_…';
    showMsg('#gh-msg', 'Token usunięty z tej przeglądarki.');
    renderConnStatus();
    fillGoals();
    if (ui.vm) render(ui.vm, {});
  }

  // Grams → calories check for the macro targets, so they can be matched to the calorie target.
  function updateGoalsMacroHint() {
    const g = {};
    S.MACROS.forEach(({ key }) => { g[key] = U.parseNumber($(`#g-${key}`).value); });
    const kcal = S.macroKcal(g);
    const target = U.parseNumber($('#g-kcal').value);
    $('#g-macro-hint').textContent = kcal == null
      ? 'Puste pole znaczy bez celu. Makro i tak będzie na wykresie.'
      : `Razem ${U.fmtInt(kcal)} kcal${target ? ` przy celu ${U.fmtInt(target)} kcal (${U.signed(kcal - target, U.fmtInt)}).` : '.'}`;
  }

  function validateGoals(g) {
    const L = store.LIMITS;
    const inRange = (n, [lo, hi]) => n != null && n >= lo && n <= hi;
    if (!U.isValidKey(g.startDate) || !U.isValidKey(g.targetDate)) return 'Uzupełnij datę startu i termin celu.';
    if (g.targetDate <= g.startDate) return 'Termin celu musi być po dacie startu.';
    if (!inRange(g.startWeight, L.weight) || !inRange(g.targetWeight, L.weight)) {
      return `Wagi muszą być liczbami z zakresu ${L.weight[0]}–${L.weight[1]} kg.`;
    }
    if (g.targetWeight >= g.startWeight) return 'Waga docelowa musi być niższa niż waga na starcie.';
    if (!inRange(g.kcalTarget, L.kcalTarget)) {
      return `Kalorie dziennie: liczba z zakresu ${U.fmtInt(L.kcalTarget[0])}–${U.fmtInt(L.kcalTarget[1])}.`;
    }
    for (const { key, label } of S.MACROS) {
      const v = g[`${key}Target`];
      if (v === undefined) return `${label}: wpisz liczbę gramów albo zostaw puste.`;
      if (v !== null && !inRange(v, L.macroTarget)) return `${label}: liczba z zakresu ${L.macroTarget[0]}–${U.fmtInt(L.macroTarget[1])} g.`;
    }
    if (!inRange(g.weeklyTrainings, L.weeklyTrainings)) {
      return `Treningi w tygodniu: liczba od ${L.weeklyTrainings[0]} do ${L.weeklyTrainings[1]}.`;
    }
    if (!g.trainings.length) return 'Podaj przynajmniej jeden rodzaj treningu.';
    if (g.trainings.length > 8) return 'Maksymalnie 8 rodzajów treningu.';
    return null;
  }

  async function onSaveGoals(ev) {
    ev.preventDefault();
    if (ui.busy) return;
    const g = {
      name: $('#g-name').value.trim(),
      startDate: $('#g-startDate').value,
      startWeight: U.parseNumber($('#g-startWeight').value),
      targetDate: $('#g-targetDate').value,
      targetWeight: U.parseNumber($('#g-targetWeight').value),
      kcalTarget: U.parseNumber($('#g-kcal').value),
      weeklyTrainings: U.parseNumber($('#g-weekly').value),
      trainings: [...new Set($('#g-trainings').value.split(',').map((t) => t.trim()).filter(Boolean))]
    };
    // null = cleared field (the target is removed), undefined = not a number.
    S.MACROS.forEach(({ key }) => {
      const raw = $(`#g-${key}`).value.trim();
      const n = U.parseNumber(raw);
      g[`${key}Target`] = !raw ? null : n == null ? undefined : Math.round(n);
    });
    const error = validateGoals(g);
    if (error) {
      showMsg('#goals-msg', error, true);
      return;
    }
    g.kcalTarget = Math.round(g.kcalTarget);
    g.weeklyTrainings = Math.round(g.weeklyTrainings);
    const btn = $('#btn-save-goals');
    setBusy(true, btn, 'Zapisuję…');
    try {
      await store.saveSettings(g);
      setBusy(false, btn);
      update('save');
      fillGoals();
      showMsg('#goals-msg', 'Cele zapisane.');
    } catch (err) {
      setBusy(false, btn);
      showMsg('#goals-msg', err.message, true);
    }
  }

  // ---------- events ----------

  function bind() {
    $('#fab').addEventListener('click', () => openEntry());
    $('#btn-settings').addEventListener('click', openSettings);
    $('#btn-refresh').addEventListener('click', () => refresh(true));
    $('#btn-demo-empty').addEventListener('click', showDemo);
    $('#btn-demo').addEventListener('click', () => (store.state.mode === 'demo' ? leaveDemo() : showDemo()));
    $('#btn-more').addEventListener('click', () => {
      ui.logLimit += 30;
      renderLog(ui.vm);
    });
    $('#btn-weeks-more').addEventListener('click', () => {
      ui.weekLimit += 8;
      renderWeeks(ui.vm);
    });

    $('#weeks-list').addEventListener('click', (ev) => {
      const day = ev.target.closest('button.wk-day');
      if (day) openEntry(day.dataset.date);
    });

    $('#range').addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-range]');
      if (!b) return;
      ui.range = b.dataset.range === 'all' ? 'all' : Number(b.dataset.range);
      try { localStorage.setItem(RANGE_KEY, JSON.stringify(ui.range)); } catch (_) { /* ignore */ }
      renderCharts(ui.vm);
    });

    $('#log').addEventListener('click', (ev) => {
      const row = ev.target.closest('button.log-row');
      if (row) openEntry(row.dataset.date);
    });

    $('#heatmap').addEventListener('click', (ev) => {
      const cell = ev.target.closest('.hm-cell');
      if (!cell || cell.classList.contains('is-future')) return;
      const key = cell.dataset.key;
      const e = ui.vm.byDate.get(key);
      let text = `${U.fmtDay(key)}: brak wpisu.`;
      if (e) text = `${U.fmtDay(key)}: ${dayDetails(e)}.`;
      $('#heat-caption').textContent = text;
      $$('#heatmap .is-picked').forEach((c) => c.classList.remove('is-picked'));
      cell.classList.add('is-picked');
    });

    $('#badges').addEventListener('click', (ev) => {
      const btn = ev.target.closest('.badge');
      if (!btn) return;
      const b = ui.vm.badges.find((x) => x.id === btn.dataset.id);
      $('#badge-caption').textContent = `${b.title}: ${b.desc.charAt(0).toLowerCase()}${b.desc.slice(1)}. ${b.unlocked ? 'Zdobyta.' : 'Jeszcze do zdobycia.'}`;
    });

    // Entry form
    $('#entry-form').addEventListener('submit', onSave);
    $('#btn-delete').addEventListener('click', onDelete);
    $('#f-date').addEventListener('change', () => {
      const date = $('#f-date').value;
      if (U.isValidKey(date)) fillForm(date, isDirty());
    });
    $$('.day-chip').forEach((b) => b.addEventListener('click', () => {
      const date = U.addDays(U.todayKey(), Number(b.dataset.offset));
      const dirty = isDirty();
      $('#f-date').value = date;
      fillForm(date, dirty);
    }));
    $$('.step').forEach((b) => b.addEventListener('click', () => stepWeight(Number(b.dataset.step))));
    $('#f-kcal').addEventListener('input', () => { updateKcalHint(); updateMacroHint(); });
    S.MACROS.forEach(({ key }) => $(`#f-${key}`).addEventListener('input', updateMacroHint));
    ['#g-protein', '#g-fat', '#g-carbs', '#g-kcal'].forEach((sel) => $(sel).addEventListener('input', updateGoalsMacroHint));
    $('#f-trainings').addEventListener('click', (ev) => {
      const chip = ev.target.closest('.chip');
      if (!chip) return;
      const on = chip.getAttribute('aria-pressed') !== 'true';
      pressOnly($('#f-trainings'), (b) => on && b === chip);
    });
    $('#f-moods').addEventListener('click', (ev) => {
      const mood = ev.target.closest('.mood');
      if (!mood) return;
      const on = mood.getAttribute('aria-pressed') !== 'true';
      pressOnly($('#f-moods'), (b) => on && b === mood);
    });

    // Settings
    $('#gh-form').addEventListener('submit', onSaveToken);
    $('#btn-forget-token').addEventListener('click', onForgetToken);
    $('#goals-form').addEventListener('submit', onSaveGoals);

    // Sheets: close button, backdrop click, Esc (not while saving)
    [entrySheet, settingsSheet].forEach((dialog) => {
      $$('[data-close]', dialog).forEach((b) => b.addEventListener('click', () => closeSheet(dialog)));
      dialog.addEventListener('click', (ev) => { if (ev.target === dialog) closeSheet(dialog); });
      dialog.addEventListener('cancel', (ev) => { if (ui.busy) ev.preventDefault(); });
    });
    entrySheet.addEventListener('close', disarmDelete);

    // "n" opens a new entry on desktop
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'n' || ev.ctrlKey || ev.metaKey || ev.altKey || ev.repeat) return;
      if (document.querySelector('dialog[open]')) return;
      const t = ev.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (!store.canWrite()) return;
      ev.preventDefault();
      openEntry();
    });

    // Back to the tab after logging something through Claude: pull the new data.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || store.state.mode !== 'github') return;
      if (ui.busy || document.querySelector('dialog[open]')) return;
      if (Date.now() - store.state.loadedAt < 20000) return;
      refresh(false);
    });
  }

  async function loadFonts() {
    if (!document.fonts || !document.fonts.load) return;
    const faces = ['900 100px "Big Shoulders Stencil Display"', '800 30px "Big Shoulders Display"',
      '700 30px "Big Shoulders Display"', '400 16px "Barlow"', '600 16px "Barlow"'];
    await Promise.race([
      Promise.all(faces.map((f) => document.fonts.load(f))).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 1500))
    ]);
  }

  async function init() {
    bind();
    try {
      const saved = JSON.parse(localStorage.getItem(RANGE_KEY) || 'null');
      if (saved === 30 || saved === 90 || saved === 'all') ui.range = saved;
    } catch (_) { /* ignore */ }
    await Promise.all([store.load(), loadFonts()]);
    update('init');
  }

  DF.app = { update, compute, openEntry, openSettings };
  init();
})(window.DF = window.DF || {});
