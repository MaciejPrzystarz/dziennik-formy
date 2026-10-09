// Garmin days (from scripts/garmin_fetch.py) → the data file, with the app's rules (store.applyGarmin):
// Garmin's own numbers are updated, sleep / sleep score / weight / training only fill empty fields.
// Usage: node scripts/garmin-apply.mjs <data file> <days.json>
// Rewrites <data file> and prints the commit message, or nothing when nothing changed.
import { readFileSync, writeFileSync } from 'node:fs';
import { loadApp } from './app.mjs';

const [dataPath, daysPath] = process.argv.slice(2);
if (!dataPath || !daysPath) {
  console.error('usage: node scripts/garmin-apply.mjs <data file> <days.json>');
  process.exit(2);
}

const { store } = loadApp();
const data = store.parse(readFileSync(dataPath, 'utf8'), dataPath);
const result = store.applyGarmin(data, JSON.parse(readFileSync(daysPath, 'utf8')));

if (result.days.length) {
  writeFileSync(dataPath, store.serialize(result.data));
  console.log(store.garminMessage(result.days));
}
