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
    return {
      settings, entries, today, prog, latest, slopeDay, plan, planDiff, streak, week, kcal, mood,
      pl: S.plates(prog),
      eta: S.eta(prog.trend, settings.targetWeight, slopeDay, asOf),
      badges: S.badges(entries, settings, today, prog),
      byDate: new Map(entries.map((e) => [e.date, e])),
      coach: S.coachMessage({ settings, entries, today, prog, mood, slopeDay, kcal, week, streak, planDiff })
    };
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
    if (!parts.length && e.mood) parts.push(`samopoczucie ${S.MOODS[e.mood].label.toLowerCase()}`);
    if (!parts.length) parts.push('notatka');
    return parts.join(', ');
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
    renderBadges(vm);
    renderLog(vm);
  }

  function renderChrome(vm) {
    const n = vm.streak.current;
    const streak = $('#streak');
    streak.hidden = n < 2;
    streak.textContent = `🔥 ${n} ${n === 1 ? 'dzień' : 'dni'}`;
    streak.title = `Dni z wpisem bez przerwy. Rekord: ${vm.streak.best}.`;
    $('#fab').hidden = !store.canWrite() || !vm.entries.length;
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
      text = 'Dane z pliku na dysku, tylko podgląd. Połącz aplikację z repozytorium, żeby zapisywać.';
      label = 'Połącz z GitHubem';
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
      first.textContent = store.canWrite() ? 'Dodaj pierwszy wpis' : store.getConfig() ? 'Dodaj token' : 'Połącz z GitHubem';
      first.onclick = store.canWrite() ? () => openEntry() : openSettings;
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
        <p class="stat-label">Tempo</p>
        <p class="stat-value">${paceValue}</p>
        <p class="stat-sub">${esc(paceSub)}</p>
      </div>
      <div class="stat">
        <p class="stat-label">Samopoczucie</p>
        <p class="stat-value">${moodValue}</p>
        <p class="mood-row" aria-label="Samopoczucie z ostatnich 7 dni">${moodRow}</p>
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
    return `<article class="wk${current ? ' is-current' : ''}">` +
      '<div class="wk-top">' +
        `<h3 class="wk-range">${U.fmtRange(w.start, w.end)}${current ? '<span class="wk-tag">ten tydzień</span>' : ''}</h3>` +
        `<p class="wk-avg">${avg}</p>` +
        `<p class="wk-sub">${esc(sub)}</p>` +
      '</div>' +
      `<div class="wk-days">${w.days.map((d) => weekDay(d, vm, writable)).join('')}</div>` +
      '<dl class="wk-facts">' +
        `<div><dt>Kalorie</dt><dd>${kcal}</dd></div>` +
        `<div><dt>Treningi</dt><dd>${trainings}</dd></div>` +
        `<div><dt>Samopoczucie</dt><dd>${mood}</dd></div>` +
        `<div><dt>Wpisy</dt><dd>${w.logged}<small>/7</small></dd></div>` +
      '</dl>' +
      '</article>';
  }

  function renderCharts(vm) {
    if (!vm || !vm.entries.length || !DF.charts.setup()) return;
    $$('#range button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === String(ui.range))));
    DF.charts.weight($('#chart-weight'), vm, ui.range);
    DF.charts.kcal($('#chart-kcal'), vm, ui.range);
  }

  function moodAlpha(mood) {
    return mood ? [0, 0.35, 0.5, 0.68, 0.84, 1][mood] : 0.9;
  }

  function renderHeatmap(vm) {
    const s = vm.settings;
    const firstMonday = U.addDays(U.weekStart(vm.today), -7 * (HEAT_WEEKS - 1));
    const lastDay = U.addDays(U.weekStart(vm.today), 6);
    const cells = [];
    const starts = [];
    let trainings = 0;

    for (let w = 0; w < HEAT_WEEKS; w++) {
      for (let d = 0; d < 7; d++) {
        const key = U.addDays(firstMonday, w * 7 + d);
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
    if (!starts.length || starts[0][0] >= 3) starts.unshift([0, firstMonday]);
    const months = starts
      .filter(([w]) => w <= HEAT_WEEKS - 3) // a label in the last columns would stick out of the grid
      .map(([w, key]) => `<span class="hm-month" style="grid-column:${w + 2}">${U.monthShort(key)}</span>`);
    const weekdays = [[2, 'pn'], [4, 'śr'], [6, 'pt']].map(([row, t]) => `<span class="hm-wd" style="grid-row:${row}">${t}</span>`);

    const heat = $('#heatmap');
    heat.innerHTML = months.join('') + weekdays.join('') + cells.join('');
    heat.setAttribute('aria-label', `Treningi od ${U.fmtShort(firstMonday)} do ${U.fmtShort(lastDay)}: ${trainings}.`);

    const total = vm.entries.filter(S.isTraining).length;
    $('#train-count').textContent = `${total} ${U.plural(total, 'trening', 'treningi', 'treningów')} od startu`;
    $('#heat-caption').textContent = 'Mocniejszy kolor to lepsze samopoczucie. Stuknij dzień, żeby zobaczyć szczegóły.';
    $('#heat-legend').innerHTML = s.trainings
      .map((t) => `<span class="lg"><i class="sw sw-sq t-${trainingColor(t, s)}"></i>${esc(t)}</span>`)
      .concat('<span class="lg"><i class="sw sw-sq is-rest"></i>bez treningu</span>')
      .join('');
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
    const kcal = typeof e.kcal === 'number'
      ? `<span class="kcal-${S.kcalState(e.kcal, s.kcalTarget)}">${U.fmtInt(e.kcal)}<small> kcal</small></span>`
      : none;
    const training = S.isTraining(e)
      ? `<i class="dot t-${trainingColor(e.training, s)}"></i>${esc(e.training)}`
      : '<span class="none">bez treningu</span>';
    const mood = e.mood ? `<span title="${S.MOODS[e.mood].label}">${S.MOODS[e.mood].emoji}</span>` : '';
    const note = e.note ? `<span class="log-note">${esc(e.note)}</span>` : '';

    return `<${tag} class="log-row${e.date === today ? ' is-today' : ''}"${attrs}>` +
      `<span class="log-day"><b>${U.fromKey(e.date).getDate()}</b><small>${U.WEEKDAYS[U.weekdayIndex(e.date)]}</small></span>` +
      `<span class="log-weight">${weight}</span>` +
      `<span class="log-kcal">${kcal}</span>` +
      `<span class="log-train">${training}</span>` +
      `<span class="log-mood">${mood}</span>` +
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
    return {
      date: $('#f-date').value,
      weightRaw,
      kcalRaw,
      weight: U.parseNumber(weightRaw),
      kcal: U.parseNumber(kcalRaw),
      training: training ? training.dataset.training : '',
      mood: mood ? Number(mood.dataset.mood) : null,
      note: $('#f-note').value.trim()
    };
  }

  function formEntry(v) {
    const e = { date: v.date };
    if (v.weight != null) e.weight = Math.round(v.weight * 100) / 100;
    if (v.kcal != null) e.kcal = Math.round(v.kcal);
    if (v.training) e.training = v.training;
    if (v.mood) e.mood = v.mood;
    if (v.note) e.note = v.note.slice(0, 280);
    return e;
  }

  function validate(v) {
    if (!U.isValidKey(v.date)) return 'Wybierz dzień.';
    if (v.date > U.todayKey()) return 'Nie da się dodać wpisu z przyszłości.';
    if (v.weightRaw && v.weight == null) return 'Waga musi być liczbą, np. 84,2.';
    if (v.weight != null && (v.weight < 20 || v.weight > 400)) return 'Waga poza zakresem 20–400 kg.';
    if (v.kcalRaw && v.kcal == null) return 'Kalorie muszą być liczbą, np. 2450.';
    if (v.kcal != null && (v.kcal < 0 || v.kcal > 20000)) return 'Kalorie poza zakresem 0–20 000.';
    if (v.weight == null && v.kcal == null && !v.training && !v.mood && !v.note) {
      return 'Wpisz przynajmniej jedną rzecz: wagę, kalorie, trening, samopoczucie albo notatkę.';
    }
    return null;
  }

  function isDirty() {
    const now = formEntry(readForm());
    const was = ui.original || {};
    return store.ENTRY_FIELDS.some((f) => !same(now[f], was[f]));
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
    buildTrainingChips(ui.vm.settings, e && e.training);
    pressOnly($('#f-trainings'), (b) => !!e && b.dataset.training === (e.training || ''));
    pressOnly($('#f-moods'), (b) => !!e && Number(b.dataset.mood) === e.mood);
    $('#f-note').value = e && e.note ? e.note : '';
    updateKcalHint();
  }

  function openEntry(date) {
    if (!store.canWrite()) {
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
    const btn = $('#btn-save');
    setBusy(true, btn, 'Zapisuję…');
    try {
      const res = await store.upsertEntry(entry, ui.original);
      setBusy(false, btn);
      closeSheet(entrySheet, true);
      update('save', { weightDate: entry.weight != null ? entry.date : null });
      toast(res.unchanged ? 'Bez zmian' : 'Wpis zapisany', res.url ? { href: res.url, label: 'Zobacz commit' } : null);
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
      toast('Wpis usunięty', res.url ? { href: res.url, label: 'Zobacz commit' } : null);
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
      html = 'Aplikacja nie jest połączona z repozytorium. Wpisz jego nazwę i token, żeby zapisywać wpisy.';
    } else {
      const link = `<a href="${esc(store.fileUrl(cfg))}" target="_blank" rel="noopener">${esc(`${cfg.owner}/${cfg.repo}`)}</a>`;
      const write = token ? 'Zapis włączony.' : 'Bez tokenu: tylko podgląd.';
      html = st.mode !== 'demo' && st.error
        ? `Połączenie z ${link} nie działa. ${esc(st.error.message)}`
        : `Dane z ${link}, gałąź ${esc(cfg.branch)}. ${write}`;
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
    $('#g-weekly').value = String(s.weeklyTrainings);
    $('#g-trainings').value = s.trainings.join(', ');
    const writable = store.canWrite();
    $('#btn-save-goals').disabled = !writable;
    $('#goals-hint').textContent = writable
      ? 'Zapisują się w pliku z danymi, więc Claude też je widzi.'
      : 'Tylko podgląd. Po dodaniu tokenu cele zapiszesz w pliku z danymi.';
  }

  function openSettings() {
    const cfg = store.getConfig();
    $('#s-owner').value = cfg ? cfg.owner : '';
    $('#s-repo').value = cfg ? cfg.repo : '';
    $('#s-branch').value = cfg ? cfg.branch : '';
    $('#s-path').value = cfg ? cfg.path : '';
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

  function parseRepo(owner, repo) {
    const joined = repo.includes('/') ? repo : owner.includes('/') ? owner : '';
    const m = /(?:github\.com\/)?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?(?:[/?#].*)?$/.exec(joined);
    return m ? { owner: m[1], repo: m[2] } : { owner, repo };
  }

  async function onConnect(ev) {
    ev.preventDefault();
    if (ui.busy) return;
    const { owner, repo } = parseRepo($('#s-owner').value.trim(), $('#s-repo').value.trim());
    if (!owner || !repo) {
      showMsg('#gh-msg', 'Podaj właściciela i nazwę repozytorium.', true);
      return;
    }
    store.saveConfig({ owner, repo, branch: $('#s-branch').value, path: $('#s-path').value });
    const token = $('#s-token').value.trim();
    if (token) store.setToken(token);
    if (store.state.mode === 'demo') store.exitDemo();

    const btn = $('#btn-connect');
    setBusy(true, btn, 'Łączę…');
    await store.load();
    setBusy(false, btn);
    ui.logLimit = 21;
    ui.weekLimit = 8;
    update('init');

    const cfg = store.getConfig();
    $('#s-owner').value = cfg.owner;
    $('#s-repo').value = cfg.repo;
    $('#s-branch').value = cfg.branch;
    $('#s-path').value = cfg.path;
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
      showMsg('#gh-msg', `Połączono. W pliku ${U.plural(n, 'jest', 'są', 'jest')} ${n} ${U.plural(n, 'wpis', 'wpisy', 'wpisów')}.${store.canWrite() ? '' : ' Bez tokenu tylko podgląd.'}`);
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

  function validateGoals(g) {
    if (!U.isValidKey(g.startDate) || !U.isValidKey(g.targetDate)) return 'Uzupełnij datę startu i termin celu.';
    if (g.targetDate <= g.startDate) return 'Termin celu musi być po dacie startu.';
    const okWeight = (w) => w != null && w >= 20 && w <= 400;
    if (!okWeight(g.startWeight) || !okWeight(g.targetWeight)) return 'Wagi muszą być liczbami z zakresu 20–400 kg.';
    if (g.targetWeight >= g.startWeight) return 'Waga docelowa musi być niższa niż waga na starcie.';
    if (g.kcalTarget == null || g.kcalTarget < 800 || g.kcalTarget > 10000) return 'Kalorie dziennie: liczba z zakresu 800–10 000.';
    if (g.weeklyTrainings == null || g.weeklyTrainings < 0 || g.weeklyTrainings > 14) return 'Treningi w tygodniu: liczba od 0 do 14.';
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
      if (e) {
        const parts = [S.isTraining(e) ? e.training : 'bez treningu'];
        if (e.mood) parts.push(`samopoczucie ${S.MOODS[e.mood].emoji} ${S.MOODS[e.mood].label.toLowerCase()}`);
        text = `${U.fmtDay(key)}: ${parts.join(', ')}.`;
      }
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
    $('#f-kcal').addEventListener('input', updateKcalHint);
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
    $('#gh-form').addEventListener('submit', onConnect);
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

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => renderCharts(ui.vm));
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
