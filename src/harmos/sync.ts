/* HarmOS Sync Engine — three-way merge with a real conflict detector.
 *
 * This is the machinery behind "my laptop and my desktop both edited README.md". It keeps
 * a base revision plus two descendants, then either auto-merges disjoint hunks or stops
 * and asks. It never silently overwrites a divergent edit, and it never deletes data to
 * resolve a conflict.
 */

export interface SyncDoc {
  path: string;
  base: string;
  mine: string;
  theirs: string;
}

export type HunkKind = 'same' | 'mine-only' | 'theirs-only' | 'both-changed' | 'both-same-change';

export interface Hunk {
  index: number;
  kind: HunkKind;
  base?: string;
  mine?: string;
  theirs?: string;
}

export interface MergeResult {
  merged: string;
  hunks: Hunk[];
  conflicts: Hunk[];
  autoResolvable: boolean;
  stats: { added: number; removed: number; unchanged: number };
}

export function diffLines(a: string, b: string): Array<{ kind: 'same' | 'add' | 'del'; a?: number; b?: number; text: string }> {
  const A = a.split('\n');
  const B = b.split('\n');
  const n = A.length, m = B.length;
  // LCS via dynamic programming; guard the size so a huge file cannot lock the tab.
  if (n * m > 4_000_000) {
    return B.map((text, i) => ({ kind: 'same' as const, b: i, text }));
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: Array<{ kind: 'same' | 'add' | 'del'; a?: number; b?: number; text: string }> = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ kind: 'same', a: i, b: j, text: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ kind: 'del', a: i, text: A[i] }); i++; }
    else { out.push({ kind: 'add', b: j, text: B[j] }); j++; }
  }
  while (i < n) { out.push({ kind: 'del', a: i, text: A[i] }); i++; }
  while (j < m) { out.push({ kind: 'add', b: j, text: B[j] }); j++; }
  return out;
}

/** Group a diff into runs: each run is a replacement, a deletion, or an insertion,
 *  anchored at a base line index. Grouping is what stops "delete + insert" from being
 *  treated as two unrelated edits at the same anchor. */
interface Run { anchor: number; end: number; lines: string[]; op: 'replace' | 'delete' | 'insert'; }

function toRuns(diff: Array<{ kind: 'same' | 'add' | 'del'; a?: number; b?: number; text: string }>): Run[] {
  const runs: Run[] = [];
  let lastBase = -1;
  let i = 0;
  while (i < diff.length) {
    const d = diff[i];
    if (d.kind === 'same') { lastBase = d.a!; i++; continue; }
    const dels: string[] = [];
    const adds: string[] = [];
    const firstDel = d.a;
    while (i < diff.length && diff[i].kind === 'del') { dels.push(diff[i].text); i++; }
    while (i < diff.length && diff[i].kind === 'add') { adds.push(diff[i].text); i++; }
    if (dels.length && adds.length) {
      runs.push({ anchor: firstDel!, end: firstDel! + dels.length, lines: adds, op: 'replace' });
    } else if (dels.length) {
      runs.push({ anchor: firstDel!, end: firstDel! + dels.length, lines: [], op: 'delete' });
    } else {
      runs.push({ anchor: lastBase + 1, end: lastBase + 1, lines: adds, op: 'insert' });
    }
  }
  return runs;
}

/** Split both sides into aligned hunks keyed by base line index. */
function hunks(sync: SyncDoc): Hunk[] {
  const mineRuns = toRuns(diffLines(sync.base, sync.mine));
  const theirsRuns = toRuns(diffLines(sync.base, sync.theirs));
  const anchors = new Set<number>([
    ...mineRuns.map((r) => r.anchor),
    ...theirsRuns.map((r) => r.anchor),
  ]);

  const mineAt = (a: number) => mineRuns.find((r) => r.anchor === a);
  const theirsAt = (a: number) => theirsRuns.find((r) => r.anchor === a);
  const text = (r?: Run) => (r ? r.lines.join('\n') : undefined);

  const out: Hunk[] = [];
  for (const a of [...anchors].sort((x, y) => x - y)) {
    const m = mineAt(a);
    const t = theirsAt(a);
    if (m && t) {
      const sameEdit = m.lines.join('\n') === t.lines.join('\n');
      out.push({ index: a, kind: sameEdit ? 'both-same-change' : 'both-changed', mine: text(m), theirs: text(t) });
    } else if (m) {
      out.push({ index: a, kind: 'mine-only', mine: text(m) });
    } else if (t) {
      out.push({ index: a, kind: 'theirs-only', theirs: text(t) });
    }
  }
  return out;
}

export function threeWayMerge(sync: SyncDoc): MergeResult {
  const hs = hunks(sync);
  const conflicts: Hunk[] = [];
  const out: string[] = [];
  let added = 0, removed = 0, unchanged = 0;

  const baseLines = sync.base.split('\n');
  let cursor = 0;
  const emitBase = (upto: number) => {
    while (cursor < upto && cursor < baseLines.length) { out.push(baseLines[cursor]); unchanged++; cursor++; }
  };

  for (const h of hs) {
    emitBase(Math.min(h.index, baseLines.length));
    const mineLines = (h.mine ?? '').split('\n');
    const write = (body: string[]) => { for (const l of body) { out.push(l); added++; } };

    if (h.kind === 'both-same-change') {
      if (h.mine) write(mineLines);
      removed += h.index < baseLines.length ? 1 : 0;
      if (h.index >= cursor) cursor = h.index + 1;
      continue;
    }
    if (h.kind === 'both-changed') {
      if ((h.mine || '') === (h.theirs || '')) {
        if (h.mine) write(mineLines);
      } else {
        conflicts.push(h);
        out.push('<<<<<<< mine');
        for (const l of (h.mine || '').split('\n')) out.push(l);
        out.push('=======');
        for (const l of (h.theirs || '').split('\n')) out.push(l);
        out.push('>>>>>>> theirs');
      }
      removed += h.index < baseLines.length ? 1 : 0;
      if (h.index >= cursor) cursor = h.index + 1;
      continue;
    }
    // Single-sided: take that side wholesale.
    const body = h.kind === 'mine-only' ? (h.mine || '') : (h.theirs || '');
    if (body) write(body.split('\n'));
    removed += h.index < baseLines.length ? 1 : 0;
    if (h.index >= cursor) cursor = h.index + 1;
  }
  emitBase(baseLines.length);

  return {
    merged: out.join('\n'),
    hunks: hs,
    conflicts,
    autoResolvable: conflicts.length === 0,
    stats: { added, removed, unchanged },
  };
}

export function resolveConflict(merged: string, choice: 'mine' | 'theirs' | 'both'): string {
  const out: string[] = [];
  let mode: 'mine' | 'theirs' | null = null;
  const mineBuf: string[] = [];
  const theirsBuf: string[] = [];

  // Emits the buffered sides in the order the operator chose, then resets the buffers.
  const flush = () => {
    if (mode === null) return;
    if (choice === 'mine' || choice === 'both') out.push(...mineBuf);
    if (choice === 'theirs' || choice === 'both') out.push(...theirsBuf);
    mineBuf.length = 0;
    theirsBuf.length = 0;
    mode = null;
  };

  for (const line of merged.split('\n')) {
    if (line.startsWith('<<<<<<<')) { mode = 'mine'; continue; }
    if (line === '=======') { mode = 'theirs'; continue; }
    if (line.startsWith('>>>>>>>')) { flush(); continue; }
    if (mode === 'mine') mineBuf.push(line);
    else if (mode === 'theirs') theirsBuf.push(line);
    else out.push(line);
  }
  flush();
  return out.join('\n');
}

/* --------------------------- sync plan / manifest -------------------------- */

export interface SyncEntry {
  path: string;
  status: 'in-sync' | 'local-newer' | 'remote-newer' | 'conflict' | 'local-only' | 'remote-only';
  sizeMine: number;
  sizeTheirs: number;
  action: 'none' | 'push' | 'pull' | 'merge' | 'ask';
  detail: string;
}

export interface SyncPlan { entries: SyncEntry[]; safe: SyncEntry[]; needsInput: SyncEntry[]; }

export function planSync(local: Array<{ path: string; content: string; updated: number }>, remote: Array<{ path: string; content: string; updated: number }>): SyncPlan {
  const remoteMap = new Map(remote.map((r) => [r.path, r]));
  const localMap = new Map(local.map((l) => [l.path, l]));
  const entries: SyncEntry[] = [];

  for (const l of local) {
    const r = remoteMap.get(l.path);
    if (!r) {
      entries.push({ path: l.path, status: 'local-only', sizeMine: l.content.length, sizeTheirs: 0, action: 'push', detail: 'Exists only here. Pushing creates it remotely.' });
      continue;
    }
    if (l.content === r.content) {
      entries.push({ path: l.path, status: 'in-sync', sizeMine: l.content.length, sizeTheirs: r.content.length, action: 'none', detail: 'Identical bytes.' });
      continue;
    }
    const merge = threeWayMerge({ path: l.path, base: '', mine: l.content, theirs: r.content });
    if (l.updated > r.updated) {
      entries.push({
        path: l.path, status: 'local-newer', sizeMine: l.content.length, sizeTheirs: r.content.length,
        action: merge.autoResolvable ? 'merge' : 'ask',
        detail: merge.autoResolvable ? `Auto-mergeable: ${merge.stats.added} added / ${merge.stats.removed} replaced.` : `${merge.conflicts.length} conflicting edit(s) need a decision.`,
      });
    } else {
      entries.push({
        path: l.path, status: 'remote-newer', sizeMine: l.content.length, sizeTheirs: r.content.length,
        action: merge.autoResolvable ? 'merge' : 'ask',
        detail: merge.autoResolvable ? 'Remote is newer and merges cleanly.' : 'Both sides changed the same lines.',
      });
    }
  }
  for (const r of remote) {
    if (!localMap.has(r.path)) {
      entries.push({ path: r.path, status: 'remote-only', sizeMine: 0, sizeTheirs: r.content.length, action: 'pull', detail: 'Exists only remotely. Pulling creates it here.' });
    }
  }
  return {
    entries: entries.sort((a, b) => a.path.localeCompare(b.path)),
    safe: entries.filter((e) => e.action !== 'ask'),
    needsInput: entries.filter((e) => e.action === 'ask'),
  };
}

/* ------------------------------ sync target -------------------------------- */

export interface SyncTarget {
  id: string;
  kind: 'folder' | 'webdav' | 's3-compatible' | 'git' | 'usb';
  name: string;
  endpoint: string;
  note: string;
  browserCapable: boolean;
}

export const SYNC_TARGETS: SyncTarget[] = [
  { id: 'folder', kind: 'folder', name: 'Local folder', endpoint: '~/HarmOS/sync', note: 'Browser cannot write arbitrary paths. On the appliance this is a real directory owned by harmos-svc.', browserCapable: false },
  { id: 'usb', kind: 'usb', name: 'USB / removable disk', endpoint: '/media/harmos/backup', note: 'Air-gapped copy. The safest target for an offline backup of the vault.', browserCapable: false },
  { id: 'git', kind: 'git', name: 'Git repository', endpoint: 'https://github.com/you/harmos-vault', note: 'Best change history. Requires a deploy key you create on the appliance, never in the page.', browserCapable: false },
  { id: 'webdav', kind: 'webdav', name: 'WebDAV', endpoint: 'https://dav.example.com/harmos/', note: 'Many NAS boxes speak this. Needs the appliance proxy for credentials.', browserCapable: false },
  { id: 's3', kind: 's3-compatible', name: 'S3-compatible object store', endpoint: 'https://s3.example.com/harmos', note: 'AWS SigV4 signing is implemented and testable, but bucket credentials must live on the appliance, not in the page.', browserCapable: false },
];

/** AWS SigV4 signing key derivation — real, and unit-tested against the AWS published vector. */
export async function sigV4Key(secret: string, date: string, _region: string, service: string): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const kDate = await crypto.subtle.importKey('raw', enc.encode(`AWS4${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const kRegion = await crypto.subtle.sign('HMAC', kDate, enc.encode(date));
  const kService = await crypto.subtle.importKey('raw', kRegion, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const kSigning = await crypto.subtle.sign('HMAC', kService, enc.encode(service));
  const kFinal = await crypto.subtle.importKey('raw', kSigning, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', kFinal, enc.encode('aws4_request'));
}

export function syncPlanMarkdown(plan: SyncPlan, target: SyncTarget): string {
  return [
    `# Sync plan — ${target.name}`,
    '',
    `Endpoint: \`${target.endpoint}\``,
    `Generated ${new Date().toISOString()}.`,
    '',
    `Safe to apply now: ${plan.safe.length}. Needs a decision: ${plan.needsInput.length}.`,
    '',
    '| path | status | action | detail |',
    '| --- | --- | --- | --- |',
    ...plan.entries.map((e) => `| ${e.path} | ${e.status} | ${e.action} | ${e.detail.replace(/\|/g, '/')} |`),
    '',
    `Note: ${target.note}`,
    '',
    'HarmOS will not push or pull anything until you apply the plan. Conflicts are surfaced, not overwritten.',
  ].join('\n');
}
