// Runs the tests in Node without any packages: the app's scripts are loaded into one sandbox
// that plays the role of `window`, in the same order as in web/index.html.
// Usage: node tests/run.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'web/js/utils.js',
  'web/js/stats.js',
  'web/js/store.js',
  'tests/harness.js',
  'tests/utils.test.js',
  'tests/stats.test.js',
  'tests/store.test.js'
];

const memory = new Map();
const sandbox = {
  console, TextEncoder, TextDecoder, atob, btoa, setTimeout, clearTimeout,
  localStorage: {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, String(v)),
    removeItem: (k) => memory.delete(k)
  }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const file of files) {
  vm.runInContext(readFileSync(join(root, file), 'utf8'), sandbox, { filename: file });
}

const { results, passed, failed } = sandbox.DFTest.run();
for (const r of results) {
  console.log(`${r.ok ? '✓' : '✗'} ${r.name}`);
  if (!r.ok) console.log(r.error.replace(/^/gm, '    '));
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
