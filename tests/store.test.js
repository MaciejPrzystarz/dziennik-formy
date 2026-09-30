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
})();
