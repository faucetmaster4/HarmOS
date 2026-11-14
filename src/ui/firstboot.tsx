import { useEffect, useState } from 'react';
import { Btn, Tag, KV, useKernel, useKernelState, cx, fmtBytes } from './kit';
import { probeOllama } from '../harmos/models';
import { uid, VERSION_STRING } from '../harmos/kernel';

const STEPS = ['Welcome', 'Resources', 'Secure storage', 'Nexus backend', 'AI model', 'Privacy', 'First agent'] as const;

export function FirstBoot({ onDone }: { onDone: () => void }) {
  const k = useKernel();
  const s = useKernelState();
  const [step, setStep] = useState(0);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [local, setLocal] = useState<{ state: 'idle' | 'probing' | 'found' | 'none'; models: string[]; note: string }>({ state: 'idle', models: [], note: '' });
  const [demoId, setDemoId] = useState<string | null>(null);
  const demo = s.tasks.find((t) => t.id === demoId);
  const artefact = demo?.outputs[0] ? s.vfs[demo.outputs[0]] : undefined;

  useEffect(() => { navigator.storage?.estimate?.().then((e) => setStorage({ usage: e.usage || 0, quota: e.quota || 0 })).catch(() => void 0); }, []);

  const nav = navigator as Navigator & { deviceMemory?: number };
  const lowResource = (nav.deviceMemory ?? 8) <= 4 || (navigator.hardwareConcurrency ?? 4) <= 2;

  const runDemo = () => {
    const t = k.submit('architect-core',
      'Create a text file named welcome.txt in my HarmOS workspace, write a short introduction to HarmOS, then show me the file.',
      { title: 'First-agent demonstration' });
    setDemoId(t.id);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#05070d] p-4">
      <div className="absolute inset-0 opacity-50" style={{ background: 'radial-gradient(900px 500px at 20% 0%, rgba(34,211,238,.10), transparent 60%), radial-gradient(800px 600px at 85% 100%, rgba(139,92,246,.12), transparent 60%)' }} />
      <div className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-[#080b14]/95 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-3">
          <HarmMark />
          <div>
            <p className="text-[13px] font-semibold tracking-wide text-slate-100">HarmOS {VERSION_STRING}</p>
            <p className="text-[11px] text-slate-500">Nexus edition · first-run setup</p>
          </div>
          <div className="ml-auto flex gap-1">
            {STEPS.map((x, i) => <span key={x} className={cx('h-1 w-6 rounded-full', i <= step ? 'bg-cyan-400' : 'bg-white/10')} />)}
          </div>
        </div>

        <div className="min-h-[340px] px-6 py-5">
          {step === 0 && (
            <div className="space-y-3">
              <h2 className="text-2xl font-semibold text-slate-50">Welcome to HarmOS</h2>
              <p className="text-[13px] leading-relaxed text-slate-400">
                A local-first, AI-native operating environment. <span className="text-slate-200">HarmOS Nexus</span> orchestrates your agents,
                <span className="text-slate-200"> AetherFrame</span> is the desktop, the <span className="text-slate-200">Sovereign Vault</span> holds your data,
                and <span className="text-slate-200">KaliOS</span> watches the boundaries.
              </p>
              <div className="rounded-lg border border-amber-400/25 bg-amber-400/5 p-3 text-[12px] leading-relaxed text-amber-100/90">
                <strong>Be clear about what you are running.</strong> This is the AetherFrame control surface and HarmOS kernel executing in a browser:
                the permission gate, task lifecycle, vault and audit log are real and persist across restarts. It is <em>not</em> the VirtualBox appliance —
                there is no Linux process layer here, so shell execution and host metrics are reported as unavailable rather than simulated.
                The complete OVA build pipeline ships in Release Workbench.
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <h2 className="text-xl font-semibold text-slate-50">Detected resources</h2>
              <p className="text-[12px] text-slate-400">Measured from this runtime. Values the browser will not disclose are shown as unavailable.</p>
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <KV k="Logical CPUs" v={navigator.hardwareConcurrency ?? 'unavailable'} />
                <KV k="Memory hint" v={nav.deviceMemory ? `${nav.deviceMemory} GB (coarse)` : 'unavailable'} />
                <KV k="Storage quota" v={storage ? `${fmtBytes(storage.usage)} used of ${fmtBytes(storage.quota)}` : 'querying…'} />
                <KV k="Recommendation" v={lowResource ? <Tag tone="warn">enable low-resource mode</Tag> : <Tag tone="ok">standard mode is fine</Tag>} />
              </div>
              <label className="flex items-center gap-3 text-[12.5px] text-slate-200">
                <input type="checkbox" className="h-4 w-4 accent-cyan-400" checked={s.settings.lowResource}
                  onChange={(e) => k.updateSettings({ lowResource: e.target.checked })} />
                Low-resource mode (one agent slot, reduced motion and indexing)
              </label>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <h2 className="text-xl font-semibold text-slate-50">Secure storage</h2>
              <p className="text-[12px] text-slate-400">HarmOS keeps your workspace, memory and audit log on this machine.</p>
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <KV k="Persistent store" v={<Tag tone="ok">available</Tag>} />
                <KV k="Eviction protection" v={persisted === null ? 'not requested' : persisted ? <Tag tone="ok">granted</Tag> : <Tag tone="warn">refused by the browser</Tag>} />
                <KV k="Credential storage" v="volatile session memory only" />
              </div>
              <Btn tone="primary" onClick={() => navigator.storage?.persist?.().then(setPersisted).catch(() => setPersisted(false))}>
                Request durable storage
              </Btn>
              <p className="text-[11.5px] text-slate-500">
                API keys are never written to disk in this build. On the appliance they go to the Linux keyring and the vault lives in
                <span className="font-mono"> /var/lib/harmos/vault</span> (0700, service-owned).
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <h2 className="text-xl font-semibold text-slate-50">Nexus backend</h2>
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <KV k="Kernel" v={<Tag tone="ok">online</Tag>} />
                <KV k="Capability gate" v={<Tag tone="ok">deny-by-default</Tag>} />
                <KV k="Agents registered" v={s.agents.length} />
                <KV k="Scheduler slots" v={s.settings.lowResource ? 1 : s.settings.maxConcurrent} />
                <KV k="Audit log" v={`${s.audit.length} event(s)`} />
                <KV k="Process layer" v={<Tag tone="bad">unavailable in the browser build</Tag>} />
              </div>
              <p className="text-[11.5px] text-slate-500">On the appliance this page would instead report harmos-nexus.service, its PID, and its loopback socket.</p>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3">
              <h2 className="text-xl font-semibold text-slate-50">AI model</h2>
              <p className="text-[12px] text-slate-400">Optional. HarmOS is usable without one — deterministic tools still run, and nothing will be faked.</p>
              <div className="flex flex-wrap gap-2">
                <Btn tone="primary" onClick={async () => {
                  setLocal({ state: 'probing', models: [], note: '' });
                  try {
                    const models = await probeOllama();
                    setLocal({ state: 'found', models, note: 'Ollama answered on 127.0.0.1:11434' });
                    if (models[0]) {
                      const id = uid('prov');
                      k.upsertProvider({ id, kind: 'ollama', label: 'Ollama (local)', baseUrl: 'http://127.0.0.1:11434', model: models[0], hasKey: false, reachable: 'yes', lastChecked: Date.now() });
                      k.commit((st) => { st.activeProvider = id; });
                    }
                  } catch (e) {
                    setLocal({ state: 'none', models: [], note: e instanceof Error ? e.message : String(e) });
                  }
                }}>Probe for a local runtime</Btn>
                <Btn onClick={() => setStep(5)}>Skip — configure later</Btn>
              </div>
              {local.state === 'found' && <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3 text-[12px] text-emerald-200">
                {local.note}. Models: {local.models.join(', ') || 'none installed yet'}
              </div>}
              {local.state === 'none' && <div className="rounded-lg border border-amber-400/25 bg-amber-400/10 p-3 text-[12px] text-amber-100">
                No local runtime answered ({local.note}). That is expected unless Ollama is running on this machine. You can add a cloud provider in the AI Model Manager at any time.
              </div>}
            </div>
          )}

          {step === 5 && (
            <div className="space-y-3">
              <h2 className="text-xl font-semibold text-slate-50">Privacy and permissions</h2>
              {(['offline-only', 'local-first', 'cloud-allowed'] as const).map((m) => (
                <button key={m} onClick={() => k.updateSettings({ processing: m })}
                  className={cx('flex w-full items-start gap-3 rounded-lg border p-3 text-left',
                    s.settings.processing === m ? 'border-cyan-400/50 bg-cyan-400/10' : 'border-white/10 bg-black/25')}>
                  <span className={cx('mt-0.5 h-3 w-3 rounded-full border', s.settings.processing === m ? 'border-cyan-300 bg-cyan-400' : 'border-white/30')} />
                  <span>
                    <span className="block text-[13px] text-slate-100">{m}</span>
                    <span className="block text-[11.5px] text-slate-400">
                      {m === 'offline-only' ? 'Nothing leaves this machine. Cloud capability is refused at the gate.'
                        : m === 'local-first' ? 'Prefer the local runtime; cloud only for agents you mark network-capable.'
                          : 'Cloud calls allowed for network-capable agents.'}
                    </span>
                  </span>
                </button>
              ))}
              <p className="text-[11.5px] text-slate-500">No agent holds system.admin. Destructive capabilities require per-action approval.</p>
            </div>
          )}

          {step === 6 && (
            <div className="space-y-3">
              <h2 className="text-xl font-semibold text-slate-50">First agent demonstration</h2>
              <p className="text-[12px] text-slate-400">
                Architect Core will create a real file in your vault and read it back. This is an actual task through the real scheduler — not an animation.
              </p>
              <div className="rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-[11.5px] text-slate-400">
                Create a text file named welcome.txt in my HarmOS workspace, write a short introduction to HarmOS, then show me the file.
              </div>
              {!demo ? <Btn tone="primary" onClick={runDemo}>Run the demonstration</Btn> : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2"><Tag tone={demo.state === 'COMPLETED' ? 'ok' : demo.state === 'FAILED' ? 'bad' : 'live'}>{demo.state}</Tag>
                    <span className="text-[11.5px] text-slate-400">{demo.steps.length} recorded step(s)</span></div>
                  <div className="max-h-28 overflow-auto rounded-lg border border-white/10 bg-black/40 p-2 font-mono text-[10.5px] text-slate-400">
                    {demo.steps.map((st, i) => <div key={i}>{st.kind}: {st.label}</div>)}
                  </div>
                  {demo.error && <p className="text-[11.5px] text-rose-300">{demo.error}</p>}
                  {artefact && (
                    <div className="rounded-lg border border-cyan-400/30 bg-cyan-400/5">
                      <div className="flex items-center gap-2 px-3 py-1.5">
                        <span className="font-mono text-[11.5px] text-cyan-200">{artefact.path}</span>
                        <Tag tone="info">{artefact.provenance}</Tag>
                        <span className="ml-auto text-[10.5px] text-slate-500">{artefact.content.length} bytes</span>
                      </div>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap border-t border-cyan-400/20 px-3 py-2 text-[11px] text-slate-300">{artefact.content}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-white/10 px-5 py-3">
          <span className="text-[11px] text-slate-500">{STEPS[step]} · step {step + 1} of {STEPS.length}</span>
          <div className="flex gap-2">
            {step > 0 && <Btn onClick={() => setStep(step - 1)}>Back</Btn>}
            {step < STEPS.length - 1
              ? <Btn tone="primary" onClick={() => setStep(step + 1)}>Continue</Btn>
              : <Btn tone="primary" onClick={() => { k.updateSettings({ onboarded: true }); onDone(); }}>Enter AetherFrame</Btn>}
          </div>
        </div>
      </div>
    </div>
  );
}

export function HarmMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label="HarmOS">
      <defs>
        <linearGradient id="hm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#22d3ee" /><stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <path d="M16 2 L28 9 V23 L16 30 L4 23 V9 Z" fill="none" stroke="url(#hm)" strokeWidth="1.6" />
      <path d="M11 21 V11 M21 21 V11 M11 16 H21" fill="none" stroke="url(#hm)" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="16" cy="16" r="1.6" fill="#22d3ee" />
    </svg>
  );
}
