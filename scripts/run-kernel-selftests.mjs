/* Headless runner for the HarmOS kernel self-test suite.
 *
 * Bundles the real src/harmos modules with esbuild and executes runSelfTests() under
 * Node with minimal browser shims (localStorage, window timers). It runs the SAME code
 * the Test Runner panel runs — no mocks of HarmOS logic itself.
 *
 *   node scripts/run-kernel-selftests.mjs
 *
 * Exit code 0 only if every test passes.
 */
import { build } from 'esbuild';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// --- browser shims -----------------------------------------------------------
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
globalThis.window = globalThis;
globalThis.window.setTimeout = setTimeout;
globalThis.window.setInterval = setInterval;
globalThis.window.clearTimeout = clearTimeout;
globalThis.window.addEventListener = () => {};

mkdirSync('.tmp', { recursive: true });
const outfile = '.tmp/harmos-selftest.mjs';

await build({
  entryPoints: ['scripts/selftest-entry.ts'],
  bundle: true, format: 'esm', platform: 'neutral',
  mainFields: ['module', 'main'], outfile, logLevel: 'error',
  define: { 'import.meta.env.DEV': 'false' },
});

const { runAll } = await import(pathToFileURL(process.cwd() + '/' + outfile).href);
const results = await runAll();

const pass = results.filter((r) => r.pass).length;
console.log(`\nHarmOS kernel self-tests — ${new Date().toISOString()}\n`);
for (const r of results) {
  console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(22)} ${r.name}`);
  console.log(`        ${r.detail}`);
}
console.log(`\nRESULT: ${pass}/${results.length} passed\n`);

writeFileSync('.tmp/selftest-results.json', JSON.stringify(results, null, 2));
rmSync(outfile, { force: true });
process.exit(pass === results.length ? 0 : 1);
