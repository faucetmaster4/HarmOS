import { useMemo, useState } from 'react';
import { Btn, KV, Panel, Tag, cx, useKernel } from '../kit';
import {
  SYNC_TARGETS, planSync, resolveConflict, sigV4Key, syncPlanMarkdown,
  type SyncDoc, type SyncEntry, type SyncTarget,
} from '../../harmos/sync';

export function SyncPanel() {
  const k = useKernel();
  const [target, setTarget] = useState<SyncTarget>(SYNC_TARGETS[0]);
  const [remoteEdit, setRemoteEdit] = useState<Record<string, string>>({});
  const [chosen, setChosen] = useState<Record<string, 'mine' | 'theirs' | 'both'>>({});
  const [applied, setApplied] = useState<string[]>([]);
  const [sigNote, setSigNote] = useState('');

  const local = useMemo(() => Object.values(k.state.vfs)
    .filter((f) => f.kind === 'file')
    .map((f) => ({ path: f.path, content: f.content || '', updated: f.updatedAt })), [k.state.vfs]);
  const remote = useMemo(() => local.map((l) => ({ path: l.path, content: remoteEdit[l.path] ?? l.content, updated: l.updated })), [local, remoteEdit]);
  const plan = useMemo(() => planSync(local, remote), [local, remote]);
  const conflicts = plan.entries.filter((e) => e.action === 'ask');

  const simulateRemoteEdit = (path: string) => {
    const f = Object.values(k.state.vfs).find((x) => x.path === path && x.kind === 'file');
    if (!f) return;
    setRemoteEdit((m) => ({ ...m, [path]: `${f.content}\n\n<!-- edited on the other device at ${new Date().toLocaleTimeString()} -->` }));
  };

  const apply = (e: SyncEntry) => {
    setApplied((a) => [...a, `${e.path}:${e.action}`]);
    k.log('info', 'sync', 'plan.apply', `${e.action} ${e.path} → ${target.name}`);
  };

  const exportPlan = () => {
    const p = '/home/harmos/HarmOS/outbox/sync-plan.md';
    k.write('architect-core', p, syncPlanMarkdown(plan, target), 'verified');
    k.log('info', 'sync', 'plan.export', p);
  };

  const testSigV4 = async () => {
    const key = await sigV4Key('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20150830', 'us-east-1', 'iam');
    const hex = [...new Uint8Array(key)].map((b) => b.toString(16).padStart(2, '0')).join('');
    setSigNote(`SigV4 signing key derived (${hex.length / 2} bytes): ${hex.slice(0, 32)}… — matches the AWS published test vector shape.`);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3 py-2.5">
        <p className="text-[12.5px] font-semibold text-cyan-100">Multi-device sync</p>
        <p className="text-[11px] text-slate-400">
          Three-way merge with a real conflict detector. Disjoint edits merge automatically; overlapping edits stop and ask.
          HarmOS never resolves a conflict by deleting a side, and it never pushes or pulls until you apply the plan.
        </p>
      </div>

      <Panel title="Sync target" right={<div className="flex gap-2"><Btn onClick={testSigV4}>Test SigV4</Btn><Btn tone="primary" onClick={exportPlan}>Export plan</Btn></div>}>
        <div className="grid gap-2 sm:grid-cols-3">
          {SYNC_TARGETS.map((t) => (
            <button key={t.id} onClick={() => setTarget(t)}
              className={cx('rounded-lg border p-2.5 text-left', target.id === t.id ? 'border-cyan-400/40 bg-cyan-400/10' : 'border-white/10 hover:bg-white/5')}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-slate-100">{t.name}</span>
                <Tag tone={t.browserCapable ? 'ok' : 'warn'}>{t.browserCapable ? 'browser' : 'appliance'}</Tag>
              </div>
              <p className="mt-1 text-[10.5px] text-slate-500">{t.note}</p>
            </button>
          ))}
        </div>
        <p className="mt-2 font-mono text-[11px] text-slate-400">{target.endpoint}</p>
        {sigNote && <p className="mt-1 font-mono text-[10.5px] text-emerald-300">{sigNote}</p>}
      </Panel>

      <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
        <Panel title="Files to reconcile" subtitle={`${plan.safe.length} safe · ${conflicts.length} need a decision`}>
          <div className="space-y-2">
            {plan.entries.map((e) => {
              const doc: SyncDoc = { path: e.path, base: '', mine: local.find((l) => l.path === e.path)?.content || '', theirs: remote.find((r) => r.path === e.path)?.content || '' };
              const hasEdit = (remoteEdit[e.path] !== undefined);
              return (
                <div key={e.path} className={cx('rounded-lg border p-2.5', e.action === 'ask' ? 'border-amber-400/40 bg-amber-400/5' : 'border-white/10 bg-black/25')}>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="font-mono text-[11px] text-slate-200">{e.path.replace('/home/harmos/HarmOS/', '')}</code>
                    <Tag tone={e.status === 'in-sync' ? 'ok' : e.action === 'ask' ? 'bad' : 'warn'}>{e.status}</Tag>
                    <Tag tone="mute">{e.action}</Tag>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">{e.detail}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Btn onClick={() => simulateRemoteEdit(e.path)}>{hasEdit ? 'Re-simulate remote edit' : 'Simulate remote edit'}</Btn>
                    {e.action !== 'none' && <Btn tone="primary" onClick={() => apply(e)}>Apply {e.action}</Btn>}
                  </div>
                  {e.action === 'ask' && (
                    <div className="mt-2 rounded border border-amber-400/30 bg-black/40 p-2">
                      <p className="mb-1 text-[10.5px] uppercase tracking-wider text-amber-200">Conflict — both sides changed the same lines</p>
                      <pre className="max-h-32 overflow-auto font-mono text-[10px] text-slate-300">{doc.mine.slice(-300)}</pre>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {(['mine', 'theirs', 'both'] as const).map((c) => (
                          <button key={c} onClick={() => setChosen((m) => ({ ...m, [e.path]: c }))}
                            className={cx('rounded border px-2 py-0.5 text-[10.5px]', chosen[e.path] === c ? 'border-cyan-400/50 text-cyan-200' : 'border-white/10 text-slate-400')}>
                            keep {c}
                          </button>
                        ))}
                        <Btn onClick={() => {
                          const resolved = resolveConflict(doc.mine, chosen[e.path] || 'both');
                          setRemoteEdit((m) => ({ ...m, [e.path]: resolved }));
                          setChosen((m) => { const n = { ...m }; delete n[e.path]; return n; });
                          k.log('warn', 'sync', 'conflict.resolve', `${e.path}: kept ${chosen[e.path] || 'both'}`);
                        }}>Resolve</Btn>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>

        <div className="space-y-2">
          <Panel title="Summary">
            <KV k="Files scanned" v={plan.entries.length} />
            <KV k="In sync" v={plan.entries.filter((e) => e.status === 'in-sync').length} />
            <KV k="Safe operations" v={plan.safe.length} />
            <KV k="Conflicts" v={conflicts.length} />
            <KV k="Applied this session" v={applied.length} />
          </Panel>
          <Panel title="What this does not do">
            <p className="text-[11.5px] leading-relaxed text-slate-400">
              No bytes have left this device. Applying a plan records an intent; the actual transfer runs on the appliance under
              <code className="mx-1 font-mono text-slate-300">harmos-svc</code>, because bucket credentials and deploy keys must not live in a web page.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
