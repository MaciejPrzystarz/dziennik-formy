// Weekly commit: moves the finished week (Sunday to Saturday) from the working branch to main.
// Usage (TZ=Europe/Warsaw): node scripts/weekly-commit.mjs <main file> <working branch file> [today RRRR-MM-DD]
// Writes the new main version over <main file>. Prints the commit message, or nothing when main is up to date.
import { readFileSync, writeFileSync } from 'node:fs';
import { loadApp } from './app.mjs';

const [mainPath, stagedPath, todayArg] = process.argv.slice(2);
if (!mainPath || !stagedPath) {
  console.error('usage: node scripts/weekly-commit.mjs <main file> <working branch file> [today]');
  process.exit(2);
}

const { store, utils } = loadApp();
const today = todayArg || utils.todayKey();
const win = store.weekWindow(today);
const main = store.parse(readFileSync(mainPath, 'utf8'), 'data/health.json (main)');
const staged = store.parse(readFileSync(stagedPath, 'utf8'), 'data/health.json (bufor)');
const merged = store.weeklyMerge(main, staged, win.end);

if (merged.changed) {
  writeFileSync(mainPath, store.serialize(merged.data));
  console.log(store.weeklyMessage(win, merged));
}
