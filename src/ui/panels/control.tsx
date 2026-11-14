import { useEffect, useMemo, useState } from 'react';
import { Panel, Tag, Impl, Btn, KV, Meter, Empty, useKernel, useKernelState, fmtBytes, ago, cx } from '../kit';
import { DIMENSIONS, registryStats, validateRegistry } from '../../harmos/registry45d';
import { lgaiGuidance } from '../../harmos/runtime';
import { VERSION_STRING } from '../../harmos/kernel';
import { OVA_MANIFEST } from '../../harmos/installerAssets';

/* ----------------------------------------------------------- Control Center */

export function ControlCenter({ open }: { open: (id: string) => void }) {
  const k = useKernel();
  const s = useKernelState();
  const stats = registryStats();
  const issues = validateRegistry();
  const provider = k.activeProvider();
  const running = s.tasks.filter((t) => t.state === 'RUNNING').length;

  const modules = [
    { id: 'neuronbrain', name: 'NeuronBrain Vault', desc: '3D synaptic cortex visualizer for Vault files, memories & agents', status: 'implemented' as const, open: 'neuronbrain' },
    { id: 'itsecurity', name: 'IT Security (Anti-Hacking)', desc: 'Payload IDS, SHA-256 FIM, secret sweep, UFW/Fail2Ban/sysctl builder', status: 'implemented' as const, open: 'itsecurity' },
    { id: 'guide', name: 'Install Walkthrough', desc: 'Step-by-step dummy guide: Windows, macOS, Ubuntu, Kali Linux', status: 'implemented' as const, open: 'guide' },
    { id: 'trading', name: 'Paper Trading Desk', desc: 'Crypto, stocks, FX, gold — simulated fills, six strategy modes', status: 'implemented' as const, open: 'trading' },
    { id: 'tradelab', name: 'Trade Lab (Connect + Backtest)', desc: 'Signed venue connectivity, walk-forward backtests, risk, tax lots, alerts', status: 'implemented' as const, open: 'tradelab' },
    { id: 'automation', name: 'Automation Engine', desc: 'Real cron evaluation, jitter, retries, auto-disable, run ledger', status: 'implemented' as const, open: 'automation' },
    { id: 'skills', name: 'Agent Skills', desc: 'Versioned reviewable prompt templates with capability routing', status: 'implemented' as const, open: 'skills' },
    { id: 'sync', name: 'Device Sync', desc: 'Three-way merge, conflict detection, SigV4 signing', status: 'implemented' as const, open: 'sync' },
    { id: 'remotevault', name: 'Remote Vault', desc: 'AES-256-GCM sealed portable backup with round-trip proof', status: 'implemented' as const, open: 'remotevault' },
    { id: 'extensions', name: 'Extension SDK', desc: 'Manifest validation, scoped capabilities, per-call revocation', status: 'implemented' as const, open: 'extensions' },
    { id: 'voice', name: 'Voice Bridge', desc: 'Push-to-talk recognition and spoken replies, honest detection', status: 'implemented' as const, open: 'voice' },
    { id: 'commerce', name: 'Store & Dropshipping', desc: 'Draft storefront, SKU map, pricing, fulfillment SOP', status: 'implemented' as const, open: 'commerce' },
    { id: 'installer', name: 'Auto / Manual Installer', desc: 'Native Windows .EXE + Bash installer + HarmOS-0.1.0-x86_64.ova', status: 'implemented' as const, open: 'installer' },
    { id: 'nexus', name: 'HarmOS Nexus', desc: 'Agent orchestration, task lifecycle, tool routing', status: 'implemented' as const, open: 'nexus' },
    { id: 'esai', name: 'ESAI & KaliOS', desc: 'Capability gate, approvals, revocation, audit log & redaction', status: 'implemented' as const, open: 'security' },
    { id: 'vault', name: 'Sovereign Vault', desc: 'Persistent files, memory, provenance, credentials', status: 'implemented' as const, open: 'vault' },
    { id: 'qal', name: 'QAL', desc: 'Structured analysis, hypotheses, contradiction detection', status: 'implemented' as const, open: 'qal' },
    { id: 'lgai', name: 'LGAI', desc: 'Runtime-aware guidance and risk explanation', status: 'implemented' as const, open: 'lgai' },
    { id: 'architect', name: 'Architect Core', desc: 'Editor, diff review, project workspace', status: 'partial' as const, open: 'architect' },
    { id: 'elahyra', name: "Elahy'ra Protocol", desc: 'Module manifests, lifecycle, health checks', status: 'implemented' as const, open: 'protocol' },
    { id: 'registry', name: '45D Registry', desc: '45 addressable dimensions with validation', status: 'implemented' as const, open: 'registry' },
    { id: 'release', name: 'OVA Release Appliance', desc: OVA_MANIFEST.built ? `HarmOS-0.1.0-x86_64.ova built (${fmtBytes(OVA_MANIFEST.sizeBytes)})` : 'OVA build & QEMU verification suite', status: (OVA_MANIFEST.built ? 'implemented' : 'partial') as 'implemented' | 'partial', open: 'release' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Runtime" subtitle={`HarmOS ${VERSION_STRING} · browser build`}>
          <KV k="Kernel" v={<Tag tone="ok">online</Tag>} />
          <KV k="Uptime" v={ago(s.bootedAt).replace(' ago', '')} />
          <KV k="Tasks running" v={`${running} · queue ${k.queueDepth()}`} />
          <KV k="Agents" v={`${s.agents.filter((a) => a.enabled && !a.revoked).length} active / ${s.agents.length}`} />
          <KV k="Vault" v={`${Object.values(s.vfs).filter((v) => v.kind === 'file').length} files · ${fmtBytes(k.vfsBytes())}`} />
        </Panel>

        <Panel title="AI readiness" subtitle="Probed, never assumed"
          right={<Btn onClick={() => open('models')}>Manage</Btn>}>
          {provider ? (
            <>
              <KV k="Provider" v={provider.label} />
              <KV k="Model" v={<span className="font-mono text-[11px]">{provider.model}</span>} />
              <KV k="Reachable" v={<Tag tone={provider.reachable === 'yes' ? 'ok' : provider.reachable === 'no' ? 'bad' : 'warn'}>{provider.reachable}</Tag>} />
              <KV k="Credential" v={provider.hasKey ? 'stored (volatile)' : provider.kind === 'ollama' ? 'not required' : 'none'} />
            </>
          ) : (
            <Empty>No model provider configured. Deterministic tools still work — generative replies do not.</Empty>
          )}
          <p className="mt-3 text-[11px] text-slate-500">Processing policy: <span className="text-slate-300">{s.settings.processing}</span></p>
        </Panel>

        <Panel title="Integrity" subtitle="45D registry self-validation">
          <KV k="Dimensions" v={`${stats.total} registered`} />
          <KV k="Implemented" v={<span className="text-emerald-300">{stats.implemented}</span>} />
          <KV k="Partial" v={<span className="text-amber-300">{stats.partial}</span>} />
          <KV k="Script only" v={<span className="text-violet-300">{stats.scriptOnly}</span>} />
          <KV k="Proposed" v={<span className="text-slate-400">{stats.proposed}</span>} />
          <KV k="Validation" v={issues.filter((i) => i.level === 'error').length === 0
            ? <Tag tone="ok">0 errors</Tag>
            : <Tag tone="bad">{issues.filter((i) => i.level === 'error').length} errors</Tag>} />
        </Panel>
      </div>

      <Panel title="Core modules" subtitle="Status is derived from what this build can actually execute — not from the roadmap.">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {modules.map((m) => (
            <button key={m.id} onClick={() => open(m.open)}
              className="group rounded-lg border border-white/10 bg-black/20 p-3 text-left transition hover:border-cyan-400/40 hover:bg-cyan-400/5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] font-semibold text-slate-100">{m.name}</span>
                <Impl status={m.status} />
              </div>
              <p className="mt-1 text-[11px] leading-snug text-slate-400">{m.desc}</p>
            </button>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Recent activity" subtitle="Kernel audit log (most recent first)" right={<Btn onClick={() => open('security')}>Full log</Btn>}>
          <div className="space-y-1.5">
            {s.audit.slice(0, 8).map((e) => (
              <div key={e.id} className="flex items-start gap-2 text-[11.5px]">
                <span className={cx('mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                  e.severity === 'critical' ? 'bg-rose-400' : e.severity === 'deny' ? 'bg-rose-300' : e.severity === 'warn' ? 'bg-amber-400' : 'bg-cyan-400')} />
                <span className="w-14 shrink-0 font-mono text-[10px] text-slate-500">{new Date(e.at).toLocaleTimeString([], { hour12: false })}</span>
                <span className="w-24 shrink-0 truncate text-slate-400">{e.actor}</span>
                <span className="flex-1 text-slate-300"><span className="text-slate-500">{e.action}</span> {e.detail}</span>
              </div>
            ))}
            {!s.audit.length && <Empty>No events recorded yet.</Empty>}
          </div>
        </Panel>
        <LgaiPanel open={open} />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- LGAI */

export function LgaiPanel({ open }: { open: (id: string) => void }) {
  const k = useKernel();
  useKernelState();
  const cards = lgaiGuidance(k);
  const tone = { observed: 'live', suggestion: 'info', risk: 'warn' } as const;
  return (
    <Panel title="LGAI guidance" subtitle="Observations are measured. Suggestions are advice. Risks are consequences.">
      <div className="space-y-2">
        {cards.map((c, i) => (
          <div key={i} className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="flex items-center gap-2">
              <Tag tone={tone[c.kind]}>{c.kind}</Tag>
              <span className="text-[12.5px] font-medium text-slate-100">{c.title}</span>
            </div>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-slate-400">{c.body}</p>
            {c.action?.startsWith('open:') && (
              <Btn className="mt-2" onClick={() => open(c.action!.split(':')[1])}>Open</Btn>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ----------------------------------------------------------- System Monitor */

interface Sample { t: number; lag: number; heap: number | null; fps: number }

export function SystemMonitor() {
  const k = useKernel();
  const s = useKernelState();
  const [samples, setSamples] = useState<Sample[]>([]);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);

  useEffect(() => {
    let frames = 0; let raf = 0; let last = performance.now();
    const loop = () => { frames++; raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    const iv = window.setInterval(() => {
      const now = performance.now();
      const fps = Math.round((frames * 1000) / (now - last));
      frames = 0; last = now;
      const perf = performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } };
      setSamples((prev) => [...prev.slice(-59), { t: Date.now(), lag: k.lagMs, heap: perf.memory ? perf.memory.usedJSHeapSize : null, fps }]);
    }, 1000);
    navigator.storage?.estimate?.().then((e) => setStorage({ usage: e.usage || 0, quota: e.quota || 0 })).catch(() => void 0);
    return () => { cancelAnimationFrame(raf); clearInterval(iv); };
  }, [k]);

  const latest = samples[samples.length - 1];
  const perf = performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } };
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { effectiveType?: string; downlink?: number } };

  return (
    <div className="space-y-4">
      <Panel title="Measured metrics" subtitle="Only values this runtime can actually observe. Everything else is marked unavailable.">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2.5">
            <KV k="Logical CPUs (reported)" v={navigator.hardwareConcurrency ?? 'unavailable'} />
            <KV k="Device memory hint" v={nav.deviceMemory ? `${nav.deviceMemory} GB (coarse)` : 'unavailable in this browser'} />
            <KV k="JS heap in use" v={perf.memory ? fmtBytes(perf.memory.usedJSHeapSize) : 'unavailable (non-Chromium)'} />
            <KV k="Heap limit" v={perf.memory ? fmtBytes(perf.memory.jsHeapSizeLimit) : 'unavailable'} />
            <KV k="Event-loop drift" v={`${k.lagMs} ms`} />
            <KV k="Render rate" v={latest ? `${latest.fps} fps` : 'sampling…'} />
          </div>
          <div className="space-y-2.5">
            <KV k="Persistent storage used" v={storage ? `${fmtBytes(storage.usage)} of ${fmtBytes(storage.quota)}` : 'querying…'} />
            <KV k="Vault payload" v={fmtBytes(k.vfsBytes())} />
            <KV k="Network type" v={nav.connection?.effectiveType ? `${nav.connection.effectiveType} · ~${nav.connection.downlink} Mb/s` : 'unavailable'} />
            <KV k="Online flag" v={<Tag tone={navigator.onLine ? 'ok' : 'warn'}>{navigator.onLine ? 'online' : 'offline'}</Tag>} />
            <KV k="Tasks running / queued" v={`${k.runningCount()} / ${k.queueDepth()}`} />
            <KV k="Audit events" v={s.audit.length} />
          </div>
        </div>
        {perf.memory && <div className="mt-4"><Meter label="JS heap pressure" value={perf.memory.usedJSHeapSize} max={perf.memory.jsHeapSizeLimit} /></div>}
        {storage && <div className="mt-3"><Meter tone="violet" label="Storage quota" value={storage.usage} max={storage.quota || 1} /></div>}
      </Panel>

      <Panel title="Live sampling (60 s)" subtitle="Event-loop drift in milliseconds, sampled once per second.">
        <Spark data={samples.map((x) => x.lag)} suffix="ms" />
        <p className="mt-2 text-[11px] text-slate-500">Sustained drift above ~120 ms means the interface thread is saturated. Low-resource mode clamps concurrency to one agent and disables motion.</p>
      </Panel>

      <Panel title="Not observable from this build" subtitle="These require the Linux guest and are read by the appliance, not invented here.">
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            ['Guest CPU load per core', '/proc/stat via the Nexus sidecar'],
            ['Guest RAM and swap', '/proc/meminfo'],
            ['Disk free on /', 'statvfs / df'],
            ['Network sockets and listeners', 'ss -ltnp'],
            ['systemd unit health', 'systemctl list-units --state=failed'],
            ['Model runtime memory', 'ollama ps'],
          ].map(([what, how]) => (
            <div key={what} className="rounded-lg border border-white/10 bg-black/20 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-slate-200">{what}</span>
                <Impl status="unavailable" />
              </div>
              <p className="mt-1 font-mono text-[10.5px] text-slate-500">{how}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function Spark({ data, suffix }: { data: number[]; suffix: string }) {
  const max = Math.max(10, ...data);
  const pts = useMemo(() => data.map((v, i) => `${(i / Math.max(1, data.length - 1)) * 100},${40 - (v / max) * 38}`).join(' '), [data, max]);
  return (
    <div className="relative h-24 w-full overflow-hidden rounded-lg border border-white/10 bg-black/30">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-full w-full">
        <polyline points={pts} fill="none" stroke="rgb(34 211 238)" strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="absolute right-2 top-1.5 font-mono text-[10px] text-slate-500">peak {max.toFixed(0)}{suffix}</span>
    </div>
  );
}

/* ----------------------------------------------------------- 45D Registry */

export function RegistryPanel() {
  const [filter, setFilter] = useState<'all' | 'implemented' | 'partial' | 'script-only' | 'proposed'>('all');
  const issues = validateRegistry();
  const rows = DIMENSIONS.filter((d) => filter === 'all' || d.status === filter);
  const stats = registryStats();

  return (
    <div className="space-y-4">
      <Panel title="HarmOS 45D Integration Registry"
        subtitle="Forty-five addressable software dimensions. These are architectural responsibilities, not physical dimensions, and no claim of verified physics is made.">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {(['all', 'implemented', 'partial', 'script-only', 'proposed'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={cx('rounded-md border px-2 py-1 text-[11px] capitalize transition',
                filter === f ? 'border-cyan-400/50 bg-cyan-400/15 text-cyan-200' : 'border-white/10 bg-white/5 text-slate-400 hover:text-slate-200')}>
              {f} {f !== 'all' && <span className="opacity-60">{f === 'implemented' ? stats.implemented : f === 'partial' ? stats.partial : f === 'script-only' ? stats.scriptOnly : stats.proposed}</span>}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-slate-500">
            validation: {issues.filter((i) => i.level === 'error').length} errors · {issues.filter((i) => i.level === 'warn').length} warnings
          </span>
        </div>
        <div className="max-h-[52vh] space-y-1.5 overflow-auto pr-1">
          {rows.map((d) => (
            <details key={d.id} className="group rounded-lg border border-white/10 bg-black/20 open:border-cyan-400/30">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2">
                <span className="w-7 shrink-0 font-mono text-[11px] text-cyan-400/80">{String(d.id).padStart(2, '0')}</span>
                <span className="flex-1 text-[12.5px] text-slate-100">{d.name}</span>
                <span className="hidden font-mono text-[10.5px] text-slate-500 sm:inline">{d.module}</span>
                <Impl status={d.status} />
              </summary>
              <div className="space-y-1 border-t border-white/10 px-3 py-2.5 text-[11.5px]">
                <p className="text-slate-300">{d.purpose}</p>
                <div className="grid gap-x-6 gap-y-1 pt-1 sm:grid-cols-2">
                  <KV k="Inputs" v={d.inputs} />
                  <KV k="Outputs" v={d.outputs} />
                  <KV k="Depends on" v={d.dependsOn.length ? d.dependsOn.join(', ') : 'none'} />
                  <KV k="Permissions" v={d.permissions.length ? d.permissions.join(', ') : 'none required'} />
                  <KV k="Verification" v={d.verification} />
                  <KV k="Test" v={<span className="font-mono text-[10.5px]">{d.test}</span>} />
                </div>
              </div>
            </details>
          ))}
        </div>
      </Panel>

      <Panel title="Validation report" subtitle="Duplicate IDs, unregistered dependencies, cycles and unsupported status claims.">
        {issues.length === 0 ? <Empty>Registry is clean.</Empty> : (
          <div className="space-y-1">
            {issues.map((i, n) => (
              <div key={n} className="flex items-center gap-2 text-[11.5px]">
                <Tag tone={i.level === 'error' ? 'bad' : 'warn'}>{i.level}</Tag>
                <span className="font-mono text-slate-500">D{String(i.dim).padStart(2, '0')}</span>
                <span className="text-slate-300">{i.message}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
