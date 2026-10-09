// The app's own code (utils, stats, store) for scripts in Node, loaded into a sandbox the same way
// as tests/run.mjs, so scripts read and write the data file exactly like the app does.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

export function loadApp() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const sandbox = { console, TextEncoder, TextDecoder, atob, btoa, setTimeout, clearTimeout };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const file of ['web/js/utils.js', 'web/js/stats.js', 'web/js/store.js']) {
    vm.runInContext(readFileSync(join(root, file), 'utf8'), sandbox, { filename: file });
  }
  return sandbox.DF;
}
