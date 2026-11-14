import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Kernel, VERSION_STRING } from './harmos/kernel';
import { AGENTS, SEED_FILES } from './harmos/agents';
import { makeExecutor } from './harmos/runtime';
import { KernelCtx, useKernelState, cx, Tag } from './ui/kit';
import { FirstBoot, HarmMark } from './ui/firstboot';
import { ControlCenter, SystemMonitor, RegistryPanel, LgaiPanel } from './ui/panels/control';
import { NexusTerminal, AgentMatrix, WorkflowBuilder, QalPanel } from './ui/panels/nexus';
import { SovereignVault, ArchitectStudio, ProtocolPanel } from './ui/panels/data';
import { ModelManager, SecurityCenter, SettingsPanel, TestsPanel, ReleaseWorkbench } from './ui/panels/system';
import { NeuronBrainPanel } from './ui/panels/neuronbrain';
import { ItSecurityPanel } from './ui/panels/itsecurity';
import { InstallerPanel } from './ui/panels/installer';
import { TradingDesk } from './ui/panels/trading';
import { CommerceStudio } from './ui/panels/commerce';
import { InstallGuidePanel } from './ui/panels/installguide';
import { TradeLabPanel } from './ui/panels/tradelab';
import { AutomationPanel } from './ui/panels/automation';
import { VoicePanel } from './ui/panels/voicebridge';
import { SyncPanel } from './ui/panels/sync';
import { RemoteVaultPanel } from './ui/panels/remotevault';
import { ExtensionsPanel } from './ui/panels/extensions';
import { SkillsPanel } from './ui/panels/skills';

/* The kernel is created once per page load, outside React, and registers the real
 * executor before any component renders. */
const kernel = new Kernel({ agents: AGENTS, files: SEED_FILES });
kernel.setExecutor(makeExecutor());

interface AppDef { id: string; title: string; glyph: string; hint: string; render: (open: (id: string) => void) => React.ReactNode; w: number; h: number }

const APPS: AppDef[] = [
  { id: 'control', title: 'Control Center', glyph: '◉', hint: 'Module status, runtime health, readiness', w: 1080, h: 720, render: (open) => <ControlCenter open={open} /> },
  { id: 'neuronbrain', title: 'NeuronBrain Vault', glyph: '◎', hint: '3D synaptic cortex visualizer for Sovereign Vault', w: 1180, h: 740, render: () => <NeuronBrainPanel /> },
  { id: 'itsecurity', title: 'IT Security', glyph: '🛡', hint: 'Anti-hacking IDS, SHA-256 FIM, secret sweep, firewall builder', w: 1120, h: 730, render: () => <ItSecurityPanel /> },
  { id: 'installer', title: 'Installer (.EXE/.SH)', glyph: '⤓', hint: 'Auto & Manual VirtualBox installer + HarmOS OVA', w: 1080, h: 720, render: () => <InstallerPanel /> },
  { id: 'guide', title: 'Install Guide', glyph: '☰', hint: 'Dummy-proof steps for Windows, macOS, Ubuntu, Kali', w: 980, h: 740, render: () => <InstallGuidePanel /> },
  { id: 'trading', title: 'Paper Trading', glyph: '₮', hint: 'Crypto, equities, FX — paper only, advanced modes', w: 1180, h: 760, render: () => <TradingDesk /> },
  { id: 'commerce', title: 'Store Studio', glyph: '▣', hint: 'Draft storefronts, SKUs, dropshipping SOP', w: 1100, h: 740, render: () => <CommerceStudio /> },
  { id: 'tradelab', title: 'Trade Lab', glyph: '◮', hint: 'Connectivity, backtest, risk, tax ledger, alerts, reports', w: 1180, h: 780, render: () => <TradeLabPanel /> },
  { id: 'automation', title: 'Automation', glyph: '◷', hint: 'Cron scheduler, jitter, retries, run ledger', w: 1120, h: 760, render: () => <AutomationPanel /> },
  { id: 'skills', title: 'Agent Skills', glyph: '❖', hint: 'Versioned reviewable prompt templates + routing', w: 1180, h: 760, render: () => <SkillsPanel /> },
  { id: 'sync', title: 'Device Sync', glyph: '⇄', hint: 'Three-way merge with a real conflict detector', w: 1120, h: 760, render: () => <SyncPanel /> },
  { id: 'remotevault', title: 'Remote Vault', glyph: '⊡', hint: 'AES-256-GCM sealed off-machine backup', w: 1120, h: 760, render: () => <RemoteVaultPanel /> },
  { id: 'extensions', title: 'Extension SDK', glyph: '⬡', hint: 'Module manifests, scoped capabilities, revocation', w: 1140, h: 760, render: () => <ExtensionsPanel /> },
  { id: 'voice', title: 'Voice Bridge', glyph: '◉', hint: 'Push-to-talk STT and spoken replies', w: 1060, h: 720, render: () => <VoicePanel /> },
  { id: 'nexus', title: 'Nexus Terminal', glyph: '⌘', hint: 'Submit tasks, inspect real execution traces', w: 1120, h: 700, render: () => <NexusTerminal /> },
  { id: 'agents', title: 'Agent Matrix', glyph: '◈', hint: 'Agents, capabilities, memory, revocation', w: 1080, h: 700, render: () => <AgentMatrix /> },
  { id: 'vault', title: 'Sovereign Vault', glyph: '▤', hint: 'Files, provenance, NeuronBrain toggle, credentials', w: 1120, h: 720, render: () => <SovereignVault /> },
  { id: 'monitor', title: 'System Monitor', glyph: '◫', hint: 'Measured metrics and honest gaps', w: 940, h: 700, render: () => <SystemMonitor /> },
  { id: 'architect', title: 'Architect Studio', glyph: '⌬', hint: 'Editor, diff review, approvals', w: 1080, h: 700, render: () => <ArchitectStudio /> },
  { id: 'workflow', title: 'Workflow Builder', glyph: '⇶', hint: 'Chained and parallel agent pipelines', w: 1000, h: 640, render: () => <WorkflowBuilder /> },
  { id: 'models', title: 'AI Model Manager', glyph: '◇', hint: 'Local runtime and cloud providers', w: 940, h: 700, render: () => <ModelManager /> },
  { id: 'security', title: 'Security Center', glyph: '⛨', hint: 'KaliOS scan, approvals, audit log', w: 1100, h: 720, render: () => <SecurityCenter /> },
  { id: 'qal', title: 'QAL Analysis', glyph: '◬', hint: 'Evidence, hypotheses, uncertainty', w: 1040, h: 700, render: () => <QalPanel /> },
  { id: 'lgai', title: 'LGAI Guide', glyph: '☲', hint: 'Runtime-aware guidance', w: 620, h: 600, render: (open) => <LgaiPanel open={open} /> },
  { id: 'registry', title: '45D Registry', glyph: '⌗', hint: 'Dimensions, status, validation', w: 1040, h: 720, render: () => <RegistryPanel /> },
  { id: 'protocol', title: "Elahy'ra Protocol", glyph: '⬢', hint: 'Modules, manifests, health checks', w: 900, h: 700, render: () => <ProtocolPanel /> },
  { id: 'tests', title: 'Test Runner', glyph: '✓', hint: 'Kernel self-tests and appliance suite', w: 900, h: 700, render: () => <TestsPanel /> },
  { id: 'release', title: 'Release Workbench', glyph: '⬓', hint: 'OVA build kit and honest build status', w: 1060, h: 720, render: () => <ReleaseWorkbench /> },
  { id: 'settings', title: 'Settings', glyph: '⚙', hint: 'Privacy, performance, voice, data', w: 1000, h: 680, render: () => <SettingsPanel /> },
];

interface Win { id: string; x: number; y: number; w: number; h: number; z: number; min: boolean; max: boolean }

export default function App() {
  return (
    <KernelCtx.Provider value={kernel}>
      <Desktop />
    </KernelCtx.Provider>
  );
}

function Desktop() {
  const s = useKernelState();
  const [wins, setWins] = useState<Win[]>([]);
  const [z, setZ] = useState(10);
  const [launcher, setLauncher] = useState(false);
  const [booted, setBooted] = useState(s.settings.onboarded);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);

  const open = useCallback((id: string) => {
    const def = APPS.find((a) => a.id === id);
    if (!def) return;
    setZ((prev) => prev + 1);
    setWins((prev) => {
      const existing = prev.find((w) => w.id === id);
      if (existing) return prev.map((w) => (w.id === id ? { ...w, min: false, z: z + 1 } : w));
      const n = prev.length;
      const vw = window.innerWidth, vh = window.innerHeight;
      return [...prev, {
        id,
        x: Math.min(Math.max(40, (vw - Math.min(def.w, vw - 80)) / 2 + (n % 5) * 26 - 50), vw - 320),
        y: Math.min(60 + (n % 5) * 22, Math.max(60, vh - 200)),
        w: Math.min(def.w, vw - 60), h: Math.min(def.h, vh - 120), z: z + 1, min: false, max: false,
      }];
    });
  }, [z]);

  const close = (id: string) => setWins((p) => p.filter((w) => w.id !== id));
  const focus = (id: string) => { setZ((p) => p + 1); setWins((p) => p.map((w) => (w.id === id ? { ...w, z: z + 1, min: false } : w))); };
  const update = (id: string, patch: Partial<Win>) => setWins((p) => p.map((w) => (w.id === id ? { ...w, ...patch } : w)));

  useEffect(() => {
    if (booted && wins.length === 0) open('control');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setLauncher((v) => !v); }
      if (e.key === 'Escape') setLauncher(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const running = s.tasks.filter((t) => t.state === 'RUNNING').length;
  const queued = s.tasks.filter((t) => t.state === 'QUEUED').length;
  const pendingApprovals = s.approvals.filter((a) => !a.resolved).length;
  const provider = s.providers.find((p) => p.id === s.activeProvider);

  return (
    <div className={cx('relative h-screen w-screen overflow-hidden bg-[#05070d] text-slate-200 antialiased', !s.settings.motion && '[&_*]:!transition-none')}>
      {/* backdrop */}
      <div className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(1000px 600px at 15% -10%, rgba(34,211,238,.10), transparent 60%), radial-gradient(900px 700px at 90% 110%, rgba(139,92,246,.12), transparent 60%)' }} />
      <div className="pointer-events-none absolute inset-0 opacity-[0.16]"
        style={{ backgroundImage: 'linear-gradient(rgba(148,163,184,.25) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,.25) 1px, transparent 1px)', backgroundSize: '56px 56px' }} />

      {/* top bar */}
      <header className="relative z-40 flex h-11 items-center gap-3 border-b border-white/10 bg-black/40 px-3 backdrop-blur">
        <button onClick={() => setLauncher(true)} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-white/5">
          <HarmMark size={20} />
          <span className="text-[12.5px] font-semibold tracking-wide text-slate-100">HarmOS</span>
          <span className="hidden text-[10.5px] text-slate-500 sm:inline">{VERSION_STRING}</span>
        </button>
        <span className="hidden rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-500 md:inline">AetherFrame · browser build</span>

        <div className="ml-auto flex items-center gap-2 text-[11px]">
          <button onClick={() => open('nexus')} className="hidden items-center gap-1.5 rounded border border-white/10 px-2 py-1 hover:border-cyan-400/40 sm:flex">
            <span className={cx('h-1.5 w-1.5 rounded-full', running ? 'animate-pulse bg-cyan-400' : 'bg-slate-600')} />
            <span className="text-slate-400">{running} running · {queued} queued</span>
          </button>
          {pendingApprovals > 0 && (
            <button onClick={() => open('security')} className="rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-amber-200">
              {pendingApprovals} approval{pendingApprovals > 1 ? 's' : ''} waiting
            </button>
          )}
          <button onClick={() => open('models')} className="hidden items-center gap-1.5 rounded border border-white/10 px-2 py-1 hover:border-cyan-400/40 md:flex">
            <span className={cx('h-1.5 w-1.5 rounded-full', provider?.reachable === 'yes' ? 'bg-emerald-400' : provider ? 'bg-amber-400' : 'bg-slate-600')} />
            <span className="text-slate-400">{provider ? `${provider.model}` : 'no model'}</span>
          </button>
          <button onClick={() => kernel.haltAll('operator pressed the status-bar stop control')}
            disabled={!running && !queued}
            className="rounded border border-rose-400/30 px-2 py-1 text-rose-300 transition hover:bg-rose-400/10 disabled:opacity-30">
            Stop all
          </button>
          <button onClick={() => setLauncher(true)} className="rounded border border-white/10 px-2 py-1 text-slate-400 hover:border-cyan-400/40">⌘K</button>
          <span className="tabular-nums text-slate-400">{new Date(now).toLocaleTimeString([], { hour12: false })}</span>
        </div>
      </header>

      {/* windows */}
      <main className="relative h-[calc(100vh-44px-56px)]">
        {wins.filter((w) => !w.min).map((w) => {
          const def = APPS.find((a) => a.id === w.id)!;
          return <Window key={w.id} win={w} def={def} onClose={() => close(w.id)} onFocus={() => focus(w.id)} onUpdate={(p) => update(w.id, p)} open={open} />;
        })}
        {wins.length === 0 && (
          <div className="pointer-events-none flex h-full items-center justify-center">
            <div className="text-center">
              <HarmMark size={64} />
              <p className="mt-3 text-[13px] text-slate-500">Press <span className="rounded border border-white/15 px-1.5 py-0.5 font-mono text-[11px] text-slate-300">Ctrl/⌘ K</span> to open the command launcher</p>
            </div>
          </div>
        )}
      </main>

      {/* dock */}
      <footer className="absolute inset-x-0 bottom-0 z-40 flex h-14 items-center gap-1 overflow-x-auto border-t border-white/10 bg-black/50 px-2 backdrop-blur">
        {APPS.map((a) => {
          const w = wins.find((x) => x.id === a.id);
          return (
            <button key={a.id} title={`${a.title} — ${a.hint}`} onClick={() => (w && !w.min ? update(a.id, { min: true }) : open(a.id))}
              className={cx('group relative flex h-10 shrink-0 items-center gap-2 rounded-lg border px-2.5 transition',
                w ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-200' : 'border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/25 hover:text-slate-200')}>
              <span className="text-[14px] leading-none">{a.glyph}</span>
              <span className="hidden text-[11.5px] font-medium xl:inline">{a.title}</span>
              {w && !w.min && <span className="absolute -bottom-px left-1/2 h-0.5 w-5 -translate-x-1/2 rounded-full bg-cyan-400" />}
            </button>
          );
        })}
      </footer>

      {launcher && <Launcher onPick={(id) => { open(id); setLauncher(false); }} onClose={() => setLauncher(false)} />}
      {!booted && <FirstBoot onDone={() => setBooted(true)} />}
    </div>
  );
}

function Window({ win, def, onClose, onFocus, onUpdate, open }: {
  win: Win; def: AppDef; onClose: () => void; onFocus: () => void; onUpdate: (p: Partial<Win>) => void; open: (id: string) => void;
}) {
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const resize = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (drag.current) onUpdate({ x: Math.max(0, e.clientX - drag.current.dx), y: Math.max(0, e.clientY - drag.current.dy) });
      if (resize.current) onUpdate({ w: Math.max(420, resize.current.w + e.clientX - resize.current.x), h: Math.max(260, resize.current.h + e.clientY - resize.current.y) });
    };
    const up = () => { drag.current = null; resize.current = null; };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [onUpdate]);

  const style = win.max
    ? { left: 8, top: 8, width: 'calc(100vw - 16px)', height: 'calc(100vh - 44px - 56px - 16px)', zIndex: win.z }
    : { left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z };

  return (
    <section onPointerDown={onFocus} style={style}
      className="absolute flex flex-col overflow-hidden rounded-xl border border-white/12 bg-[#080b14]/95 shadow-[0_24px_60px_-18px_rgba(0,0,0,0.9)] backdrop-blur-md">
      <header onPointerDown={(e) => { if ((e.target as HTMLElement).dataset.nodrag) return; drag.current = { dx: e.clientX - win.x, dy: e.clientY - win.y }; }}
        className="flex h-9 shrink-0 cursor-grab items-center gap-2 border-b border-white/10 bg-gradient-to-r from-cyan-400/5 to-violet-400/5 px-3 active:cursor-grabbing">
        <span className="text-[13px] text-cyan-300">{def.glyph}</span>
        <span className="text-[12px] font-semibold text-slate-100">{def.title}</span>
        <span className="hidden truncate text-[10.5px] text-slate-500 md:inline">— {def.hint}</span>
        <div className="ml-auto flex items-center gap-1" data-nodrag>
          <button data-nodrag onClick={() => onUpdate({ min: true })} className="h-5 w-5 rounded text-slate-500 hover:bg-white/10 hover:text-slate-200">—</button>
          <button data-nodrag onClick={() => onUpdate({ max: !win.max })} className="h-5 w-5 rounded text-slate-500 hover:bg-white/10 hover:text-slate-200">▢</button>
          <button data-nodrag onClick={onClose} className="h-5 w-5 rounded text-slate-500 hover:bg-rose-400/20 hover:text-rose-200">✕</button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4">{def.render(open)}</div>
      {!win.max && (
        <div onPointerDown={(e) => { resize.current = { x: e.clientX, y: e.clientY, w: win.w, h: win.h }; e.stopPropagation(); }}
          className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
          style={{ background: 'linear-gradient(135deg, transparent 50%, rgba(148,163,184,.35) 50%)' }} />
      )}
    </section>
  );
}

function Launcher({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  const s = useKernelState();
  const [q, setQ] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const results = useMemo(() => {
    const query = q.toLowerCase().trim();
    const apps = APPS.filter((a) => !query || a.title.toLowerCase().includes(query) || a.hint.toLowerCase().includes(query))
      .map((a) => ({ kind: 'app' as const, id: a.id, label: a.title, sub: a.hint, glyph: a.glyph }));
    const files = query ? Object.values(s.vfs).filter((v) => v.kind === 'file' && v.path.toLowerCase().includes(query)).slice(0, 6)
      .map((v) => ({ kind: 'file' as const, id: 'vault', label: v.path, sub: `${v.provenance} · ${v.content.length} bytes`, glyph: '▤' })) : [];
    const agents = query ? s.agents.filter((a) => a.name.toLowerCase().includes(query) || a.role.toLowerCase().includes(query))
      .map((a) => ({ kind: 'agent' as const, id: 'agents', label: a.name, sub: a.role, glyph: a.glyph })) : [];
    return [...apps, ...agents, ...files].slice(0, 12);
  }, [q, s]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[14vh] backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-white/15 bg-[#080b14]/97 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
          <span className="text-cyan-300">⌘</span>
          <input ref={ref} value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) onPick(results[0].id); }}
            placeholder="Search HarmOS features, agents and vault files…"
            className="flex-1 bg-transparent text-[13px] text-slate-100 outline-none placeholder:text-slate-600" />
          <Tag tone="mute">esc</Tag>
        </div>
        <div className="max-h-[52vh] overflow-auto p-1.5">
          {results.map((r, i) => (
            <button key={r.kind + r.label + i} onClick={() => onPick(r.id)}
              className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-cyan-400/10">
              <span className="w-5 text-center text-[13px] text-cyan-300">{r.glyph}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-slate-100">{r.label}</span>
                <span className="block truncate text-[11px] text-slate-500">{r.sub}</span>
              </span>
              <Tag tone={r.kind === 'app' ? 'info' : r.kind === 'agent' ? 'live' : 'mute'}>{r.kind}</Tag>
            </button>
          ))}
          {!results.length && <p className="px-3 py-6 text-center text-[12px] text-slate-500">Nothing matches “{q}”.</p>}
        </div>
      </div>
    </div>
  );
}
