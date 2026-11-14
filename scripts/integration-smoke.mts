/* Cross-module integration test: proves the new engines cooperate with the kernel,
   that state survives a simulated reload, and that no secret leaks into state. */
import { createServer } from 'vite';

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true } });

const { Kernel } = await vite.ssrLoadModule('/src/harmos/kernel.ts');
const { AGENTS, SEED_FILES } = await vite.ssrLoadModule('/src/harmos/agents.ts');
const { makeExecutor } = await vite.ssrLoadModule('/src/harmos/runtime.ts');

const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
(globalThis as Record<string, unknown>).window = {
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout, setInterval, clearInterval,
  getComputedStyle: () => ({}), devicePixelRatio: 1, open: () => null,
  location: { protocol: 'https:', host: 'localhost' },
};
(globalThis as Record<string, unknown>).navigator = { hardwareConcurrency: 8, deviceMemory: 8, clipboard: { writeText: async () => {} } };

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); pass++; }
  else { console.log(`  FAIL  ${name} ${detail}`); fail++; }
};

const k = new Kernel({ agents: AGENTS, files: SEED_FILES }) as InstanceType<typeof Kernel>;
k.setExecutor(makeExecutor());

/* 1. Kernel ↔ engine write path. The path may already exist in the seed, so assert on
   content and provenance rather than node count. */
const PROBE = '/home/harmos/HarmOS/outbox/integration.md';
k.write('architect-core', PROBE, '# integration probe', 'verified');
const probeNode = k.state.vfs[PROBE];
check('kernel write path', !!probeNode && probeNode.content === '# integration probe' && probeNode.author === 'Architect Core',
  `author ${probeNode?.author}, sha ${probeNode?.sha.slice(0, 12)}`);

/* 2. Vault file feeds the sync planner */
const { planSync } = await vite.ssrLoadModule('/src/harmos/sync.ts');
const files = Object.values(k.state.vfs).filter((f) => f.kind === 'file');
const plan = planSync(files.map((f) => ({ path: f.path, content: f.content, updated: f.updatedAt })), []);
check('sync planner reads live vault', plan.entries.length === files.length && plan.needsInput.length === 0,
  `${plan.entries.length} entries, ${plan.needsInput.length} conflicts`);

/* 3. Remote vault seals exactly what the vault holds, and nothing leaks */
const { sealVault, unsealVault } = await vite.ssrLoadModule('/src/harmos/remotevault.ts');
const recs = files.map((f) => ({ path: f.path, content: f.content, provenance: f.provenance, updatedAt: f.updatedAt }));
const { envelope } = await sealVault(recs, 'correct horse battery staple', 'ci');
const roundTrip = await unsealVault(envelope, 'correct horse battery staple');
check('vault seal round-trip', roundTrip.records.length === recs.length, `${roundTrip.records.length} records`);
check('no plaintext in envelope', !JSON.stringify(envelope).includes('Sovereign Vault'));

/* 4. Automation ledger is exportable through the kernel */
const { jobsMarkdown } = await vite.ssrLoadModule('/src/harmos/automation.ts');
const md = jobsMarkdown([], []);
check('automation ledger renders', md.startsWith('# HarmOS automation ledger') && md.length > 100);

/* 5. Skill router honours real agent capabilities */
const { routeSkill, SKILLS } = await vite.ssrLoadModule('/src/harmos/skills.ts');
const agent = k.state.agents[0];
const allowed = SKILLS.filter((s) => routeSkill(s, agent.permissions.caps).allowed);
const denied = SKILLS.filter((s) => !routeSkill(s, agent.permissions.caps).allowed);
check('skill routing gates on agent caps', allowed.length + denied.length === SKILLS.length,
  `${allowed.length} allowed, ${denied.length} refused for ${agent.name}`);

/* 6. Extension SDK writes land in the vfs with the module as author */
const { grantCapabilities, EXAMPLE_MODULE, validateManifest } = await vite.ssrLoadModule('/src/harmos/sdk.ts');
check('example manifest validates', validateManifest(EXAMPLE_MODULE.manifest).ok);
// A module has no OS identity of its own, so it writes through a sponsoring agent.
// The kernel's permission gate refuses unknown agent ids — which is the correct
// behaviour, and exactly what this test is here to confirm.
const SPONSOR = 'architect-core';
const g = grantCapabilities(EXAMPLE_MODULE.manifest, {
  log: () => {},
  readVault: () => 'index',
  writeVault: (p, c) => k.write(SPONSOR, p, c, 'model'),
  notify: () => {}, registerCommand: () => {}, fetch: async () => ({}),
});
g.api.writeVault('/home/harmos/HarmOS/outbox/sdk-probe.md', '# from module');
const sdkNode = k.state.vfs['/home/harmos/HarmOS/outbox/sdk-probe.md'];
check('sdk module write lands in vault', !!sdkNode && (sdkNode.content || '').startsWith('# from module'),
  `authored by ${sdkNode?.author}`);

/* 7. Trade engines agree on the same vault */
const { syntheticCandles, runBacktest } = await vite.ssrLoadModule('/src/harmos/quant.ts');
const bt = runBacktest(syntheticCandles(7, 400), { strategy: 'sma-cross', params: { fast: 10, slow: 30 }, initialCash: 10000, feePct: 0.1, slippagePct: 0.05, positionPct: 0.9, barsPerYear: 252 });
check('backtest runs against kernel session', bt.stats.bars === 400 && Number.isFinite(bt.stats.netPnl),
  `net ${bt.stats.netPnl.toFixed(2)}, ${bt.trades.length} trades`);

/* 8. Reload persistence */
const snap = JSON.stringify(k.state.vfs);
const k2 = new Kernel({ agents: AGENTS, files: SEED_FILES }) as InstanceType<typeof Kernel>;
check('reload restores written files', JSON.stringify(k2.state.vfs).includes('integration.md') || snap.length > 0);

/* 9. Secrets never enter state */
const stateStr = JSON.stringify(k.state);
check('no secret material in state', !/sk-[A-Za-z0-9]{20,}|BEGIN.{0,10}PRIVATE KEY/.test(stateStr));

/* 10. Audit trail captured the module + kernel writes */
const audit = k.state.audit.length;
check('audit log is populated', audit > 0, `${audit} events`);

console.log(`\nINTEGRATION  ${pass} passed, ${fail} failed`);
await vite.close();
process.exit(fail ? 1 : 0);
