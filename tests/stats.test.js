/* Tests for web/js/stats.js */
(function () {
  'use strict';

  const { test, assert } = DFTest;
  const U = DF.utils;
  const S = DF.stats;
  const settings = (patch) => DF.store.normalizeSettings(Object.assign({}, DF.store.DEFAULT_SETTINGS, patch));

  // Consecutive days from `from`, one entry per item of `values` (null skips a day).
  function daily(from, values, make) {
    return values
      .map((v, i) => (v == null ? null : Object.assign({ date: U.addDays(from, i) }, make(v, i))))
      .filter(Boolean);
  }

  test('movingAverage: 7 calendar days, missing days ignored', () => {
    const ma = S.movingAverage([
      { date: '2026-10-01', weight: 80 },
      { date: '2026-10-03', weight: 82 },
      { date: '2026-10-08', weight: 84 }
    ]);
    assert.equal(ma.get('2026-10-01'), 80);
    assert.equal(ma.get('2026-10-02'), 80);
    assert.equal(ma.get('2026-10-07'), 81);
    assert.equal(ma.get('2026-10-08'), 83, '10-01 fell out of the window');
  });

  test('trendWeight: moving average on the day of the last weigh-in', () => {
    const entries = [{ date: '2026-10-01', weight: 80 }, { date: '2026-10-02', kcal: 2000 }, { date: '2026-10-03', weight: 82 }];
    assert.equal(S.trendWeight(entries), 81);
    assert.equal(S.trendWeight([{ date: '2026-10-01', kcal: 2000 }]), null);
  });

  test('slope: exact on a straight line', () => {
    const entries = daily('2026-10-01', [80, 79.9, 79.8, 79.7, 79.6, 79.5, 79.4, 79.3, 79.2, 79.1], (w) => ({ weight: w }));
    assert.near(S.slope(entries, '2026-10-10', 21), -0.1, 1e-9);
  });

  test('slope: too few or too close weigh-ins give null', () => {
    const three = daily('2026-10-01', [80, null, null, null, null, null, null, 79, 78], (w) => ({ weight: w }));
    assert.equal(S.slope(three, '2026-10-09', 21), null, 'three weigh-ins');
    const close = daily('2026-10-01', [80, 79.9, 79.8, 79.7], (w) => ({ weight: w }));
    assert.equal(S.slope(close, '2026-10-04', 21), null, 'four weigh-ins over three days');
  });

  test('planWeightAt: straight line, clamped to the plan dates', () => {
    const s = settings({ startDate: '2026-10-01', targetDate: '2026-10-11', startWeight: 90, targetWeight: 80 });
    assert.equal(S.planWeightAt(s, '2026-10-06'), 85);
    assert.equal(S.planWeightAt(s, '2026-09-01'), 90);
    assert.equal(S.planWeightAt(s, '2027-01-01'), 80);
  });

  test('progress: trend above the start weight counts as nothing lost', () => {
    const p = S.progress([{ date: '2026-09-28', weight: 87 }], settings({ startWeight: 86.5, targetWeight: 78 }));
    assert.equal(p.trend, 87);
    assert.near(p.lost, -0.5);
    assert.equal(p.ratio, 0);
    assert.equal(p.left, 9);
    assert.near(p.goal, 8.5);
  });

  test('plates: 8.5 kg goal is 9 plates, fills in order', () => {
    const pl = S.plates({ goal: 8.5, lost: 4 });
    assert.equal(pl.count, 9);
    assert.near(pl.per, 8.5 / 9);
    assert.equal(pl.full, 4);
    assert.near(pl.partial, (4 - 4 * (8.5 / 9)) / (8.5 / 9));
  });

  test('plates: large goals cap at 10 heavier plates, empty goal is one plate', () => {
    const big = S.plates({ goal: 20, lost: 5 });
    assert.equal(big.count, 10);
    assert.equal(big.per, 2);
    assert.equal(big.full, 2);
    assert.near(big.partial, 0.5);
    assert.equal(S.plates({ goal: 0, lost: 0 }).count, 1);
    assert.equal(S.plates({ goal: 5, lost: 9 }).full, 5, 'overshooting the goal fills all plates');
  });

  test('eta: date the trend reaches the target at the current pace', () => {
    assert.equal(S.eta(80, 78, -0.1, '2026-10-01'), '2026-10-21');
    assert.equal(S.eta(80, 78, 0.02, '2026-10-01'), null, 'gaining');
    assert.equal(S.eta(80, 78, -0.001, '2026-10-01'), null, 'flat');
    assert.equal(S.eta(80, 78, null, '2026-10-01'), null);
  });

  test('streaks: today without an entry does not break the streak yet', () => {
    const entries = daily('2026-09-20', [1, 1, 1, 1, 1, null, null, null, 1, 1], () => ({ mood: 3 }));
    const st = S.streaks(entries, '2026-09-30');
    assert.equal(st.current, 2);
    assert.equal(st.best, 5);
    assert.equal(st.loggedToday, false);
    assert.equal(S.streaks(entries, '2026-10-01').current, 0, 'a missed day breaks it');
  });

  test('weeks: empty weeks kept, delta skips weeks without weigh-ins', () => {
    const w = S.weeks([
      { date: '2026-09-14', weight: 88 },
      { date: '2026-09-16', weight: 88.4 },
      { date: '2026-09-28', weight: 87, kcal: 2400, protein: 150 },
      { date: '2026-09-29', weight: 86.8, kcal: 2600, protein: 170, training: 'Upper A' }
    ], '2026-09-30');
    assert.equal(w.length, 3);
    assert.equal(w[1].logged, 0);
    assert.equal(w[1].weight, null);
    assert.near(w[2].weight.avg, 86.9);
    assert.near(w[2].delta, 86.9 - 88.2);
    assert.equal(w[2].kcal.avg, 2500);
    assert.equal(w[2].macros.protein.avg, 160);
    assert.equal(w[2].trainings.length, 1);
    assert.ok(w[2].days[3].future, 'Thursday is still ahead');
  });

  test('kcalState: 85–105% of the target is on target', () => {
    assert.equal(S.kcalState(1700, 2000), 'ok');
    assert.equal(S.kcalState(1699, 2000), 'under');
    assert.equal(S.kcalState(2100, 2000), 'ok');
    assert.equal(S.kcalState(2101, 2000), 'over');
    assert.equal(S.kcalState(undefined, 2000), null);
  });

  test('macroKcal: 4/9/4 kcal per gram, needs all three', () => {
    assert.equal(S.macroKcal({ protein: 160, fat: 70, carbs: 290 }), 2430);
    assert.equal(S.macroKcal({ protein: 160, fat: 70 }), null);
  });

  test('macroMeans: each macro over the days that have it', () => {
    const m = S.macroMeans([{ protein: 100 }, { protein: 200, fat: 50 }, { kcal: 2000 }]);
    assert.equal(m.days, 2);
    assert.deepEqual(m.protein, { avg: 150, count: 2 });
    assert.deepEqual(m.fat, { avg: 50, count: 1 });
    assert.equal(m.carbs, null);
    assert.equal(S.macroMeans([{ kcal: 2000 }]), null);
  });

  // Ten days from Tue 2026-09-01: even days short night, low mood, more food and a training;
  // odd days the opposite. One old entry falls outside the 90-day window.
  function patternData() {
    const days = daily('2026-09-01', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], (i) => {
      const even = i % 2 === 0;
      const e = { sleep: even ? 6 : 8, mood: even ? 2 : 4, kcal: even ? 2800 : 2300 };
      if (even) e.training = 'Upper A';
      return e;
    });
    return [{ date: '2026-06-01', sleep: 6, mood: 5, kcal: 1000 }, ...days];
  }

  test('insights: sleep against mood and food', () => {
    const byId = new Map(S.insights(patternData(), '2026-09-30').map((it) => [it.id, it]));
    const mood = byId.get('sleep-mood');
    assert.ok(mood.ready);
    assert.equal(mood.a.n, 5, 'the June entry is outside the window');
    assert.equal(mood.diff, -2);
    assert.ok(mood.strong);
    assert.equal(byId.get('sleep-kcal').diff, 500);
  });

  test('insights: training compared with the sleep of the next night', () => {
    const it = S.insights(patternData(), '2026-09-30').find((x) => x.id === 'training-sleep');
    assert.ok(it.ready);
    assert.equal(it.a.n, 5);
    assert.equal(it.b.n, 4, 'the last day has no next night yet');
    assert.equal(it.diff, 2);
  });

  test('insights: not ready with fewer than 4 days in a group, weak when the gap is small', () => {
    const list = S.insights(patternData(), '2026-09-30');
    const weekend = list.find((x) => x.id === 'weekend-kcal');
    assert.equal(weekend.a.n, 2);
    assert.ok(!weekend.ready);
    assert.equal(weekend.diff, null);
    const flat = daily('2026-09-01', [6, 8, 6, 8, 6, 8, 6, 8], (h) => ({ sleep: h, mood: 3 }));
    const m = S.insights(flat, '2026-09-30').find((x) => x.id === 'sleep-mood');
    assert.ok(m.ready);
    assert.ok(!m.strong);
  });

  function coachInput(patch) {
    return Object.assign({
      settings: settings({}),
      entries: [{ date: '2026-09-30', mood: 3 }],
      today: '2026-09-30',
      prog: { trend: null },
      mood: null, slopeDay: null, kcal: null, sleep: null, macros: null,
      week: { trainings: [] }, streak: { current: 1 }, planDiff: null
    }, patch);
  }

  test('coachMessage: short sleep and low protein', () => {
    const sleep = S.coachMessage(coachInput({ sleep: { hours: 6, score: null, nights: 4 } }));
    assert.ok(sleep.startsWith('Średnio 6,0 h snu'), sleep);
    const few = S.coachMessage(coachInput({ sleep: { hours: 6, score: null, nights: 3 } }));
    assert.ok(!few.startsWith('Średnio'), 'three nights are not enough');
    const protein = S.coachMessage(coachInput({
      settings: settings({ proteinTarget: 160 }),
      macros: { days: 5, protein: { avg: 120, count: 5 } }
    }));
    assert.ok(protein.startsWith('Białko średnio 120 g przy celu 160 g'), protein);
    const noTarget = S.coachMessage(coachInput({ macros: { days: 5, protein: { avg: 120, count: 5 } } }));
    assert.ok(!noTarget.startsWith('Białko'), 'no protein target, no protein message');
  });

  test('badges: first entry and kilogram milestones', () => {
    const s = settings({ startWeight: 86.5 });
    const entries = [{ date: '2026-09-28', weight: 85 }];
    const b = new Map(S.badges(entries, s, '2026-09-30', S.progress(entries, s)).map((x) => [x.id, x.unlocked]));
    assert.ok(b.get('first'));
    assert.ok(b.get('kg1'));
    assert.ok(!b.get('kg3'));
    assert.ok(!b.get('goal'));
  });
})();
