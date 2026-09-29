/* Dziennik formy: pure calculations on entries. Everything here is deterministic and testable. */
(function (DF) {
  'use strict';

  const U = DF.utils;

  const MOODS = [
    null,
    { emoji: '😫', label: 'Źle' },
    { emoji: '😕', label: 'Słabo' },
    { emoji: '😐', label: 'OK' },
    { emoji: '🙂', label: 'Dobrze' },
    { emoji: '🤩', label: 'Petarda' }
  ];

  // A night of at least this many hours counts as enough sleep.
  const SLEEP_GOOD = 7;

  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const sorted = (entries) => entries.slice().sort(byDate);
  const hasWeight = (e) => typeof e.weight === 'number';
  const isTraining = (e) => typeof e.training === 'string' && e.training.trim() !== '';

  function weightEntries(entries) {
    return sorted(entries).filter(hasWeight);
  }

  function latestWeight(entries) {
    const ws = weightEntries(entries);
    return ws.length ? ws[ws.length - 1] : null;
  }

  function minWeight(entries) {
    const ws = weightEntries(entries);
    return ws.length ? Math.min(...ws.map((e) => e.weight)) : null;
  }

  // Rolling mean of recorded weights over the last `window` calendar days, for every day
  // between the first and the last weigh-in. Missing days simply don't contribute.
  function movingAverage(entries, window = 7) {
    const ws = weightEntries(entries);
    const out = new Map();
    if (!ws.length) return out;
    const byDay = new Map(ws.map((e) => [e.date, e.weight]));
    const days = U.dayRange(ws[0].date, ws[ws.length - 1].date);
    days.forEach((day, i) => {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - window + 1); j <= i; j++) {
        const v = byDay.get(days[j]);
        if (v !== undefined) { sum += v; count++; }
      }
      if (count) out.set(day, sum / count);
    });
    return out;
  }

  function trendWeight(entries) {
    const last = latestWeight(entries);
    return last ? movingAverage(entries).get(last.date) : null;
  }

  // Least-squares slope of weight (kg per day) over the `days` days ending at `asOf`.
  // Needs at least 4 weigh-ins spread over 6+ days, otherwise the number is noise.
  function slope(entries, asOf, days = 21) {
    const from = U.addDays(asOf, -(days - 1));
    const pts = weightEntries(entries)
      .filter((e) => e.date >= from && e.date <= asOf)
      .map((e) => [U.diffDays(from, e.date), e.weight]);
    if (pts.length < 4 || pts[pts.length - 1][0] - pts[0][0] < 6) return null;
    const n = pts.length;
    const mx = pts.reduce((s, p) => s + p[0], 0) / n;
    const my = pts.reduce((s, p) => s + p[1], 0) / n;
    let num = 0;
    let den = 0;
    pts.forEach(([x, y]) => { num += (x - mx) * (y - my); den += (x - mx) ** 2; });
    return den ? num / den : null;
  }

  // Straight line from start weight on startDate to target weight on targetDate.
  function planWeightAt(settings, key) {
    const { startDate, targetDate, startWeight, targetWeight } = settings;
    const total = U.diffDays(startDate, targetDate);
    if (total <= 0) return targetWeight;
    const t = U.clamp(U.diffDays(startDate, key) / total, 0, 1);
    return startWeight + (targetWeight - startWeight) * t;
  }

  function progress(entries, settings) {
    const trend = trendWeight(entries);
    const goal = settings.startWeight - settings.targetWeight;
    if (trend == null || !(goal > 0)) {
      return { trend: trend ?? null, goal: Math.max(goal, 0), lost: 0, left: Math.max(goal, 0), ratio: 0 };
    }
    const lost = settings.startWeight - trend;
    return {
      trend,
      goal,
      lost,
      left: Math.max(0, trend - settings.targetWeight),
      ratio: U.clamp(lost / goal, 0, 1)
    };
  }

  // One plate per kilogram of the goal (max 10 plates). `partial` is progress into the next plate.
  function plates(prog) {
    const goal = prog.goal > 0 ? prog.goal : 1;
    const count = U.clamp(Math.ceil(goal - 1e-9), 1, 10);
    const per = goal / count;
    const lost = U.clamp(prog.lost, 0, goal);
    const full = Math.min(count, Math.floor(lost / per + 1e-9));
    const partial = full < count ? (lost - full * per) / per : 0;
    return { count, per, full, partial };
  }

  function eta(trend, target, slopePerDay, fromKey) {
    if (trend == null || slopePerDay == null || slopePerDay > -0.005) return null;
    const days = (trend - target) / -slopePerDay;
    if (days <= 0 || days > 730) return null;
    return U.addDays(fromKey, Math.ceil(days));
  }

  function streaks(entries, today) {
    const days = new Set(entries.filter((e) => e.date <= today).map((e) => e.date));
    let current = 0;
    let k = days.has(today) ? today : U.addDays(today, -1); // today isn't lost until it's over
    while (days.has(k)) { current++; k = U.addDays(k, -1); }
    let best = 0;
    let run = 0;
    let prev = null;
    [...days].sort().forEach((d) => {
      run = prev && U.diffDays(prev, d) === 1 ? run + 1 : 1;
      best = Math.max(best, run);
      prev = d;
    });
    return { current, best: Math.max(best, current), loggedToday: days.has(today) };
  }

  function lastDays(entries, today, n) {
    const from = U.addDays(today, -(n - 1));
    return entries.filter((e) => e.date >= from && e.date <= today);
  }

  function weekSummary(entries, today) {
    const start = U.weekStart(today);
    const end = U.addDays(start, 6);
    const trainings = sorted(entries).filter((e) => e.date >= start && e.date <= end && isTraining(e));
    return { start, end, trainings };
  }

  // One row per calendar week, from the week of the first entry to the current one. Weeks
  // without a single entry stay in the list, so the calendar keeps its rhythm. `delta` compares
  // the week's mean weight with the last week that had one, skipping weeks without weigh-ins.
  function weeks(entries, today) {
    const all = sorted(entries).filter((e) => e.date <= today);
    if (!all.length) return [];
    const byDay = new Map(all.map((e) => [e.date, e]));
    const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const out = [];
    let prevAvg = null;
    for (let start = U.weekStart(all[0].date); start <= U.weekStart(today); start = U.addDays(start, 7)) {
      const days = U.dayRange(start, U.addDays(start, 6))
        .map((key) => ({ key, entry: byDay.get(key) || null, future: key > today }));
      const logged = days.map((d) => d.entry).filter(Boolean);
      const ws = logged.filter(hasWeight).map((e) => e.weight);
      const ks = logged.filter((e) => typeof e.kcal === 'number').map((e) => e.kcal);
      const ms = logged.filter((e) => typeof e.mood === 'number').map((e) => e.mood);
      const ss = logged.filter((e) => typeof e.sleep === 'number').map((e) => e.sleep);
      const sq = logged.filter((e) => typeof e.sleepScore === 'number').map((e) => e.sleepScore);
      const avg = ws.length ? mean(ws) : null;
      out.push({
        start,
        end: U.addDays(start, 6),
        days,
        logged: logged.length,
        weight: avg == null ? null : { avg, count: ws.length, min: Math.min(...ws) },
        delta: avg != null && prevAvg != null ? avg - prevAvg : null,
        kcal: ks.length ? { avg: mean(ks), count: ks.length } : null,
        mood: ms.length ? { avg: mean(ms), count: ms.length } : null,
        sleep: ss.length ? { avg: mean(ss), count: ss.length } : null,
        sleepScore: sq.length ? { avg: mean(sq), count: sq.length } : null,
        trainings: logged.filter(isTraining)
      });
      if (avg != null) prevAvg = avg;
    }
    return out;
  }

  // Calorie state vs target: within 85–105% counts as "on target". Eating far below target is
  // shown neutrally, never rewarded.
  function kcalState(kcal, target) {
    if (typeof kcal !== 'number' || !(target > 0)) return null;
    if (kcal > target * 1.05) return 'over';
    if (kcal < target * 0.85) return 'under';
    return 'ok';
  }

  function kcalSummary(entries, today, target) {
    const recent = lastDays(entries, today, 7).filter((e) => typeof e.kcal === 'number');
    if (!recent.length) return null;
    return {
      avg: recent.reduce((s, e) => s + e.kcal, 0) / recent.length,
      logged: recent.length,
      ok: recent.filter((e) => kcalState(e.kcal, target) === 'ok').length
    };
  }

  function moodSummary(entries, today) {
    const recent = lastDays(entries, today, 7).filter((e) => typeof e.mood === 'number');
    if (!recent.length) return null;
    return { avg: recent.reduce((s, e) => s + e.mood, 0) / recent.length, count: recent.length };
  }

  // Last 7 days of sleep: mean hours and mean score, each over the days that have it.
  function sleepSummary(entries, today) {
    const recent = lastDays(entries, today, 7);
    const hours = recent.filter((e) => typeof e.sleep === 'number').map((e) => e.sleep);
    const scores = recent.filter((e) => typeof e.sleepScore === 'number').map((e) => e.sleepScore);
    if (!hours.length && !scores.length) return null;
    const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
    return { hours: mean(hours), score: mean(scores) };
  }

  function longestRun(dates) {
    let best = 0;
    let run = 0;
    let prev = null;
    dates.forEach((d) => {
      run = prev && U.diffDays(prev, d) === 1 ? run + 1 : 1;
      best = Math.max(best, run);
      prev = d;
    });
    return best;
  }

  function bestWeek(entries) {
    const perWeek = new Map();
    entries.filter(isTraining).forEach((e) => {
      const w = U.weekStart(e.date);
      perWeek.set(w, (perWeek.get(w) || 0) + 1);
    });
    return Math.max(0, ...perWeek.values());
  }

  // Longest run of consecutive calendar weeks that each hit the weekly training target.
  function fullWeeksRun(entries, target) {
    if (!(target > 0)) return 0;
    const perWeek = new Map();
    entries.filter(isTraining).forEach((e) => {
      const w = U.weekStart(e.date);
      perWeek.set(w, (perWeek.get(w) || 0) + 1);
    });
    const full = [...perWeek.keys()].filter((w) => perWeek.get(w) >= target).sort();
    let best = 0;
    let run = 0;
    full.forEach((w, i) => {
      run = i && U.diffDays(full[i - 1], w) === 7 ? run + 1 : 1;
      best = Math.max(best, run);
    });
    return best;
  }

  // Saturday and Sunday of the same weekend both within the calorie target.
  function weekendOnTarget(entries, target) {
    const ok = new Set(entries.filter((e) => kcalState(e.kcal, target) === 'ok').map((e) => e.date));
    return [...ok].some((d) => U.weekdayIndex(d) === 5 && ok.has(U.addDays(d, 1)));
  }

  // An entry after at least a week without any.
  function cameBack(entries) {
    const dates = sorted(entries).map((e) => e.date);
    return dates.some((d, i) => i > 0 && U.diffDays(dates[i - 1], d) >= 8);
  }

  // Largest lead of the 7-day average over the plan, in kg (positive = ahead of plan). The first
  // week doesn't count: a start weight set too high would hand out the badge on day one.
  function bestPlanLead(entries, settings) {
    const from = U.addDays(settings.startDate, 7);
    let best = 0;
    movingAverage(entries).forEach((avg, day) => {
      if (day >= from) best = Math.max(best, planWeightAt(settings, day) - avg);
    });
    return best;
  }

  function badges(entries, settings, today, prog) {
    const s = settings;
    const all = sorted(entries).filter((e) => e.date <= today);
    const trained = new Set(all.filter(isTraining).map((e) => e.training));
    const c = {
      count: entries.length,
      lost: prog.trend == null ? 0 : prog.lost,
      ratio: prog.ratio,
      goalReached: prog.trend != null && prog.trend <= s.targetWeight,
      bestStreak: streaks(entries, today).best,
      kcalRun: longestRun(sorted(entries).filter((e) => kcalState(e.kcal, s.kcalTarget) === 'ok').map((e) => e.date)),
      bestWeek: bestWeek(entries),
      trainings: entries.filter(isTraining).length,
      sleepRun: longestRun(all.filter((e) => typeof e.sleep === 'number' && e.sleep >= SLEEP_GOOD).map((e) => e.date)),
      bestSleepScore: Math.max(0, ...all.filter((e) => typeof e.sleepScore === 'number').map((e) => e.sleepScore)),
      petardy: all.filter((e) => e.mood === 5).length,
      allTypes: s.trainings.length > 1 && s.trainings.every((t) => trained.has(t)),
      fullWeeks: fullWeeksRun(all, s.weeklyTrainings),
      weekend: weekendOnTarget(all, s.kcalTarget),
      comeback: cameBack(all),
      planLead: bestPlanLead(all, s),
      notes: all.filter((e) => e.note).length
    };
    const list = [
      { id: 'first', mark: '1', color: 'steel', title: 'Pierwszy wpis', desc: 'Pierwszy dzień w dzienniku', ok: c.count >= 1 },
      { id: 'kg1', mark: U.MINUS + '1', color: 'red', title: 'Minus 1 kg', desc: 'Średnia z 7 dni 1 kg poniżej startu', ok: c.lost >= 1 },
      { id: 'comeback', mark: '↩', color: 'steel', title: 'Powrót', desc: 'Wpis po co najmniej tygodniu przerwy. Liczy się, że wracasz', ok: c.comeback },
      { id: 'streak7', mark: '7', color: 'blue', title: 'Tydzień z rzędu', desc: '7 dni z wpisem bez przerwy', ok: c.bestStreak >= 7 },
      { id: 'kcal7', mark: 'kcal', color: 'green', title: 'Tydzień w kaloriach', desc: '7 dni z rzędu w celu kalorycznym', ok: c.kcalRun >= 7 },
      { id: 'weekend', mark: 'S+N', color: 'yellow', title: 'Weekend w ryzach', desc: 'Sobota i niedziela tego samego weekendu w celu kalorycznym', ok: c.weekend },
      { id: 'week', mark: `${s.weeklyTrainings}/${s.weeklyTrainings}`, color: 'yellow', title: 'Pełny tydzień', desc: 'Wszystkie treningi zaplanowane na tydzień', ok: s.weeklyTrainings > 0 && c.bestWeek >= s.weeklyTrainings },
      { id: 'sleep7', mark: 'zZz', color: 'blue', title: 'Wyspany tydzień', desc: `7 nocy z rzędu po ${SLEEP_GOOD} h snu lub więcej`, ok: c.sleepRun >= 7 },
      { id: 'sleep90', mark: '90', color: 'white', title: 'Sen jak dziecko', desc: 'Ocena snu 90/100 lub wyżej', ok: c.bestSleepScore >= 90 },
      { id: 'allTypes', mark: 'ALL', color: 'green', title: 'Wszechstronny', desc: 'Każdy rodzaj treningu z ustawień zrobiony co najmniej raz', ok: c.allTypes },
      { id: 'petarda', mark: '5×', color: 'red', title: 'Petarda', desc: 'Pięć dni z samopoczuciem „petarda”', ok: c.petardy >= 5 },
      { id: 'kg3', mark: U.MINUS + '3', color: 'blue', title: 'Minus 3 kg', desc: 'Średnia z 7 dni 3 kg poniżej startu', ok: c.lost >= 3 },
      { id: 'ahead', mark: '▼1', color: 'green', title: 'Przed planem', desc: 'Średnia z 7 dni 1 kg poniżej planu', ok: c.planLead >= 1 },
      { id: 'half', mark: '½', color: 'yellow', title: 'Połowa drogi', desc: 'Połowa kilogramów do celu', ok: c.ratio >= 0.5 },
      { id: 't10', mark: '10', color: 'green', title: '10 treningów', desc: '10 zapisanych treningów', ok: c.trainings >= 10 },
      { id: 'notes', mark: '✎', color: 'steel', title: 'Kronikarz', desc: '20 wpisów z notatką', ok: c.notes >= 20 },
      { id: 'weeks3', mark: '3×', color: 'blue', title: 'Trzy pełne tygodnie', desc: 'Trzy tygodnie z rzędu ze wszystkimi treningami', ok: c.fullWeeks >= 3 },
      { id: 'streak30', mark: '30', color: 'red', title: 'Miesiąc z rzędu', desc: '30 dni z wpisem bez przerwy', ok: c.bestStreak >= 30 },
      { id: 'kg5', mark: U.MINUS + '5', color: 'green', title: 'Minus 5 kg', desc: 'Średnia z 7 dni 5 kg poniżej startu', ok: c.lost >= 5 },
      { id: 't50', mark: '50', color: 'white', title: '50 treningów', desc: '50 zapisanych treningów', ok: c.trainings >= 50 },
      { id: 'streak100', mark: '100', color: 'yellow', title: 'Setka z rzędu', desc: '100 dni z wpisem bez przerwy', ok: c.bestStreak >= 100 },
      { id: 't100', mark: '100', color: 'red', title: '100 treningów', desc: '100 zapisanych treningów', ok: c.trainings >= 100 },
      { id: 'goal', mark: U.fmtInt(s.targetWeight), color: 'red', title: 'Cel', desc: `Średnia z 7 dni ${U.fmt1(s.targetWeight)} kg`, ok: c.goalReached }
    ];
    return list.map((b) => Object.assign(b, { unlocked: !!b.ok }));
  }

  function isNewLow(entries, today) {
    const ws = weightEntries(entries);
    if (ws.length < 5) return false;
    const last = ws[ws.length - 1];
    if (U.diffDays(last.date, today) > 1) return false;
    return ws.slice(0, -1).every((e) => last.weight < e.weight);
  }

  // One sentence under the barbell. Ordered from most to least important.
  function coachMessage(c) {
    const s = c.settings;
    if (!c.entries.length) {
      return 'Pusta sztanga. Dodaj dzisiejszą wagę, a średnia, tempo i prognoza policzą się same.';
    }
    if (c.prog.trend != null && c.prog.trend <= s.targetWeight) {
      return `Cel ${U.fmt1(s.targetWeight)} kg osiągnięty. Nowy cel ustawisz w ustawieniach.`;
    }
    if (isNewLow(c.entries, c.today)) return 'Najniższa waga od startu.';
    if (c.mood && c.mood.count >= 3 && c.mood.avg <= 2.5) {
      return 'Samopoczucie od tygodnia słabe. Lżejszy tydzień nie przekreśla planu, termin celu zostawia zapas.';
    }
    if (c.slopeDay != null && c.prog.trend && (-c.slopeDay * 7) / c.prog.trend > 0.01) {
      return 'Tempo ponad 1% masy ciała na tydzień. Szybciej, niż wymaga plan, więc pilnuj regeneracji i siły na treningach.';
    }
    if (c.kcal && c.kcal.logged >= 4 && c.kcal.avg > s.kcalTarget * 1.05) {
      return `Średnia kalorii z ostatnich 7 dni jest ${U.fmtInt(c.kcal.avg - s.kcalTarget)} kcal nad celem.`;
    }
    if (s.weeklyTrainings > 0 && c.week.trainings.length >= s.weeklyTrainings) {
      return 'Wszystkie treningi z tego tygodnia zrobione.';
    }
    if (c.streak.current >= 7) return `${c.streak.current} dni z wpisem bez przerwy.`;
    if (c.planDiff != null && c.planDiff <= -0.1) return `Jesteś ${U.fmt1(-c.planDiff)} kg przed planem.`;
    return 'Waga skacze z dnia na dzień przez wodę i jedzenie. Liczy się średnia z 7 dni.';
  }

  DF.stats = {
    MOODS, SLEEP_GOOD, byDate, sorted, isTraining,
    weightEntries, latestWeight, minWeight, movingAverage, trendWeight, slope, planWeightAt,
    progress, plates, eta, streaks, weekSummary, weeks, kcalState, kcalSummary, moodSummary, sleepSummary,
    badges, isNewLow, coachMessage
  };
})(window.DF = window.DF || {});
