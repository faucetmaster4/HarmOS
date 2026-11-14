import { useEffect, useRef, useState } from 'react';
import { Panel, Tag, Btn, KV, Empty, Field, inputCls, useKernel, useKernelState, ago, clock, cx, STATE_TONE, Impl } from '../kit';
import { plan, qalAnalyze, renderFinding, type QalFinding } from '../../harmos/runtime';
import type { Task } from '../../harmos/kernel';

/* ----------------------------------------------------------- Nexus Terminal */

export function NexusTerminal() {
  const k = useKernel();
  const s = useKernelState();
  const [input, setInput] = useState('');
  const [agentId, setAgentId] = useState('architect-core');
  const [selected, setSelected] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const agent = k.agent(agentId)!;
  const preview = input.trim() ? plan(input, agent.workingDir) : null;
  const task = s.tasks.find((t) => t.id === selected) || s.tasks[0];

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [task?.steps.length]);

  const submit = () => {
    if (!input.trim()) return;
    const t = k.submit(agentId, input.trim());
    setSelected(t.id);
    setInput('');
  };

  return (
    <div className="grid h-full gap-4 lg:grid-cols-[320px_1fr]">
      <Panel title="Task stream" subtitle={`${s.tasks.length} task(s) this session`} className="overflow-hidden">
        <div className="max-h-[60vh] space-y-1.5 overflow-auto pr-1">
          {s.tasks.map((t) => (
            <button key={t.id} onClick={() => setSelected(t.id)}
              className={cx('w-full rounded-lg border px-2.5 py-2 text-left transition',
                task?.id === t.id ? 'border-cyan-400/40 bg-cyan-400/10' : 'border-white/10 bg-black/20 hover:border-white/20')}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[12px] text-slate-100">{t.title}</span>
                <Tag tone={STATE_TONE[t.state]}>{t.state}</Tag>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[10.5px] text-slate-500">
                <span>{k.agent(t.agentId)?.name}</span><span>·</span><span>{ago(t.createdAt)}</span>
                {t.outputs.length > 0 && <><span>·</span><span className="text-cyan-400/80">{t.outputs.length} artefact</span></>}
              </div>
            </button>
          ))}
          {!s.tasks.length && <Empty>No tasks yet. Submit one on the right.</Empty>}
        </div>
      </Panel>

      <div className="flex min-h-0 flex-col gap-4">
        <Panel title={task ? task.title : 'Execution trace'}
          subtitle={task ? `${task.id} · ${k.agent(task.agentId)?.name}` : 'Every tool call, permission decision and model call is recorded here.'}
          right={task && (task.state === 'RUNNING' || task.state === 'QUEUED')
            ? <Btn tone="danger" onClick={() => k.cancel(task.id)}>Stop task</Btn>
            : task ? <Tag tone={STATE_TONE[task.state]}>{task.state}</Tag> : null}
          className="min-h-0 flex-1 overflow-hidden">
          <div className="max-h-[42vh] space-y-1 overflow-auto pr-1 font-mono text-[11.5px]">
            {task ? task.steps.map((st, i) => (
              <div key={i} className="rounded border border-white/5 bg-black/30 px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-slate-600">{clock(st.at)}</span>
                  <span className={cx('uppercase',
                    st.kind === 'error' || st.ok === false ? 'text-rose-300'
                      : st.kind === 'permission' ? 'text-amber-300'
                        : st.kind === 'model' ? 'text-violet-300'
                          : st.kind === 'tool' ? 'text-cyan-300' : 'text-slate-400')}>{st.kind}</span>
                  <span className="text-slate-200">{st.label}</span>
                  {st.ms !== undefined && <span className="ml-auto text-slate-600">{st.ms}ms</span>}
                </div>
                {st.detail && <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-400">{st.detail}</pre>}
              </div>
            )) : <Empty>Submit a task to see a real execution trace.</Empty>}
            {task?.error && <div className="rounded border border-rose-400/30 bg-rose-400/10 px-2 py-1.5 text-rose-200">error: {task.error}</div>}
            {task?.tokens && <div className="text-slate-500">tokens in {task.tokens.in} · out {task.tokens.out} · source {task.tokens.source}{task.tokens.costUsd ? ` · $${task.tokens.costUsd.toFixed(4)}` : ''}</div>}
            <div ref={endRef} />
          </div>
          {task && task.outputs.length > 0 && (
            <div className="mt-3 border-t border-white/10 pt-3">
              <p className="mb-1.5 text-[11px] uppercase tracking-wider text-slate-500">Artefacts written to the vault</p>
              {task.outputs.map((p) => <ArtefactView key={p} path={p} />)}
            </div>
          )}
        </Panel>

        <Panel title="Submit a task">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[180px]">
              <Field label="Agent">
                <select className={inputCls} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                  {s.agents.map((a) => <option key={a.id} value={a.id} disabled={a.revoked || !a.enabled}>{a.name}{a.revoked ? ' (revoked)' : a.enabled ? '' : ' (disabled)'}</option>)}
                </select>
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Natural-language task" hint={`working dir ${agent.workingDir} · caps ${agent.permissions.caps.length}`}>
                <input className={inputCls} value={input} placeholder='e.g. Create a file named welcome.txt with a short introduction to HarmOS'
                  onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
              </Field>
            </div>
            <Btn tone="primary" onClick={submit} disabled={!input.trim()}>Execute</Btn>
          </div>
          {preview && (
            <div className="mt-3 rounded-lg border border-white/10 bg-black/30 p-2.5">
              <p className="text-[11px] uppercase tracking-wider text-slate-500">Planner preview (before anything runs)</p>
              <p className="mt-1 font-mono text-[11.5px] text-cyan-300">{preview.steps.map((x) => x.tool).join('  →  ')}</p>
              <p className="mt-1 text-[11px] text-slate-400">{preview.rationale}</p>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function ArtefactView({ path }: { path: string }) {
  const s = useKernelState();
  const [open, setOpen] = useState(true);
  const node = s.vfs[path];
  if (!node) return <p className="text-[11px] text-rose-300">{path} (missing — deleted after the task?)</p>;
  return (
    <div className="mb-2 rounded-lg border border-cyan-400/20 bg-cyan-400/5">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left">
        <span className="font-mono text-[11.5px] text-cyan-200">{path}</span>
        <Tag tone="info">{node.provenance}</Tag>
        <span className="ml-auto text-[10.5px] text-slate-500">{node.content.length} B · {node.sha}</span>
      </button>
      {open && <pre className="max-h-56 overflow-auto whitespace-pre-wrap border-t border-cyan-400/20 px-2.5 py-2 text-[11px] leading-relaxed text-slate-300">{node.content}</pre>}
    </div>
  );
}

/* ----------------------------------------------------------- Agent Matrix */

export function AgentMatrix() {
  const k = useKernel();
  const s = useKernelState();
  const [sel, setSel] = useState(s.agents[0]?.id || '');
  const agent = s.agents.find((a) => a.id === sel) || s.agents[0];
  const tasks = s.tasks.filter((t) => t.agentId === agent?.id);

  const ALL_CAPS = ['fs.read', 'fs.write', 'fs.delete', 'fs.search', 'vault.read', 'vault.write', 'secrets.read',
    'net.fetch', 'shell.exec', 'system.admin', 'model.local', 'model.cloud', 'schedule.write', 'agent.manage'] as const;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Panel title="Agent matrix" subtitle="Seven specialists. Capability sets are asymmetric by design — no agent holds system.admin.">
        <div className="grid gap-2 sm:grid-cols-2">
          {s.agents.map((a) => {
            const live = s.tasks.filter((t) => t.agentId === a.id && t.state === 'RUNNING').length;
            return (
              <button key={a.id} onClick={() => setSel(a.id)}
                className={cx('rounded-lg border p-3 text-left transition',
                  sel === a.id ? 'border-cyan-400/50 bg-cyan-400/10' : 'border-white/10 bg-black/20 hover:border-white/25',
                  a.revoked && 'opacity-50')}>
                <div className="flex items-center gap-2">
                  <span className="text-lg leading-none text-cyan-300">{a.glyph}</span>
                  <span className="text-[13px] font-semibold text-slate-100">{a.name}</span>
                  {live > 0 && <Tag tone="live">{live} running</Tag>}
                  {a.revoked && <Tag tone="bad">revoked</Tag>}
                  {!a.enabled && !a.revoked && <Tag tone="warn">disabled</Tag>}
                </div>
                <p className="mt-1 text-[11px] leading-snug text-slate-400">{a.summary}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {a.permissions.caps.slice(0, 5).map((c) => <span key={c} className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">{c}</span>)}
                  {a.permissions.caps.length > 5 && <span className="text-[10px] text-slate-500">+{a.permissions.caps.length - 5}</span>}
                </div>
              </button>
            );
          })}
        </div>
      </Panel>

      {agent && (
        <div className="space-y-4">
          <Panel title={agent.name} subtitle={agent.role}
            right={<Btn tone={agent.revoked ? 'primary' : 'danger'} onClick={() => k.updateAgent(agent.id, { revoked: !agent.revoked })}>
              {agent.revoked ? 'Restore' : 'Revoke'}
            </Btn>}>
            <KV k="Working directory" v={<span className="font-mono text-[10.5px]">{agent.workingDir}</span>} />
            <KV k="Cloud models" v={<Tag tone={agent.permissions.networkModels ? 'warn' : 'ok'}>{agent.permissions.networkModels ? 'permitted' : 'blocked'}</Tag>} />
            <KV k="Tasks" v={`${tasks.filter((t) => t.state === 'COMPLETED').length} done · ${tasks.filter((t) => t.state === 'FAILED').length} failed`} />
            <div className="mt-3 space-y-1">
              <p className="text-[11px] uppercase tracking-wider text-slate-500">Granted roots</p>
              {agent.permissions.roots.map((r) => <p key={r} className="font-mono text-[11px] text-slate-300">{r}</p>)}
            </div>
          </Panel>

          <Panel title="Capability grants" subtitle="Changes take effect immediately in the kernel gate.">
            <div className="grid grid-cols-2 gap-1">
              {ALL_CAPS.map((c) => {
                const on = agent.permissions.caps.includes(c);
                const risky = c === 'system.admin' || c === 'shell.exec' || c === 'secrets.read' || c === 'fs.delete';
                return (
                  <button key={c} onClick={() => k.updateAgent(agent.id, {
                    permissions: { ...agent.permissions, caps: on ? agent.permissions.caps.filter((x) => x !== c) : [...agent.permissions.caps, c] },
                  })}
                    className={cx('flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[10.5px] transition',
                      on ? (risky ? 'border-rose-400/40 bg-rose-400/10 text-rose-200' : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200')
                        : 'border-white/10 bg-black/20 text-slate-500 hover:text-slate-300')}>
                    <span>{on ? '●' : '○'}</span>{c}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[10.5px] text-slate-500">Red capabilities are destructive or privileged. Granting one here does not bypass the approval list — the gate still asks.</p>
          </Panel>

          <Panel title="Agent memory" subtitle="Scoped, sourced, deletable.">
            <div className="max-h-48 space-y-1.5 overflow-auto">
              {s.memory.filter((m) => m.agentId === agent.id).map((m) => (
                <div key={m.id} className="rounded border border-white/10 bg-black/20 p-2">
                  <div className="flex items-center gap-2 text-[10px]">
                    <Tag tone={m.provenance === 'model' ? 'info' : m.provenance === 'verified' ? 'ok' : 'mute'}>{m.provenance}</Tag>
                    <span className="font-mono text-slate-500">{m.source}</span>
                    <span className="ml-auto text-slate-600">{ago(m.at)}</span>
                    <button className="text-rose-300 hover:text-rose-200" onClick={() => k.forget(m.id)}>delete</button>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-300">{m.text.slice(0, 220)}</p>
                </div>
              ))}
              {!s.memory.filter((m) => m.agentId === agent.id).length && <Empty>No memory entries for this agent.</Empty>}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- Workflow Builder */

interface Stage { id: string; agentId: string; prompt: string; parallel: boolean }

export function WorkflowBuilder() {
  const k = useKernel();
  const s = useKernelState();
  const [stages, setStages] = useState<Stage[]>([
    { id: 's1', agentId: 'architect-core', prompt: 'Create a file named project-brief.md with an outline for a new HarmOS module', parallel: false },
    { id: 's2', agentId: 'knowledge-node', prompt: 'Search the vault for HarmOS and summarise what was found', parallel: false },
    { id: 's3', agentId: 'guardian-node', prompt: 'Run a security audit of the current permission surface', parallel: true },
  ]);
  const [launched, setLaunched] = useState<string[]>([]);

  const run = () => {
    const ids: string[] = [];
    let prev: string | undefined;
    for (const st of stages) {
      const t = k.submit(st.agentId, st.prompt, {
        title: `[workflow] ${st.prompt.slice(0, 48)}`,
        workflowId: 'wf_' + Date.now(),
        dependsOn: st.parallel || !prev ? [] : [prev],
      });
      ids.push(t.id);
      if (!st.parallel) prev = t.id;
    }
    setLaunched(ids);
  };

  return (
    <div className="space-y-4">
      <Panel title="Workflow builder" subtitle="Chained stages wait for their predecessor. Parallel stages are dispatched immediately, subject to the concurrency governor."
        right={<div className="flex gap-2"><Btn onClick={() => setStages([...stages, { id: 's' + (stages.length + 1), agentId: 'architect-core', prompt: '', parallel: false }])}>Add stage</Btn><Btn tone="primary" onClick={run}>Run workflow</Btn></div>}>
        <div className="space-y-2">
          {stages.map((st, i) => (
            <div key={st.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-black/20 p-2.5">
              <span className="font-mono text-[11px] text-cyan-400/80">{String(i + 1).padStart(2, '0')}</span>
              <select className={cx(inputCls, 'w-44')} value={st.agentId}
                onChange={(e) => setStages(stages.map((x) => (x.id === st.id ? { ...x, agentId: e.target.value } : x)))}>
                {s.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <input className={cx(inputCls, 'flex-1 min-w-[220px]')} value={st.prompt} placeholder="task for this stage"
                onChange={(e) => setStages(stages.map((x) => (x.id === st.id ? { ...x, prompt: e.target.value } : x)))} />
              <button onClick={() => setStages(stages.map((x) => (x.id === st.id ? { ...x, parallel: !x.parallel } : x)))}
                className={cx('rounded border px-2 py-1 text-[11px]', st.parallel ? 'border-violet-400/40 bg-violet-400/10 text-violet-200' : 'border-white/10 bg-white/5 text-slate-400')}>
                {st.parallel ? 'parallel' : `after ${i || '—'}`}
              </button>
              <Btn tone="ghost" onClick={() => setStages(stages.filter((x) => x.id !== st.id))}>✕</Btn>
            </div>
          ))}
        </div>
      </Panel>

      {launched.length > 0 && (
        <Panel title="Launched graph" subtitle="Live task states from the kernel scheduler.">
          <div className="space-y-1.5">
            {launched.map((id) => {
              const t = s.tasks.find((x) => x.id === id);
              if (!t) return null;
              return (
                <div key={id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <Tag tone={STATE_TONE[t.state]}>{t.state}</Tag>
                  <span className="truncate text-[12px] text-slate-200">{t.title}</span>
                  <span className="ml-auto text-[10.5px] text-slate-500">
                    {t.dependsOn?.length ? `waits on ${t.dependsOn.length}` : 'no dependency'}
                  </span>
                  {(t.state === 'RUNNING' || t.state === 'QUEUED') && <Btn tone="danger" onClick={() => k.cancel(t.id)}>Stop</Btn>}
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      <Panel title="Scheduling" subtitle="Deferred execution while this session is open." right={<Impl status="partial" />}>
        <ScheduleRow />
      </Panel>
    </div>
  );
}

function ScheduleRow() {
  const k = useKernel();
  const [secs, setSecs] = useState(30);
  const [armed, setArmed] = useState<{ at: number; prompt: string } | null>(null);
  const [prompt, setPrompt] = useState('Run a security audit of the current permission surface');
  useEffect(() => {
    if (!armed) return;
    const left = armed.at - Date.now();
    const id = window.setTimeout(() => { k.submit('automation-node', armed.prompt, { title: '[scheduled] ' + armed.prompt.slice(0, 40) }); setArmed(null); }, Math.max(0, left));
    return () => clearTimeout(id);
  }, [armed, k]);
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-[240px]"><Field label="Task"><input className={inputCls} value={prompt} onChange={(e) => setPrompt(e.target.value)} /></Field></div>
      <div className="w-28"><Field label="Delay (s)"><input type="number" min={5} className={inputCls} value={secs} onChange={(e) => setSecs(+e.target.value)} /></Field></div>
      <Btn tone="primary" onClick={() => setArmed({ at: Date.now() + secs * 1000, prompt })} disabled={!!armed}>Arm</Btn>
      {armed && <span className="text-[11.5px] text-amber-300">fires at {clock(armed.at)} — cron-style recurrence requires the appliance scheduler.</span>}
    </div>
  );
}

/* ----------------------------------------------------------- QAL */

export function QalPanel() {
  const k = useKernel();
  useKernelState();
  const [q, setQ] = useState('Is HarmOS ready to execute real agent work right now?');
  const [finding, setFinding] = useState<QalFinding | null>(null);

  return (
    <div className="space-y-4">
      <Panel title="QAL — structured analysis engine"
        subtitle="Deterministic analysis software. No quantum library or quantum hardware is involved; the name is a module label only."
        right={<Btn tone="primary" onClick={() => setFinding(qalAnalyze(k, q))}>Analyse</Btn>}>
        <input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} />
      </Panel>

      {finding && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Evidence" subtitle="Each item names the kernel source it came from.">
              {finding.evidence.map((e, i) => (
                <div key={i} className="flex items-start gap-2 border-b border-white/5 py-1.5 last:border-0">
                  <Tag tone={e.kind === 'observed' ? 'ok' : e.kind === 'user' ? 'info' : 'warn'}>{e.kind}</Tag>
                  <span className="flex-1 text-[11.5px] text-slate-300">{e.claim}</span>
                  <span className="font-mono text-[10px] text-slate-500">{e.source}</span>
                </div>
              ))}
            </Panel>
            <Panel title="Competing hypotheses" subtitle="Ranked by supporting minus opposing observations.">
              {finding.hypotheses.map((h, i) => (
                <div key={i} className="border-b border-white/5 py-2 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] text-slate-100">{h.label}</span>
                    <span className="font-mono text-[11px] text-slate-400">+{h.support} / −{h.against}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500">{h.note}</p>
                </div>
              ))}
            </Panel>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Contradictions">
              {finding.contradictions.length ? finding.contradictions.map((c, i) => <p key={i} className="mb-2 text-[11.5px] text-amber-200">{c}</p>) : <Empty>None detected.</Empty>}
            </Panel>
            <Panel title="Confidence">
              <p className="text-3xl font-semibold text-cyan-300">{(finding.confidence * 100).toFixed(0)}%</p>
              <p className="mt-1 text-[11px] text-slate-500">Heuristic score over counted evidence. Not a calibrated probability.</p>
            </Panel>
            <Panel title="Uncertainty">
              {finding.uncertainty.map((u, i) => <p key={i} className="mb-1.5 text-[11.5px] text-slate-400">• {u}</p>)}
            </Panel>
          </div>
          <Panel title="Conclusion" right={<Btn onClick={() => {
            const p = `/home/harmos/HarmOS/outbox/qal-${Date.now()}.md`;
            k.write('knowledge-node', p, renderFinding(finding), 'inferred');
          }}>Save to vault</Btn>}>
            <p className="text-[12.5px] text-slate-200">{finding.conclusion}</p>
          </Panel>
        </>
      )}
    </div>
  );
}

export function taskSummary(t: Task) { return `${t.state} · ${t.steps.length} steps`; }
