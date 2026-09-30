/* Dziennik formy: a tiny test harness. No dependencies, so the same tests run in a browser
   (tests/index.html) and in Node (tests/run.mjs, used by GitHub Actions). */
(function (g) {
  'use strict';

  const cases = [];

  class AssertionError extends Error {
    constructor(message) {
      super(message);
      this.name = 'AssertionError';
    }
  }

  // JSON with sorted keys, so deepEqual doesn't care about key order.
  function canon(v) {
    if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
    if (v && typeof v === 'object') {
      return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
    }
    return v === undefined ? 'undefined' : JSON.stringify(v);
  }

  const show = (v) => (typeof v === 'string' ? JSON.stringify(v) : canon(v));

  const assert = {
    ok(value, message) {
      if (!value) throw new AssertionError(message || `expected a truthy value, got ${show(value)}`);
    },
    equal(actual, expected, message) {
      if (actual !== expected) {
        throw new AssertionError(`${message ? `${message}: ` : ''}expected ${show(expected)}, got ${show(actual)}`);
      }
    },
    near(actual, expected, eps = 1e-9, message) {
      if (typeof actual !== 'number' || Math.abs(actual - expected) > eps) {
        throw new AssertionError(`${message ? `${message}: ` : ''}expected ${expected} ± ${eps}, got ${show(actual)}`);
      }
    },
    deepEqual(actual, expected, message) {
      if (canon(actual) !== canon(expected)) {
        throw new AssertionError(`${message ? `${message}: ` : ''}expected ${canon(expected)}, got ${canon(actual)}`);
      }
    }
  };

  function test(name, fn) {
    cases.push({ name, fn });
  }

  function run() {
    const results = cases.map(({ name, fn }) => {
      try {
        fn();
        return { name, ok: true };
      } catch (err) {
        return { name, ok: false, error: err && err.stack ? String(err.stack) : String(err) };
      }
    });
    const failed = results.filter((r) => !r.ok).length;
    return { results, passed: results.length - failed, failed };
  }

  g.DFTest = { test, assert, run };
})(globalThis);
