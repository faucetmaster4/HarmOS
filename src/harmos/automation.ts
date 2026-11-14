/* HarmOS Automation Engine — cron scheduler with jitter, locking, and a run ledger.
 *
 * The scheduler is real: it evaluates cron expressions, computes the next fire time,
 * applies jitter to avoid thundering herds, and records every run outcome with
 * duration and a boolean success flag. Jobs never run concurrently with themselves
 * unless `allowConcurrent` is set.
 *
 * Timers live in the page. A cron job survives reload only as configuration, not as
 * a running timer. On the appliance the same `nextRun` computation is used by
 * harmos-svc so schedules survive reboot.
 */

export type CronField = string;

export interface CronJob {
  id: string;
  name: string;
  expr: string;
  agentId: string;
  task: string;
  enabled: boolean;
  jitterMs: number;
  allowConcurrent: boolean;
  timeoutMs: number;
  maxRetries: number;
  lastStatus?: 'ok' | 'failed' | 'timeout' | 'skipped';
  lastRunAt?: number;
  nextRunAt: number;
  consecutiveFailures: number;
  disabledByFailure?: boolean;
}

export interface CronRun {
  id: string;
  jobId: string;
  jobName: string;
  startedAt: number;
  durationMs: number;
  status: 'ok' | 'failed' | 'timeout' | 'skipped';
  message: string;
  attempt: number;
}

/* ------------------------------- cron parsing ----------------------------- */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function expandField(field: string, min: number, max: number, names?: string[]): number[] {
  const out = new Set<number>();
  const norm = (t: string) => {
    const lower = t.toLowerCase();
    if (names) {
      const i = names.indexOf(lower);
      if (i >= 0) return i + (names === DAYS ? 0 : 1);
    }
    return Number(lower);
  };
  for (const part of field.split(',')) {
    const [range, stepRaw] = part.split('/');
    const step = stepRaw ? Number(stepRaw) : 1;
    if (!Number.isFinite(step) || step < 1) throw new Error(`bad step in "${part}"`);
    let lo: number, hi: number;
    if (range === '*') { lo = min; hi = max; }
    else if (range.includes('-')) {
      const [a, b] = range.split('-');
      lo = norm(a); hi = norm(b);
    } else {
      lo = norm(range);
      hi = stepRaw ? max : lo;   // "5/15" means start at 5, every 15
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new Error(`bad range "${part}"`);
    if (lo < min || hi > max || lo > hi) throw new Error(`"${part}" out of range ${min}-${max}`);
    for (let v = lo; v <= hi; v += step) out.add(v === 7 && max === 6 ? 0 : v);
  }
  return [...out].sort((a, b) => a - b);
}

export interface ParsedCron { minutes: number[]; hours: number[]; doms: number[]; months: number[]; dows: number[]; }

export function parseCron(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron needs 5 fields, got ${parts.length}`);
  return {
    minutes: expandField(parts[0], 0, 59),
    hours: expandField(parts[1], 0, 23),
    doms: expandField(parts[2], 1, 31),
    months: expandField(parts[3], 1, 12, MONTHS),
    dows: expandField(parts[4], 0, 6, DAYS),
  };
}

export function nextFire(expr: string, from: Date = new Date()): Date {
  const c = parseCron(expr);
  const hasDomRestriction = !['*', ...Array.from({ length: 31 }, (_, i) => String(i + 1))].includes('*') || c.doms.length !== 31;
  const hasDowRestriction = c.dows.length !== 7;
  const restrictDay = hasDomRestriction && hasDowRestriction;

  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);

  for (let guard = 0; guard < 600000; guard++) {
    if (!c.months.includes(d.getMonth() + 1)) {
      d.setMonth(d.getMonth() + 1, 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    const domOk = c.doms.includes(d.getDate());
    const dowOk = c.dows.includes(d.getDay());
    if (restrictDay && !(domOk || dowOk)) {
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    if (!restrictDay && !((c.doms.length === 31 ? true : domOk) && (c.dows.length === 7 ? true : dowOk))) {
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    if (!c.hours.includes(d.getHours())) {
      d.setHours(d.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!c.minutes.includes(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1, 0, 0);
      continue;
    }
    return d;
  }
  throw new Error('cron expression never fires');
}

export function describeCron(expr: string): string {
  try {
    const c = parseCron(expr);
    if (c.minutes.length === 60 && c.hours.length === 24) return 'every minute';
    if (c.minutes.length === 60 && c.hours.length === 1) return `hourly at :${String(c.minutes[0]).padStart(2, '0')}`;
    if (c.hours.length === 24 && c.minutes.length === 1) return `every hour at :${String(c.minutes[0]).padStart(2, '0')} past`;
    const everyN = c.minutes.length > 1 && c.minutes[1] - c.minutes[0] === c.minutes[0];
    if (everyN) return `every ${c.minutes[0]} minutes`;
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const clock = `${String(c.hours[0]).padStart(2, '0')}:${String(c.minutes[0]).padStart(2, '0')}`;
    const daily = c.doms.length === 31 && c.dows.length === 7 && c.hours.length === 1 && c.minutes.length === 1;
    if (daily) return `every day at ${clock}`;
    if (c.dows.length === 5 && c.doms.length === 31) return `weekdays at ${clock}`;
    if (c.dows.length === 1 && c.doms.length === 31) return `${names[c.dows[0]]} at ${clock}`;
    if (c.doms.length === 1) return `day ${c.doms[0]} of the month at ${clock}`;
    return `runs ${c.minutes.length * c.hours.length} slot(s)/day`;
  } catch (e) {
    return `invalid: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/* ------------------------------ job execution ----------------------------- */

export type JobAction = (job: CronJob) => Promise<string>;

export class Scheduler {
  private jobs = new Map<string, CronJob>();
  private timers = new Map<string, number>();
  private running = new Set<string>();
  private runs: CronRun[] = [];
  private seq = 1;
  private onRun?: (r: CronRun) => void;

  constructor(private action: JobAction, onRun?: (r: CronRun) => void) {
    this.onRun = onRun;
  }

  all(): CronJob[] { return [...this.jobs.values()].sort((a, b) => a.nextRunAt - b.nextRunAt); }
  history(limit = 50): CronRun[] { return this.runs.slice(0, limit); }
  isRunning(id: string): boolean { return this.running.has(id); }

  add(job: Omit<CronJob, 'nextRunAt' | 'consecutiveFailures' | 'id'> & { id?: string }): CronJob {
    const nextRunAt = nextFire(job.expr).getTime() + (job.jitterMs ? Math.random() * job.jitterMs : 0);
    const full: CronJob = {
      id: job.id || `job${this.seq++}`,
      consecutiveFailures: 0,
      ...job,
      nextRunAt,
    } as CronJob;
    this.jobs.set(full.id, full);
    this.schedule(full);
    return full;
  }

  remove(id: string): void {
    const t = this.timers.get(id);
    if (t) window.clearTimeout(t);
    this.timers.delete(id);
    this.jobs.delete(id);
  }

  toggle(id: string): void {
    const j = this.jobs.get(id);
    if (!j) return;
    j.enabled = !j.enabled;
    j.disabledByFailure = false;
    j.consecutiveFailures = 0;
    if (j.enabled) this.schedule(j);
    else {
      const t = this.timers.get(id);
      if (t) window.clearTimeout(t);
      this.timers.delete(id);
    }
  }

  /** Re-arm after a failure-triggered disable. */
  resume(id: string): void {
    const j = this.jobs.get(id);
    if (!j) return;
    j.enabled = true;
    j.disabledByFailure = false;
    j.consecutiveFailures = 0;
    j.nextRunAt = nextFire(j.expr).getTime();
    this.schedule(j);
  }

  /** Run now, bypassing the schedule. Used by the "test this job" control. */
  async runNow(id: string): Promise<CronRun> {
    const job = this.jobs.get(id);
    if (!job) throw new Error('no such job');
    return this.execute(job, 1);
  }

  private schedule(job: CronJob): void {
    const existing = this.timers.get(job.id);
    if (existing) window.clearTimeout(existing);
    if (!job.enabled) return;
    const delay = Math.max(250, job.nextRunAt - Date.now());
    // setTimeout clamps >2^31; long schedules re-arm on a 24h ceiling.
    const clamped = Math.min(delay, 2 ** 31 - 1);
    const t = window.setTimeout(() => void this.tick(job.id), clamped);
    this.timers.set(job.id, t);
  }

  private async tick(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job || !job.enabled) return;
    if (this.running.has(id) && !job.allowConcurrent) {
      this.record({ id: `r${this.seq++}`, jobId: id, jobName: job.name, startedAt: Date.now(), durationMs: 0, status: 'skipped', message: 'previous run still active', attempt: 0 });
      job.nextRunAt = nextFire(job.expr).getTime();
      this.schedule(job);
      return;
    }
    const due = Date.now() >= job.nextRunAt - 1000;
    if (!due) { this.schedule(job); return; }

    let attempt = 1;
    let last: CronRun | null = null;
    while (attempt <= Math.max(1, job.maxRetries)) {
      last = await this.execute(job, attempt);
      if (last.status === 'ok' || last.status === 'skipped') break;
      attempt++;
    }
    job.lastStatus = last?.status;
    job.lastRunAt = Date.now();
    if (last && last.status !== 'ok') {
      job.consecutiveFailures++;
      if (job.consecutiveFailures >= 3) {
        job.enabled = false;
        job.disabledByFailure = true;
      }
    } else if (last?.status === 'ok') {
      job.consecutiveFailures = 0;
    }
    job.nextRunAt = nextFire(job.expr).getTime() + (job.jitterMs ? Math.random() * job.jitterMs : 0);
    this.schedule(job);
  }

  private async execute(job: CronJob, attempt: number): Promise<CronRun> {
    const startedAt = Date.now();
    this.running.add(job.id);
    let status: CronRun['status'] = 'ok';
    let message = '';
    try {
      message = await Promise.race([
        this.action(job),
        new Promise<string>((_, rej) => setTimeout(() => rej(new Error('timeout')), job.timeoutMs)),
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      status = msg === 'timeout' ? 'timeout' : 'failed';
      message = msg;
    } finally {
      this.running.delete(job.id);
    }
    const run: CronRun = {
      id: `r${this.seq++}`, jobId: job.id, jobName: job.name, startedAt,
      durationMs: Date.now() - startedAt, status, message, attempt,
    };
    this.record(run);
    return run;
  }

  private record(r: CronRun): void {
    this.runs = [r, ...this.runs].slice(0, 200);
    this.onRun?.(r);
  }

  dispose(): void {
    for (const t of this.timers.values()) window.clearTimeout(t);
    this.timers.clear();
    this.jobs.clear();
  }
}

/* ------------------------------ recipe library ---------------------------- */

export interface JobRecipe { id: string; name: string; expr: string; agentId: string; task: string; jitterMs: number; timeoutMs: number; blurb: string; }

export const JOB_RECIPES: JobRecipe[] = [
  { id: 'digest', name: 'Morning vault digest', expr: '0 8 * * *', agentId: 'lgai', task: 'Summarise everything written to the workspace in the last 24 hours and note anything that looks unfinished.', jitterMs: 90000, timeoutMs: 120000, blurb: 'One readable summary a day. Cheap, and it makes the vault feel inhabited.' },
  { id: 'fim', name: 'Integrity sweep', expr: '15 */6 * * *', agentId: 'kalios', task: 'Re-hash sealed notes and flag any drift from the recorded baseline.', jitterMs: 30000, timeoutMs: 180000, blurb: 'Every six hours. Catches silent tampering far sooner than a weekly scan.' },
  { id: 'backup', name: 'Vault backup', expr: '30 3 * * 0', agentId: 'architect-core', task: 'Snapshot the workspace and verify the archive round-trips before overwriting the previous one.', jitterMs: 120000, timeoutMs: 600000, blurb: 'Sunday 03:30. Verify-then-replace, so a corrupt backup never destroys the good one.' },
  { id: 'rebalance', name: 'Risk review', expr: '0 9 * * 1-5', agentId: 'qal', task: 'Check concentration and drawdown against limits and write a one-page note if either is breached.', jitterMs: 60000, timeoutMs: 180000, blurb: 'Weekdays only — no alerts at 3am for a weekend gap.' },
  { id: 'ledger', name: 'Ledger reconcile', expr: '0 18 1 * *', agentId: 'architect-core', task: 'Rebuild the FIFO ledger from the statement imports and list lots with no matching trade.', jitterMs: 0, timeoutMs: 300000, blurb: 'First of the month. Orphaned lots are the usual sign of a missed import.' },
  { id: 'storecheck', name: 'Store draft review', expr: '0 17 * * 5', agentId: 'nexus', task: 'Read generated store drafts and list every placeholder still marked UNASSIGNED.', jitterMs: 45000, timeoutMs: 120000, blurb: 'Friday afternoon nudge so a draft never quietly becomes a live listing.' },
];

export function jobsMarkdown(runs: CronRun[], jobs: CronJob[]): string {
  const lines = [
    '# HarmOS automation ledger',
    '',
    `Generated ${new Date().toISOString()}. ${jobs.length} job(s) configured, ${runs.length} recent run(s) recorded.`,
    '',
    '## Jobs',
    '',
    '| job | schedule | agent | enabled | last status | next run |',
    '| --- | --- | --- | --- | --- | --- |',
    ...jobs.map((j) => `| ${j.name} | \`${j.expr}\` | ${j.agentId} | ${j.disabledByFailure ? 'auto-disabled (3 failures)' : j.enabled ? 'yes' : 'no'} | ${j.lastStatus ?? 'never'} | ${new Date(j.nextRunAt).toISOString().slice(0, 16)} |`),
    '',
    '## Recent runs',
    '',
    '| when | job | status | took | attempt | message |',
    '| --- | --- | --- | --- | --- | --- |',
    ...runs.slice(0, 40).map((r) => `| ${new Date(r.startedAt).toISOString().slice(0, 19)} | ${r.jobName} | ${r.status} | ${r.durationMs}ms | ${r.attempt} | ${r.message.replace(/\|/g, '/').slice(0, 90)} |`),
  ];
  return lines.join('\n');
}
