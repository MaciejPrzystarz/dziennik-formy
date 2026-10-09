/* Tests for the data format in web/js/store.js. The GitHub part isn't covered: it needs the network. */
(function () {
  'use strict';

  const { test, assert } = DFTest;
  const store = DF.store;

  test('cleanEntry: parses, rounds and drops invalid values', () => {
    const e = store.cleanEntry({
      date: '2026-09-28', weight: '84,2', kcal: 2450.6, protein: '160', fat: 70.4, carbs: -5,
      mood: 7, sleep: '7,5', sleepScore: 82, note: '  hej ', extra: 1, empty: '', nothing: null
    });
    assert.deepEqual(e, {
      date: '2026-09-28', weight: 84.2, kcal: 2451, protein: 160, fat: 70,
      sleep: 7.5, sleepScore: 82, note: 'hej', extra: 1
    });
  });

  test('cleanEntry: invalid date or nothing but a date gives null', () => {
    assert.equal(store.cleanEntry({ date: '2026-02-30', weight: 80 }), null);
    assert.equal(store.cleanEntry({ date: '2026-09-28' }), null);
    assert.equal(store.cleanEntry(null), null);
  });

  test('normalize: one entry per day, sorted, later values win', () => {
    const d = store.normalize({
      entries: [
        { date: '2026-09-29', weight: 86, mood: 2 },
        { date: '2026-09-28', kcal: 2000 },
        { date: '2026-09-29', mood: 3 }
      ],
      other: { keep: true }
    });
    assert.deepEqual(d.entries, [
      { date: '2026-09-28', kcal: 2000 },
      { date: '2026-09-29', weight: 86, mood: 3 }
    ]);
    assert.deepEqual(d.other, { keep: true }, 'unknown top-level keys survive');
  });

  test('normalizeSettings: ranges shared with the forms', () => {
    const d = store.DEFAULT_SETTINGS;
    assert.equal(store.normalizeSettings({ kcalTarget: 500 }).kcalTarget, d.kcalTarget);
    assert.equal(store.normalizeSettings({ kcalTarget: 800 }).kcalTarget, 800);
    assert.equal(store.normalizeSettings({ startWeight: 10 }).startWeight, d.startWeight);
    assert.equal(store.normalizeSettings({ weeklyTrainings: 15 }).weeklyTrainings, d.weeklyTrainings);
  });

  test('normalizeSettings: macro targets are optional', () => {
    const s = store.normalizeSettings({ proteinTarget: '160', fatTarget: 0, carbsTarget: 'abc', custom: 'x' });
    assert.equal(s.proteinTarget, 160);
    assert.ok(!('fatTarget' in s), 'zero is not a target');
    assert.ok(!('carbsTarget' in s), 'text is not a target');
    assert.equal(s.custom, 'x', 'unknown settings survive');
    assert.ok(!('proteinTarget' in store.normalizeSettings({ proteinTarget: undefined })));
  });

  test('serialize: key order, one entry per line', () => {
    const data = store.normalize({
      settings: Object.assign({}, store.DEFAULT_SETTINGS, { proteinTarget: 160 }),
      entries: [{ date: '2026-09-28', note: 'x', weight: 87.5, protein: 150, kcal: 2900 }]
    });
    const expected = [
      '{',
      '  "settings": {',
      '    "name": "Maciej",',
      '    "startDate": "2026-09-28",',
      '    "startWeight": 86.5,',
      '    "targetWeight": 78,',
      '    "targetDate": "2027-03-31",',
      '    "kcalTarget": 2450,',
      '    "proteinTarget": 160,',
      '    "weeklyTrainings": 4,',
      '    "trainings": ["Upper A", "Lower", "Upper B", "Rower"]',
      '  },',
      '  "entries": [',
      '    {"date": "2026-09-28", "weight": 87.5, "kcal": 2900, "protein": 150, "note": "x"}',
      '  ]',
      '}',
      ''
    ].join('\n');
    assert.equal(store.serialize(data), expected);
  });

  test('serialize and parse round-trip', () => {
    const data = store.demoData('2026-09-30');
    assert.deepEqual(store.parse(store.serialize(data), 'x'), data);
    assert.equal(store.serialize(store.parse(store.serialize(data), 'x')), store.serialize(data));
  });

  test('parse: syntax error is a parse error, empty file is an empty diary', () => {
    let err = null;
    try { store.parse('{"entries": [', 'data/health.json'); } catch (e) { err = e; }
    assert.ok(err && err.kind === 'parse');
    assert.deepEqual(store.parse('  ', 'x').entries, []);
  });

  test('entryMessage: commit message as described in CLAUDE.md', () => {
    const e = {
      date: '2026-09-28', weight: 84.2, kcal: 2450, protein: 160, fat: 70, carbs: 290,
      training: 'Upper A', mood: 4, sleep: 7.5, sleepScore: 82, note: 'x'
    };
    assert.equal(store.entryMessage(e, e.date),
      'log: 2026-09-28 (84.2 kg, 2450 kcal, B 160 g, T 70 g, W 290 g, Upper A, 4/5, 7.5 h snu, sen 82/100)');
    assert.equal(store.entryMessage({ date: '2026-09-28', note: 'x' }, '2026-09-28'), 'log: 2026-09-28 (notatka)');
    assert.equal(store.entryMessage(null, '2026-09-28'), 'log: 2026-09-28');
  });

  test('settingsMessage: macro targets only when set', () => {
    const s = store.normalizeSettings({});
    assert.equal(store.settingsMessage(s), 'settings: cel 78 kg do 2027-03-31, 2450 kcal, 4 treningi/tydz.');
    assert.equal(store.settingsMessage(store.normalizeSettings({ proteinTarget: 160, carbsTarget: 290 })),
      'settings: cel 78 kg do 2027-03-31, 2450 kcal, B 160 g, W 290 g, 4 treningi/tydz.');
  });

  test('demoData: stable, ten weeks, every entry already clean', () => {
    const a = store.demoData('2026-09-30');
    assert.equal(JSON.stringify(a), JSON.stringify(store.demoData('2026-09-30')));
    assert.ok(a.entries[0].date >= '2026-07-23');
    assert.equal(a.entries[a.entries.length - 1].date, '2026-09-30');
    a.entries.forEach((e) => assert.deepEqual(store.cleanEntry(e), e, e.date));
    assert.ok(a.entries.some((e) => DF.stats.macroKcal(e) != null), 'demo has macros');
  });

  test('weekWindow: Sunday to the last Saturday before the given day', () => {
    assert.deepEqual(store.weekWindow('2026-10-11'), { start: '2026-10-04', end: '2026-10-10' }); // Sunday
    assert.deepEqual(store.weekWindow('2026-10-14'), { start: '2026-10-04', end: '2026-10-10' }); // Wednesday
    assert.deepEqual(store.weekWindow('2026-10-17'), { start: '2026-10-04', end: '2026-10-10' }); // Saturday: week not over
    assert.deepEqual(store.weekWindow('2026-10-25'), { start: '2026-10-18', end: '2026-10-24' }); // DST change day
  });

  test('weeklyMerge: the finished week moves to main, later days wait', () => {
    const main = store.normalize({
      settings: { kcalTarget: 2450 },
      entries: [{ date: '2026-10-01', weight: 86.3 }, { date: '2026-10-02', weight: 87 }]
    });
    const staged = store.normalize({
      settings: { kcalTarget: 2400 },
      entries: [
        { date: '2026-10-01', weight: 86.1 }, // older day corrected
        // 2026-10-02 deleted
        { date: '2026-10-04', weight: 87.2 },
        { date: '2026-10-10', kcal: 2500 },
        { date: '2026-10-11', weight: 86 } // Sunday of the next week
      ]
    });
    const m = store.weeklyMerge(main, staged, '2026-10-10');
    assert.deepEqual(m.data.entries.map((e) => e.date), ['2026-10-01', '2026-10-04', '2026-10-10']);
    assert.equal(m.data.entries[0].weight, 86.1);
    assert.equal(m.data.settings.kcalTarget, 2400);
    assert.deepEqual(m.days, ['2026-10-01', '2026-10-02', '2026-10-04', '2026-10-10']);
    assert.ok(m.settings && m.changed);
    assert.equal(store.weeklyMessage({ start: '2026-10-04', end: '2026-10-10' }, m),
      'log: tydzień 2026-10-04 – 2026-10-10 (2 dni z wpisem, poprawki: 2026-10-01, 2026-10-02, cele)');

    const again = store.weeklyMerge(m.data, staged, '2026-10-10');
    assert.ok(!again.changed, 'second run on the same Sunday changes nothing');
    assert.deepEqual(again.days, []);
  });

  test('cleanEntry: Garmin fields validated, saved after the logged ones, note last', () => {
    const e = store.cleanEntry({
      date: '2026-10-09', note: 'x', vo2max: 47.26, hrvStatus: 'BALANCED', hrv: 48.4, steps: '8432',
      restingHr: 52, stress: -1, bodyBatteryHigh: 85, bodyBatteryLow: 120, activity: ' Rower 40 km ', weight: 86.4
    });
    assert.deepEqual(e, {
      date: '2026-10-09', weight: 86.4, steps: 8432, restingHr: 52, bodyBatteryHigh: 85, hrv: 48,
      hrvStatus: 'balanced', vo2max: 47.3, activity: 'Rower 40 km', note: 'x'
    });
    const line = store.serialize(store.normalize({ entries: [e] })).split('\n').find((l) => l.includes('2026-10-09'));
    assert.equal(line.trim(),
      '{"date": "2026-10-09", "weight": 86.4, "steps": 8432, "restingHr": 52, "bodyBatteryHigh": 85, "hrv": 48, ' +
      '"hrvStatus": "balanced", "vo2max": 47.3, "activity": "Rower 40 km", "note": "x"}');
  });

  test('mergeForm: saving the form keeps Garmin data', () => {
    const server = { date: '2026-10-09', weight: 86.4, sleep: 7.8, steps: 8432, hrv: 48, activity: 'Spacer 30 min' };
    const merged = store.mergeForm(server, { date: '2026-10-09', weight: 86.4, sleep: 7.8, kcal: 2400 }, server);
    assert.deepEqual(merged, { date: '2026-10-09', weight: 86.4, sleep: 7.8, steps: 8432, hrv: 48, activity: 'Spacer 30 min', kcal: 2400 });
  });

  test('applyGarmin: Garmin numbers updated, what you typed wins, missing never deletes', () => {
    const data = store.normalize({
      settings: { trainings: ['Upper A', 'Lower', 'Upper B', 'Rower'] },
      entries: [{ date: '2026-10-08', sleep: 7, sleepScore: 80, steps: 1000, training: 'Lower' }]
    });
    const r = store.applyGarmin(data, [
      { date: '2026-10-08', sleep: 7.53, sleepScore: 82, steps: 9500, hrv: 45, hrvStatus: 'balanced',
        activities: [{ type: 'road_biking', name: 'Rano', km: 40.24, min: 92 }] },
      { date: '2026-10-09', sleep: 7.8, sleepScore: 89, weight: 86.4, restingHr: 51, stress: 28,
        bodyBatteryHigh: 90, bodyBatteryLow: 25, vo2max: 47.3,
        activities: [{ type: 'strength_training', name: 'Siła', min: 58 }, { type: 'cycling', km: 12, min: 30 }] },
      { date: '2026-10-10', steps: null }
    ]);
    assert.deepEqual(r.days, ['2026-10-08', '2026-10-09']);
    const [a, b] = r.data.entries;
    assert.equal(a.sleep, 7, 'typed sleep wins');
    assert.equal(a.sleepScore, 80);
    assert.equal(a.steps, 9500, 'Garmin field updated');
    assert.equal(a.training, 'Lower', 'typed training wins');
    assert.equal(a.activity, 'Rower 40,2 km, 1 h 32 min');
    assert.equal(b.sleep, 7.8, 'empty sleep filled');
    assert.equal(b.weight, 86.4);
    assert.equal(b.training, 'Rower', 'cycling matches a training name, strength does not');
    assert.equal(b.activity, 'Siłownia 58 min; Rower 12 km, 30 min');
    assert.ok(!r.data.entries.some((e) => e.date === '2026-10-10'), 'no data, no entry');

    const again = store.applyGarmin(r.data, [{ date: '2026-10-08', steps: 9500 }, { date: '2026-10-09' }]);
    assert.deepEqual(again.days, [], 'same numbers again: nothing to commit');
    assert.equal(again.data.entries[0].activity, 'Rower 40,2 km, 1 h 32 min', 'activities missing from the reply stay');
    assert.equal(store.garminMessage(r.days), 'garmin: 2026-10-08, 2026-10-09');
  });
})();
