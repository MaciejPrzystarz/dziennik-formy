/* Tests for web/js/utils.js */
(function () {
  'use strict';

  const { test, assert } = DFTest;
  const U = DF.utils;

  test('parseNumber: Polish decimal comma and spaces', () => {
    assert.equal(U.parseNumber('84,2'), 84.2);
    assert.equal(U.parseNumber(' 2 450 '), 2450);
    assert.equal(U.parseNumber(85), 85);
  });

  test('parseNumber: empty or invalid gives null', () => {
    assert.equal(U.parseNumber(''), null);
    assert.equal(U.parseNumber('   '), null);
    assert.equal(U.parseNumber('abc'), null);
    assert.equal(U.parseNumber(null), null);
    assert.equal(U.parseNumber(undefined), null);
    assert.equal(U.parseNumber(NaN), null);
    assert.equal(U.parseNumber(Infinity), null);
  });

  test('addDays: across month and year ends', () => {
    assert.equal(U.addDays('2026-09-30', 1), '2026-10-01');
    assert.equal(U.addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(U.addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(U.addDays('2028-03-01', -1), '2028-02-29');
  });

  test('diffDays: whole days across both DST changes', () => {
    assert.equal(U.diffDays('2026-10-24', '2026-10-26'), 2);
    assert.equal(U.diffDays('2027-03-27', '2027-03-29'), 2);
    assert.equal(U.diffDays('2026-09-28', '2027-03-31'), 184);
    assert.equal(U.diffDays('2026-10-01', '2026-09-30'), -1);
  });

  test('isValidKey: real calendar days only', () => {
    assert.ok(U.isValidKey('2026-09-28'));
    assert.ok(!U.isValidKey('2026-02-30'));
    assert.ok(!U.isValidKey('2026-9-28'));
    assert.ok(!U.isValidKey('28.09.2026'));
    assert.ok(!U.isValidKey(20260928));
  });

  test('weekdayIndex and weekStart: weeks start on Monday', () => {
    assert.equal(U.weekdayIndex('2026-09-28'), 0); // Monday
    assert.equal(U.weekdayIndex('2026-10-04'), 6); // Sunday
    assert.equal(U.weekStart('2026-09-30'), '2026-09-28');
    assert.equal(U.weekStart('2026-10-04'), '2026-09-28');
    assert.equal(U.weekStart('2026-10-05'), '2026-10-05');
  });

  test('dayRange: inclusive on both ends', () => {
    assert.deepEqual(U.dayRange('2026-09-29', '2026-10-01'), ['2026-09-29', '2026-09-30', '2026-10-01']);
    assert.deepEqual(U.dayRange('2026-10-01', '2026-10-01'), ['2026-10-01']);
    assert.deepEqual(U.dayRange('2026-10-02', '2026-10-01'), []);
  });

  test('plural: Polish forms', () => {
    const t = (n) => U.plural(n, 'trening', 'treningi', 'treningów');
    assert.equal(t(1), 'trening');
    assert.equal(t(2), 'treningi');
    assert.equal(t(4), 'treningi');
    assert.equal(t(5), 'treningów');
    assert.equal(t(12), 'treningów');
    assert.equal(t(14), 'treningów');
    assert.equal(t(22), 'treningi');
    assert.equal(t(0), 'treningów');
  });

  test('signed: real minus sign, never "−0,0"', () => {
    assert.equal(U.signed(-0.5), U.MINUS + '0,5');
    assert.equal(U.signed(1.2), '+1,2');
    assert.equal(U.signed(-0.04), '0,0');
    assert.equal(U.signed(0), '0,0');
  });

  test('number formats', () => {
    assert.equal(U.fmtWeight(84.2), '84,2');
    assert.equal(U.fmtWeight(84.35), '84,35');
    assert.equal(U.fmtHours(7.5), '7,5');
    assert.equal(U.fmtHours(8), '8');
    assert.equal(U.weightInput(86.5), '86,5');
    assert.equal(U.weightInput(84), '84');
  });

  test('fmtRange: one month and across two', () => {
    assert.equal(U.fmtRange('2026-09-21', '2026-09-27'), '21–27.09');
    assert.equal(U.fmtRange('2026-09-28', '2026-10-04'), '28.09–04.10');
  });

  test('escapeHtml', () => {
    assert.equal(U.escapeHtml('<b a="1">&\'</b>'), '&lt;b a=&quot;1&quot;&gt;&amp;&#39;&lt;/b&gt;');
  });
})();
