// Weekly commit: moves the finished week (Sunday to Saturday) from the working branch to main.
// Uses the app's own code (web/js/store.js), loaded into a sandbox the same way as tests/run.mjs,
// so the file format is identical to what the app writes.
// Usage (TZ=Europe/Warsaw): node scripts/weekly-commit.mjs <main file> <working branch file> [today RRRR-MM-DD]
// Writes the new main version over <main file>. Prints the commit message, or nothing when main is up to date.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const [mainPath, stagedPath, todayArg] = process.argv.slice(2);
if (!mainPath || !stagedPath) {
  console.error('usage: node scripts/weekly-commit.mjs <main file> <working branch file> [today]');
  process.exit(2);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { console, TextEncoder, TextDecoder, atob, btoa, setTimeout, clearTimeout };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const file of ['web/js/utils.js', 'web/js/stats.js', 'web/js/store.js']) {
  vm.runInContext(readFileSync(join(root, file), 'utf8'), sandbox, { filename: file });
}
const { store, utils } = sandbox.DF;

const today = todayArg || utils.todayKey();
const win = store.weekWindow(today);
const main = store.parse(readFileSync(mainPath, 'utf8'), 'data/health.json (main)');
const staged = store.parse(readFileSync(stagedPath, 'utf8'), 'data/health.json (bufor)');
const merged = store.weeklyMerge(main, staged, win.end);

if (merged.changed) {
  writeFileSync(mainPath, store.serialize(merged.data));
  console.log(store.weeklyMessage(win, merged));
}
