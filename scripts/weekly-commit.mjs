// Weekly commit: moves the finished week (Sunday to Saturday) from the working branch to main.
// Usage (TZ=Europe/Warsaw): node scripts/weekly-commit.mjs <main file> <working branch file> [today RRRR-MM-DD] [--base <file>]
// --base: the file where the working branch split off main (git merge-base). With it, days saved
// straight to main survive, and <working branch file> is rewritten with main's days merged in.
// Writes the new main version over <main file>. Prints the commit message, or nothing when main is up to date.
import { readFileSync, writeFileSync } from 'node:fs';
import { loadApp } from './app.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--base');
const basePath = at >= 0 ? args.splice(at, 2)[1] : null;
const [mainPath, stagedPath, todayArg] = args;
if (!mainPath || !stagedPath || (at >= 0 && !basePath)) {
  console.error('usage: node scripts/weekly-commit.mjs <main file> <working branch file> [today] [--base <file>]');
  process.exit(2);
}

const { store, utils } = loadApp();
const today = todayArg || utils.todayKey();
const win = store.weekWindow(today);
const main = store.parse(readFileSync(mainPath, 'utf8'), 'data/health.json (main)');
const staged = store.parse(readFileSync(stagedPath, 'utf8'), 'data/health.json (bufor)');
const base = basePath ? store.parse(readFileSync(basePath, 'utf8'), 'data/health.json (merge-base)') : undefined;
const merged = store.weeklyMerge(main, staged, win.end, base);

if (base) writeFileSync(stagedPath, store.serialize(merged.staged));
if (merged.changed) {
  writeFileSync(mainPath, store.serialize(merged.data));
  console.log(store.weeklyMessage(win, merged));
}
