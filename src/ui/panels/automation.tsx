import { useEffect, useRef, useState } from 'react';
import { Btn, Field, Panel, Tag, cx, inputCls, useKernel } from '../kit';
import {
  JOB_RECIPES, Scheduler, describeCron, jobsMarkdown, nextFire, parseCron,
  type CronJob, type CronRun,
} from '../../harmos/automation';

export function AutomationPanel() {
  const k = useKernel();
  const action = useRef(async (job: CronJob) => {
    const started = Date.now();
    const path = `/home/harmos/HarmOS/outbox/cron-${job.id}-${started}.md`;
    k.write(job.agentId, path, [
      `# ${job.name}`,
      '',
      `Scheduled run at ${new Date().toISOString()} via cron \`${job.expr}\`.`,
      `Agent: ${job.agentId}`,
      '',
      '## Task',
      '',
      job.task,
      '',
      '## Honest scope',
      '',
      'This file was produced by the HarmOS scheduler inside the page. The instruction above is real and stored;',
      'the analytical work it describes needs a connected model runtime to actually perform.',
    ].join('\n'), 'verified');
    k.log('info', 'cron', 'job.run', `${job.name} (${job.id}) → ${path}`);
    return `wrote ${path}`;
  });

  const [sched] = useState(() => new Scheduler(action.current, (r: CronRun) => {
    setRuns((prev) => [r, ...prev].slice(0, 60));
  }));
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [runs, setRuns] = useState<CronRun[]>([]);
  const [expr, setExpr] = useState('*/15 * * * *');
  const [name, setName] = useState('New job');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');

  const refresh = () => setJobs(sched.all());
  useEffect(() => { refresh(); return () => sched.dispose(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = window.setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, []);

  const tryExpr = (e: string) => {
    try {
      const parsed = parseCron(e);
      const next = nextFire(e);
      setPreview(`${describeCron(e)} · next ${next.toLocaleString()} · ${parsed.minutes.length * parsed.hours.length} slot(s)/day`);
      setError('');
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPreview('');
      return false;
    }
  };

  useEffect(() => { tryExpr(expr); }, [expr]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = (recipe?: typeof JOB_RECIPES[number]) => {
    const e = recipe?.expr || expr;
    if (!tryExpr(e)) return;
    const job = sched.add({
      name: recipe?.name || name || 'Untitled job',
      expr: e,
      agentId: recipe?.agentId || 'nexus',
      task: recipe?.task || 'Describe what this job should do.',
      enabled: true,
      jitterMs: recipe?.jitterMs ?? 0,
      allowConcurrent: false,
      timeoutMs: recipe?.timeoutMs ?? 60000,
      maxRetries: 1,
    });
    refresh();
    k.log('info', 'cron', 'job.add', `${job.name} @ ${e}`);
  };

  const autoDisabled = jobs.filter((j) => j.disabledByFailure);
  const okRuns = runs.filter((r) => r.status === 'ok').length;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3 py-2.5">
        <p className="text-[12.5px] font-semibold text-cyan-100">Scheduled jobs (cron)</p>
        <p className="text-[11px] text-slate-400">
          Real cron evaluation, jitter, a re-entrancy lock, timeouts, and auto-disable after three consecutive failures.
          Timers live in this page: schedules survive reload as configuration, not as a running process. On the appliance the same
          <code className="mx-1 font-mono text-cyan-200">nextFire</code> computation runs under harmos-svc so jobs survive reboot.
        </p>
      </div>

      {autoDisabled.length > 0 && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5">
          <p className="text-[12px] font-semibold text-amber-100">{autoDisabled.length} job(s) auto-disabled after repeated failure</p>
          {autoDisabled.map((j) => (
            <div key={j.id} className="mt-1 flex items-center gap-2 text-[11px] text-amber-100/80">
              <span>{j.name} — last error: {j.lastStatus}</span>
              <button className="rounded border border-amber-400/40 px-2 py-0.5 text-amber-100" onClick={() => { sched.resume(j.id); refresh(); }}>re-arm</button>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
        <div className="space-y-2">
          <Panel title="Configured jobs" subtitle={`${jobs.length} job(s) · ${okRuns}/${runs.length || 0} recent runs succeeded`}
            right={<Btn onClick={() => { const p = '/home/harmos/HarmOS/outbox/automation-ledger.md'; k.write('architect-core', p, jobsMarkdown(runs, jobs), 'verified'); k.log('info', 'cron', 'ledger.write', p); }}>Export ledger</Btn>}>
            {jobs.length === 0 && <p className="text-[12px] text-slate-500">No jobs yet. Add a recipe on the right, or write your own cron expression.</p>}
            <div className="space-y-2">
              {jobs.map((j) => (
                <div key={j.id} className={cx('rounded-lg border p-2.5', j.enabled ? 'border-white/10 bg-black/25' : 'border-white/5 bg-black/40 opacity-70')}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] font-medium text-slate-100">{j.name}</span>
                    <code className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-[10.5px] text-cyan-300">{j.expr}</code>
                    <Tag tone={j.enabled ? 'ok' : 'mute'}>{j.disabledByFailure ? 'auto-disabled' : j.enabled ? 'enabled' : 'paused'}</Tag>
                    {sched.isRunning(j.id) && <Tag tone="live">running</Tag>}
                    {j.lastStatus && <Tag tone={j.lastStatus === 'ok' ? 'ok' : j.lastStatus === 'skipped' ? 'mute' : 'bad'}>last: {j.lastStatus}</Tag>}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">{describeCron(j.expr)} · next {new Date(j.nextRunAt).toLocaleTimeString()} · agent {j.agentId}</p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-400">{j.task}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Btn onClick={async () => { const r = await sched.runNow(j.id); k.log(r.status === 'ok' ? 'info' : 'warn', 'cron', 'job.test', `${j.name}: ${r.status} — ${r.message}`); }}>Test now</Btn>
                    <Btn onClick={() => { sched.toggle(j.id); refresh(); }}>{j.enabled ? 'Pause' : 'Resume'}</Btn>
                    <Btn tone="danger" onClick={() => { sched.remove(j.id); refresh(); }}>Delete</Btn>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Run history" subtitle="Every outcome recorded with duration and attempt count.">
            {runs.length === 0 && <p className="text-[12px] text-slate-500">Nothing has run yet. Press “Test now” on a job to see a real entry.</p>}
            <div className="max-h-52 overflow-auto font-mono text-[10.5px]">
              {runs.map((r) => (
                <div key={r.id} className="flex gap-2 border-b border-white/5 py-1">
                  <span className="text-slate-600">{new Date(r.startedAt).toLocaleTimeString()}</span>
                  <span className={r.status === 'ok' ? 'text-emerald-300' : r.status === 'skipped' ? 'text-slate-400' : 'text-rose-300'}>{r.status}</span>
                  <span className="text-slate-400">{r.jobName}</span>
                  <span className="text-slate-600">{r.durationMs}ms{r.attempt > 1 ? ` ×${r.attempt}` : ''}</span>
                  <span className="truncate text-slate-500">{r.message}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="space-y-2">
          <Panel title="Custom job">
            <Field label="Name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Cron expression" hint="minute hour day-of-month month day-of-week">
              <input className={cx(inputCls, 'font-mono')} value={expr} onChange={(e) => setExpr(e.target.value)} />
            </Field>
            {preview && <p className="text-[11px] text-emerald-300">{preview}</p>}
            {error && <p className="text-[11px] text-rose-300">{error}</p>}
            <Btn tone="primary" onClick={() => add()} disabled={!!error}>Add job</Btn>
          </Panel>
          <Panel title="Recipes" subtitle="Sensible defaults with jitter so a dozen jobs do not fire in the same millisecond.">
            <div className="space-y-1.5">
              {JOB_RECIPES.map((r) => (
                <button key={r.id} onClick={() => add(r)} className="w-full rounded-lg border border-white/10 p-2 text-left hover:bg-white/5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] text-slate-100">{r.name}</span>
                    <code className="font-mono text-[10px] text-cyan-300">{r.expr}</code>
                  </div>
                  <p className="text-[10.5px] text-slate-500">{r.blurb}</p>
                </button>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
