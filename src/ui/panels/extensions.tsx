import { useMemo, useState } from 'react';
import { Btn, Field, KV, Panel, Tag, cx, inputCls, useKernel } from '../kit';
import {
  EXAMPLE_MODULE, HOSTILE_MANIFESTS, KNOWN_CAPABILITIES, SDK_VERSION, apiCompatible,
  grantCapabilities, validateManifest,
  type Capability, type LoadedModule, type ModuleManifest,
} from '../../harmos/sdk';

const JSON_TEMPLATE = JSON.stringify(EXAMPLE_MODULE.manifest, null, 2);

export function ExtensionsPanel() {
  const k = useKernel();
  const [raw, setRaw] = useState(JSON_TEMPLATE);
  const [modules, setModules] = useState<LoadedModule[]>([]);
  const [grants, setGrants] = useState<Record<string, ReturnType<typeof grantCapabilities>>>({});
  const [msg, setMsg] = useState('');
  const [commandLog, setCommandLog] = useState<string[]>([]);

  const parse = (): ModuleManifest | null => {
    try { return JSON.parse(raw) as ModuleManifest; }
    catch (e) { setMsg(`Manifest is not valid JSON: ${e instanceof Error ? e.message : String(e)}`); return null; }
  };

  const check = () => {
    const m = parse();
    if (!m) return;
    const r = validateManifest(m);
    setMsg(r.ok
      ? `Manifest valid. ${r.warnings.length} warning(s). API ${m.apiVersion} — ${apiCompatible(m.apiVersion).reason}.`
      : `Rejected: ${r.errors.join(' · ')}`);
  };

  const install = () => {
    const m = parse();
    if (!m) return;
    const r = validateManifest(m);
    if (!r.ok) { setMsg(`Cannot install: ${r.errors.join(' · ')}`); return; }

    const grants_ = grantCapabilities(m, {
      log: (level, message) => {
        setCommandLog((l) => [`[${m.id}] ${level}: ${message}`, ...l].slice(0, 40));
        k.log(level === 'error' ? 'critical' : level === 'warn' ? 'warn' : 'info', 'sdk', 'module.log', `${m.id}: ${message}`);
      },
      readVault: (path) => {
        const hit = Object.values(k.state.vfs).find((f) => f.path === path || path === 'index');
        k.log('info', 'sdk', 'module.read', `${m.id} → ${path}`);
        if (!hit) return '# HarmOS vault index\n\n(no files matched)';
        return path === 'index'
          ? ['# HarmOS vault index', '', ...Object.values(k.state.vfs).filter((f) => f.kind === 'file').map((f) => `- ${f.path} (${(f.content || '').length} B)`)].join('\n')
          : hit.content || '';
      },
      writeVault: (path, content) => {
        k.write(m.id, path, content, 'model');
        k.log('warn', 'sdk', 'module.write', `${m.id} wrote ${path} (${content.length} B)`);
      },
      notify: (message) => { setMsg(`[${m.name}] ${message}`); k.log('info', 'sdk', 'module.notify', `${m.id}: ${message}`); },
      registerCommand: (label, run) => {
        setCommandLog((l) => [`[${m.id}] registered command: ${label}`, ...l].slice(0, 40));
        void run;
      },
      fetch: async () => { throw new Error('network:fetch is not granted to example modules in this build'); },
    });

    const entry: LoadedModule = { manifest: m, state: 'active', registeredAt: Date.now(), calls: 0, events: [] };
    setModules((prev) => [...prev.filter((x) => x.manifest.id !== m.id), entry]);
    setGrants((g) => ({ ...g, [m.id]: grants_ }));
    // Run the module's setup against its scoped API.
    try {
      void EXAMPLE_MODULE.setup(grants_.api);
    } catch (e) {
      setModules((prev) => prev.map((x) => x.manifest.id === m.id ? { ...x, state: 'error', error: String(e) } : x));
    }
    setMsg(`Installed ${m.name} v${m.version} with capabilities [${m.capabilities.join(', ')}].`);
    k.log('info', 'sdk', 'module.install', `${m.id} v${m.version} caps=${m.capabilities.length}`);
  };

  const revoke = (id: string) => {
    grants[id]?.revoke();
    setModules((prev) => prev.map((m) => m.manifest.id === id ? { ...m, state: 'revoked' } : m));
    k.log('warn', 'sdk', 'module.revoke', `${id}: capabilities cleared; further calls throw`);
    setMsg(`${id} revoked. Any further capability call it makes will now throw instead of silently succeeding.`);
  };

  const hostile = useMemo(() => HOSTILE_MANIFESTS.map((m) => ({ manifest: m, result: validateManifest(m) })), []);
  const runnable = modules.filter((m) => m.state === 'active');

  const runCommand = (id: string) => {
    const g = grants[id];
    if (!g) return;
    try {
      // Re-invoke the module's setup against the (possibly revoked) API.
      void EXAMPLE_MODULE.setup(g.api);
      setMsg(`${id} executed. If it was revoked, the call threw rather than writing.`);
    } catch (e) {
      setMsg(`${id} was blocked: ${e instanceof Error ? e.message : String(e)}`);
      k.log('warn', 'sdk', 'module.blocked', `${id} attempted a revoked capability`);
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[12.5px] font-semibold text-cyan-100">Extension SDK</p>
          <Tag tone="info">host API v{SDK_VERSION}</Tag>
          <Tag tone="mute">{KNOWN_CAPABILITIES.length} capabilities</Tag>
        </div>
        <p className="mt-1 text-[11px] text-slate-400">
          A module is a versioned manifest plus a factory. The host validates it, checks API compatibility, and hands back a
          scoped capability object. Revocation is checked on <em>every</em> call, so a revoked module cannot keep writing after
          you revoke it.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          <Panel title="Module manifest" right={<div className="flex gap-2"><Btn onClick={check}>Validate</Btn><Btn tone="primary" onClick={install}>Install</Btn><Btn onClick={() => setRaw(JSON_TEMPLATE)}>Reset example</Btn></div>}>
            <Field label="manifest.json" hint="Edit and validate. The example registers a command and writes one report.">
              <textarea className={cx(inputCls, 'h-72 font-mono text-[11px]')} value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={false} />
            </Field>
            {msg && <p className="mt-1.5 rounded-lg border border-white/10 bg-black/40 p-2 text-[11.5px] text-slate-200">{msg}</p>}
          </Panel>

          <Panel title="Installed modules" subtitle={`${modules.length} installed · ${runnable.length} active`}>
            {modules.length === 0 && <p className="text-[12px] text-slate-500">Nothing installed. Validate the example manifest, then install it.</p>}
            <div className="space-y-2">
              {modules.map((m) => (
                <div key={m.manifest.id} className="rounded-lg border border-white/10 bg-black/25 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] text-slate-100">{m.manifest.name}</span>
                    <code className="font-mono text-[10px] text-slate-500">v{m.manifest.version}</code>
                    <Tag tone={m.state === 'active' ? 'ok' : m.state === 'revoked' ? 'bad' : 'warn'}>{m.state}</Tag>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">{m.manifest.description}</p>
                  <p className="mt-1 text-[10.5px] text-slate-400">capabilities: {m.manifest.capabilities.join(', ')}</p>
                  {m.manifest.permissionsJustification && <p className="mt-1 text-[10.5px] text-slate-500">justification: {m.manifest.permissionsJustification}</p>}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Btn onClick={() => runCommand(m.manifest.id)}>Invoke</Btn>
                    <Btn tone="danger" onClick={() => revoke(m.manifest.id)} disabled={m.state === 'revoked'}>Revoke capabilities</Btn>
                  </div>
                </div>
              ))}
            </div>
            {commandLog.length > 0 && (
              <div className="mt-2 max-h-32 overflow-auto rounded border border-white/10 bg-black/40 p-2 font-mono text-[10px] text-slate-400">
                {commandLog.map((l, i) => <div key={i}>{l}</div>)}
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-2">
          <Panel title="Capability catalogue">
            {KNOWN_CAPABILITIES.map((c: Capability) => (
              <div key={c} className="border-b border-white/5 py-1 last:border-0">
                <code className="font-mono text-[10.5px] text-cyan-300">{c}</code>
              </div>
            ))}
          </Panel>
          <Panel title="Rejection suite" subtitle="Five deliberately malformed manifests. All five must be refused — that is the gate working.">
            {hostile.map(({ manifest, result }) => (
              <div key={manifest.id} className="border-b border-white/5 py-1.5 last:border-0">
                <div className="flex items-center gap-2">
                  <Tag tone={result.ok ? 'bad' : 'ok'}>{result.ok ? 'ACCEPTED (bad)' : 'refused'}</Tag>
                  <code className="font-mono text-[10.5px] text-slate-400">{manifest.id}</code>
                </div>
                <p className="text-[10px] text-slate-500">{result.errors[0] || 'no errors'}</p>
              </div>
            ))}
            <p className="mt-2 text-[10.5px] text-slate-500">
              {hostile.filter((h) => !h.result.ok).length}/{hostile.length} correctly refused.
            </p>
          </Panel>
          <Panel title="SDK contract">
            <KV k="API version" v={SDK_VERSION} />
            <KV k="Manifest check" v="semver, capabilities, apiVersion" />
            <KV k="Revocation" v="per-call guard" />
            <KV k="Audit" v="every call logged" />
            <p className="mt-2 text-[10.5px] text-slate-500">Compatible means same major, minor ≤ host. A module built for API 9.0.0 is refused rather than half-working.</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
