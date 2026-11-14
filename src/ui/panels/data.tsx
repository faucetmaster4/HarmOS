import { useEffect, useMemo, useState } from 'react';
import { Panel, Tag, Btn, Empty, Field, inputCls, useKernel, useKernelState, fmtBytes, ago, cx, Impl, KV } from '../kit';
import { ProtocolRegistry, builtinModules, validateManifest, PROTOCOL_API_VERSION, type LoadedModule } from '../../harmos/protocol';
import type { Kernel } from '../../harmos/kernel';
import { NeuronBrainPanel } from './neuronbrain';

/* ----------------------------------------------------------- Sovereign Vault */

export function SovereignVault() {
  const k = useKernel();
  const s = useKernelState();
  const [view, setView] = useState<'tree' | 'neuron'>('tree');
  const [sel, setSel] = useState<string>('/home/harmos/HarmOS/README.md');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<string | null>(null);
  const node = s.vfs[sel];
  const files = Object.values(s.vfs).sort((a, b) => a.path.localeCompare(b.path));
  const hits = query.trim() ? k.search('knowledge-node', query) : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2">
        <span className="text-[11.5px] text-slate-400">
          Sovereign Vault · <strong className="text-slate-200">{files.filter((f) => f.kind === 'file').length}</strong> files · <strong className="text-slate-200">{s.memory.length}</strong> memory engrams
        </span>
        <div className="flex rounded-lg border border-white/10 bg-black/50 p-0.5 text-[11.5px]">
          <button
            onClick={() => setView('tree')}
            className={cx('rounded-md px-2.5 py-1 font-medium transition', view === 'tree' ? 'bg-cyan-400/20 text-cyan-200' : 'text-slate-400 hover:text-slate-200')}
          >
            ▤ Vault Tree &amp; Editor
          </button>
          <button
            onClick={() => setView('neuron')}
            className={cx('rounded-md px-2.5 py-1 font-medium transition', view === 'neuron' ? 'bg-violet-400/25 text-violet-200' : 'text-slate-400 hover:text-slate-200')}
          >
            ◎ NeuronBrain 3D Cortex
          </button>
        </div>
      </div>

      {view === 'neuron' ? (
        <NeuronBrainPanel compact />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <div className="space-y-4">
        <Panel title="Vault tree" subtitle={`${files.filter((f) => f.kind === 'file').length} files · ${fmtBytes(k.vfsBytes())}`}>
          <input className={cx(inputCls, 'mb-2')} placeholder="search vault contents…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query.trim() ? (
            <div className="max-h-[48vh] space-y-1 overflow-auto">
              {hits.map((h, i) => (
                <button key={i} onClick={() => { setSel(h.path); setDraft(null); }} className="block w-full rounded border border-white/10 bg-black/20 px-2 py-1 text-left hover:border-cyan-400/40">
                  <span className="block font-mono text-[10.5px] text-cyan-300">{h.path}:{h.line}</span>
                  <span className="block truncate text-[11px] text-slate-400">{h.text}</span>
                </button>
              ))}
              {!hits.length && <Empty>No matches within Knowledge Node's authorised roots.</Empty>}
            </div>
          ) : (
            <div className="max-h-[48vh] space-y-0.5 overflow-auto font-mono text-[11.5px]">
              {files.map((f) => (
                <button key={f.path} onClick={() => { setSel(f.path); setDraft(null); }}
                  className={cx('block w-full truncate rounded px-1.5 py-1 text-left transition',
                    sel === f.path ? 'bg-cyan-400/15 text-cyan-200' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200')}
                  style={{ paddingLeft: `${(f.path.split('/').length - 1) * 8}px` }}>
                  {f.kind === 'dir' ? '▸ ' : '  '}{f.path.split('/').pop()}
                </button>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Provenance legend">
          {[['verified', 'ok', 'produced by HarmOS or confirmed by you'],
          ['user', 'info', 'you authored it'],
          ['model', 'warn', 'language-model output — treat as a draft'],
          ['inferred', 'mute', 'derived by analysis, not observed']].map(([l, t, d]) => (
            <div key={l} className="flex items-start gap-2 py-1"><Tag tone={t}>{l}</Tag><span className="text-[11px] text-slate-400">{d}</span></div>
          ))}
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel title={node ? node.path : 'No selection'}
          subtitle={node ? `${node.kind} · author ${node.author} · updated ${ago(node.updatedAt)} · ${node.sha}` : undefined}
          right={node?.kind === 'file' && (
            <div className="flex gap-2">
              {draft === null
                ? <Btn onClick={() => setDraft(node.content)}>Edit</Btn>
                : <>
                  <Btn tone="primary" onClick={() => { k.write('architect-core', node.path, draft, 'user'); setDraft(null); }}>Save as user content</Btn>
                  <Btn onClick={() => setDraft(null)}>Cancel</Btn>
                </>}
              <Btn tone="danger" onClick={() => { k.remove('architect-core', node.path); setSel('/home/harmos/HarmOS/README.md'); }}>Delete</Btn>
            </div>
          )}>
          {node?.kind === 'file' ? (
            draft === null
              ? <pre className="max-h-[52vh] overflow-auto whitespace-pre-wrap text-[11.5px] leading-relaxed text-slate-300">{node.content}</pre>
              : <textarea className={cx(inputCls, 'h-[52vh] font-mono')} value={draft} onChange={(e) => setDraft(e.target.value)} />
          ) : <Empty>Select a file.</Empty>}
          {node && <div className="mt-2 flex items-center gap-2"><Tag tone={node.provenance === 'verified' ? 'ok' : node.provenance === 'model' ? 'warn' : 'info'}>{node.provenance}</Tag>
            <span className="text-[11px] text-slate-500">Saving from this editor relabels the file as user-authored.</span></div>}
        </Panel>

        <Panel title="Encrypted notes & credentials" right={<Impl status="partial" />}
          subtitle="Credentials are held in a kernel-private map that is never persisted, never exported and never logged.">
          <KV k="Credentials in volatile memory" v={k.secretCount()} />
          <KV k="Persisted credential material" v={<Tag tone="ok">none</Tag>} />
          <p className="mt-2 text-[11.5px] leading-relaxed text-slate-400">
            At-rest encryption of vault notes is <strong className="text-slate-200">not implemented in this build</strong>. On the appliance the
            design is: vault data under <code className="font-mono text-[11px]">/var/lib/harmos/vault</code> (0700, owned by <code className="font-mono text-[11px]">harmos-svc</code>),
            a data key wrapped by a passphrase-derived key (argon2id) held in the kernel keyring, and provider credentials in the
            Secret Service keyring rather than a dotfile. Nothing here claims to be encrypted when it is not.
          </p>
        </Panel>
      </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- Architect Studio */

export function ArchitectStudio() {
  const k = useKernel();
  const s = useKernelState();
  const [path, setPath] = useState('/home/harmos/HarmOS/workspace/example.ts');
  const [proposal, setProposal] = useState('');
  const [prompt, setPrompt] = useState('Add an exported function that returns the HarmOS version string');
  const current = s.vfs[path]?.content ?? '';
  const diff = useMemo(() => makeDiff(current, proposal), [current, proposal]);

  return (
    <div className="space-y-4">
      <Panel title="Architect Mode" subtitle="Agent-assisted editing with mandatory diff review. Nothing is written until you approve the diff."
        right={<Impl status="partial" />}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[260px]"><Field label="Target file"><input className={inputCls} value={path} onChange={(e) => setPath(e.target.value)} /></Field></div>
          <div className="flex-1 min-w-[260px]"><Field label="Change request"><input className={inputCls} value={prompt} onChange={(e) => setPrompt(e.target.value)} /></Field></div>
          <Btn onClick={() => setProposal(current ? `${current}\n\n// proposed: ${prompt}\nexport const harmosVersion = () => '0.1.0-alpha';\n` : `// ${path}\n// proposed by Architect Core: ${prompt}\nexport const harmosVersion = () => '0.1.0-alpha';\n`)}>
            Draft change
          </Btn>
          <Btn tone="primary" disabled={!proposal} onClick={() => { k.write('architect-core', path, proposal, 'model'); setProposal(''); }}>Approve &amp; apply</Btn>
          <Btn disabled={!proposal} onClick={() => setProposal('')}>Discard</Btn>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          The draft above is produced locally by the editor, not by a model. Model-authored patches require a reachable provider —
          submit the request through the Nexus Terminal and the trace will show the real model call.
        </p>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Current" subtitle={s.vfs[path] ? `${current.length} bytes · ${s.vfs[path].provenance}` : 'file does not exist yet'}>
          <pre className="max-h-[42vh] overflow-auto whitespace-pre-wrap text-[11.5px] text-slate-300">{current || '(empty)'}</pre>
        </Panel>
        <Panel title="Proposed diff" subtitle="Reversible: the previous content stays in the vault history until overwritten.">
          {proposal ? (
            <pre className="max-h-[42vh] overflow-auto text-[11.5px] leading-relaxed">
              {diff.map((l, i) => (
                <div key={i} className={cx(l.kind === 'add' ? 'bg-emerald-400/10 text-emerald-200' : l.kind === 'del' ? 'bg-rose-400/10 text-rose-200' : 'text-slate-500')}>
                  {l.kind === 'add' ? '+ ' : l.kind === 'del' ? '- ' : '  '}{l.text}
                </div>
              ))}
            </pre>
          ) : <Empty>No pending proposal.</Empty>}
        </Panel>
      </div>

      <Panel title="Sandbox execution, git integration, test runner" right={<Impl status="unavailable" />}
        subtitle="These need a process layer. They exist in the appliance design and are exercised by tests/smoke-appliance.sh §6, not here.">
        <div className="grid gap-2 sm:grid-cols-3">
          {[['Workspace shell', 'shell.exec as harmos-svc, cwd pinned to the agent workspace'],
          ['Git status / branch / diff', 'git plumbing inside the workspace only'],
          ['Test runner', 'npm test streamed into the task trace']].map(([t, d]) => (
            <div key={t} className="rounded-lg border border-dashed border-white/15 bg-black/20 p-3">
              <p className="text-[12px] text-slate-200">{t}</p>
              <p className="mt-1 text-[11px] text-slate-500">{d}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function makeDiff(a: string, b: string) {
  const A = a.split('\n'); const B = b.split('\n');
  const out: Array<{ kind: 'same' | 'add' | 'del'; text: string }> = [];
  let i = 0, j = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) { out.push({ kind: 'same', text: A[i] }); i++; j++; }
    else if (j < B.length && !A.includes(B[j])) { out.push({ kind: 'add', text: B[j] }); j++; }
    else if (i < A.length && !B.includes(A[i])) { out.push({ kind: 'del', text: A[i] }); i++; }
    else if (i < A.length) { out.push({ kind: 'same', text: A[i] }); i++; j++; }
    else { out.push({ kind: 'add', text: B[j] }); j++; }
  }
  return out;
}

/* ----------------------------------------------------------- Elahy'ra Protocol */

let registrySingleton: ProtocolRegistry | null = null;
function getRegistry(k: Kernel) {
  if (!registrySingleton) {
    registrySingleton = new ProtocolRegistry(k);
    for (const m of builtinModules()) registrySingleton.register(m);
    for (const m of registrySingleton.list()) void registrySingleton.start(m.manifest.id);
  }
  return registrySingleton;
}

export function ProtocolPanel() {
  const k = useKernel();
  const reg = getRegistry(k);
  const [, bump] = useState(0);
  const [raw, setRaw] = useState(`{
  "id": "my-module",
  "name": "My Module",
  "version": "1.0.0",
  "api": "1.0",
  "description": "Example third-party HarmOS module",
  "author": "you",
  "permissions": ["fs.read"]
}`);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [health, setHealth] = useState<Array<{ id: string; ok: boolean; note: string }>>([]);
  useEffect(() => { setHealth(reg.healthCheck()); }, [reg]);

  const tryRegister = () => {
    try {
      const manifest = JSON.parse(raw);
      const errs = validateManifest(manifest);
      if (errs.length) { setErrors(errs); return; }
      const res = reg.register({ manifest, check: () => ({ ok: true, note: 'registered at runtime via the SDK path' }) });
      setErrors(res.ok ? [] : res.errors);
      if (res.ok) { void reg.start(manifest.id).then(() => { setHealth(reg.healthCheck()); bump((n) => n + 1); }); }
    } catch (e) { setErrors(['manifest is not valid JSON: ' + (e instanceof Error ? e.message : String(e))]); }
  };

  return (
    <div className="space-y-4">
      <Panel title="Elahy'ra Protocol" subtitle={`Versioned module interface · host API ${PROTOCOL_API_VERSION}. An ordinary, inspectable plugin contract — a module cannot request authority HarmOS does not define.`}
        right={<Btn onClick={() => { setHealth(reg.healthCheck()); bump((n) => n + 1); }}>Run health checks</Btn>}>
        <div className="space-y-2">
          {reg.list().map((m: LoadedModule) => {
            const h = health.find((x) => x.id === m.manifest.id);
            return (
              <div key={m.manifest.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] font-semibold text-slate-100">{m.manifest.name}</span>
                  <span className="font-mono text-[10.5px] text-slate-500">{m.manifest.id}@{m.manifest.version}</span>
                  <Tag tone={m.state === 'started' ? 'ok' : m.state === 'error' ? 'bad' : 'mute'}>{m.state}</Tag>
                  {h && <Tag tone={h.ok ? 'ok' : 'warn'}>{h.ok ? 'healthy' : 'check failed'}</Tag>}
                  <div className="ml-auto flex gap-2">
                    {m.state === 'started'
                      ? <Btn onClick={() => { void reg.stop(m.manifest.id).then(() => bump((n) => n + 1)); }}>Stop</Btn>
                      : <Btn tone="primary" onClick={() => { void reg.start(m.manifest.id).then(() => bump((n) => n + 1)); }}>Start</Btn>}
                  </div>
                </div>
                <p className="mt-1 text-[11.5px] text-slate-400">{m.manifest.description}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {m.manifest.permissions.map((p) => <span key={p} className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">{p}</span>)}
                  {m.manifest.dependsOn?.map((d) => <span key={d} className="rounded bg-violet-400/10 px-1.5 py-0.5 font-mono text-[10px] text-violet-300">needs {d}</span>)}
                </div>
                {h && <p className="mt-1 text-[11px] text-slate-500">{h.note}</p>}
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="Register a module (SDK path)" subtitle="This is the same validation a third-party module goes through. Try breaking it."
        right={<Btn tone="primary" onClick={tryRegister}>Validate &amp; register</Btn>}>
        <textarea className={cx(inputCls, 'h-48 font-mono')} value={raw} onChange={(e) => setRaw(e.target.value)} />
        {errors !== null && (errors.length
          ? <div className="mt-2 space-y-1">{errors.map((e, i) => <p key={i} className="text-[11.5px] text-rose-300">✕ {e}</p>)}</div>
          : <p className="mt-2 text-[11.5px] text-emerald-300">✓ manifest valid — module registered and started</p>)}
      </Panel>
    </div>
  );
}
