/* Renders every AetherFrame panel through Vite SSR.
   A panel that throws here would throw in a real session too, so this is the
   browser-equivalent smoke test. Run: npx tsx scripts/render-smoke.mts */
import { createServer } from 'vite';
import React from 'react';
import { renderToString } from 'react-dom/server';

const vite = await createServer({
  root: process.cwd(),
  logLevel: 'error',
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
});

const { Kernel } = await vite.ssrLoadModule('/src/harmos/kernel.ts');
const { AGENTS, SEED_FILES } = await vite.ssrLoadModule('/src/harmos/agents.ts');
const { makeExecutor } = await vite.ssrLoadModule('/src/harmos/runtime.ts');
const { KernelCtx } = await vite.ssrLoadModule('/src/ui/kit.tsx');
const { FirstBoot } = await vite.ssrLoadModule('/src/ui/firstboot.tsx');
const control = await vite.ssrLoadModule('/src/ui/panels/control.tsx');
const nexus = await vite.ssrLoadModule('/src/ui/panels/nexus.tsx');
const data = await vite.ssrLoadModule('/src/ui/panels/data.tsx');
const system = await vite.ssrLoadModule('/src/ui/panels/system.tsx');
const nb = await vite.ssrLoadModule('/src/ui/panels/neuronbrain.tsx');
const sec = await vite.ssrLoadModule('/src/ui/panels/itsecurity.tsx');
const inst = await vite.ssrLoadModule('/src/ui/panels/installer.tsx');
const trading = await vite.ssrLoadModule('/src/ui/panels/trading.tsx');
const commerce = await vite.ssrLoadModule('/src/ui/panels/commerce.tsx');
const guide = await vite.ssrLoadModule('/src/ui/panels/installguide.tsx');
const lab = await vite.ssrLoadModule('/src/ui/panels/tradelab.tsx');
const automation = await vite.ssrLoadModule('/src/ui/panels/automation.tsx');
const voice = await vite.ssrLoadModule('/src/ui/panels/voicebridge.tsx');
const sync = await vite.ssrLoadModule('/src/ui/panels/sync.tsx');
const rv = await vite.ssrLoadModule('/src/ui/panels/remotevault.tsx');
const ext = await vite.ssrLoadModule('/src/ui/panels/extensions.tsx');
const skills = await vite.ssrLoadModule('/src/ui/panels/skills.tsx');

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
  addEventListener() {}, removeEventListener() {},
  setTimeout, clearTimeout, setInterval, clearInterval,
  getComputedStyle: () => ({}), devicePixelRatio: 1, open: () => null,
  location: { protocol: 'https:', host: 'localhost' },
};
(globalThis as Record<string, unknown>).navigator = {
  hardwareConcurrency: 8, deviceMemory: 8,
  clipboard: { writeText: async () => {} },
  storage: { estimate: async () => ({ usage: 1, quota: 2 }) },
};
(globalThis as Record<string, unknown>).requestAnimationFrame = (f: (t: number) => void) => setTimeout(() => f(0), 0);
(globalThis as Record<string, unknown>).cancelAnimationFrame = (id: number) => clearTimeout(id as unknown as number);

const kernel = new Kernel({ agents: AGENTS, files: SEED_FILES }) as InstanceType<typeof Kernel>;
kernel.setExecutor(makeExecutor());

const PANELS: Array<[string, React.ComponentType]> = [
  ['FirstBoot', FirstBoot],
  ['ControlCenter', control.ControlCenter], ['SystemMonitor', control.SystemMonitor],
  ['RegistryPanel', control.RegistryPanel], ['LgaiPanel', control.LgaiPanel],
  ['NexusTerminal', nexus.NexusTerminal], ['AgentMatrix', nexus.AgentMatrix],
  ['WorkflowBuilder', nexus.WorkflowBuilder], ['QalPanel', nexus.QalPanel],
  ['SovereignVault', data.SovereignVault], ['ArchitectStudio', data.ArchitectStudio],
  ['ProtocolPanel', data.ProtocolPanel],
  ['ModelManager', system.ModelManager], ['SecurityCenter', system.SecurityCenter],
  ['SettingsPanel', system.SettingsPanel], ['TestsPanel', system.TestsPanel],
  ['ReleaseWorkbench', system.ReleaseWorkbench],
  ['NeuronBrainPanel', nb.NeuronBrainPanel], ['ItSecurityPanel', sec.ItSecurityPanel],
  ['InstallerPanel', inst.InstallerPanel], ['TradingDesk', trading.TradingDesk],
  ['CommerceStudio', commerce.CommerceStudio], ['InstallGuidePanel', guide.InstallGuidePanel],
  ['TradeLabPanel', lab.TradeLabPanel], ['AutomationPanel', automation.AutomationPanel],
  ['VoicePanel', voice.VoicePanel], ['SyncPanel', sync.SyncPanel],
  ['RemoteVaultPanel', rv.RemoteVaultPanel], ['ExtensionsPanel', ext.ExtensionsPanel],
  ['SkillsPanel', skills.SkillsPanel],
];

let pass = 0, fail = 0;
for (const [name, Comp] of PANELS) {
  try {
    if (typeof Comp !== 'function') throw new Error('export missing');
    const html = renderToString(
      React.createElement(KernelCtx.Provider, { value: kernel }, React.createElement(Comp as never)),
    );
    if (html.length < 200) throw new Error(`suspiciously small output (${html.length} chars)`);
    console.log(`  PASS  ${name} (${html.length} chars)`);
    pass++;
  } catch (e) {
    console.log(`  FAIL  ${name}: ${e instanceof Error ? e.message : String(e)}`);
    fail++;
  }
}
console.log(`\nRENDER  ${pass} passed, ${fail} failed`);
await vite.close();
process.exit(fail ? 1 : 0);
