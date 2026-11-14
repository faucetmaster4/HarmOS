/* HarmOS Kernel — browser build.
 *
 * This is the authoritative state layer for the AetherFrame control surface. Every
 * mutation (file write, task transition, permission check, security event) happens
 * HERE, never in a component. UI components may only dispatch intents; they cannot
 * bypass a permission check by rendering a different button.
 *
 * Boundary note (honest): in the VirtualBox appliance this role is played by the
 * HarmOS Nexus sidecar (Node, out-of-process, running as the unprivileged harmos-svc
 * user, enforced additionally by systemd sandboxing). In this browser build the same
 * logic runs in-page against a persistent virtual filesystem backed by localStorage.
 * Anything that requires a real kernel (shell execution, raw process inspection,
 * host sockets) is reported as UNAVAILABLE rather than faked.
 */

export type Capability =
  | 'fs.read' | 'fs.write' | 'fs.delete' | 'fs.search'
  | 'vault.read' | 'vault.write' | 'secrets.read'
  | 'net.fetch' | 'shell.exec' | 'system.admin'
  | 'model.local' | 'model.cloud'
  | 'schedule.write' | 'agent.manage';

export type TaskState = 'PENDING' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type Provenance = 'verified' | 'user' | 'model' | 'inferred';
export type Severity = 'info' | 'warn' | 'deny' | 'critical';

export interface VNode {
  path: string;
  kind: 'file' | 'dir';
  content: string;
  createdAt: number;
  updatedAt: number;
  author: string;
  provenance: Provenance;
  sha: string;
}

export interface TaskStep {
  at: number;
  kind: 'plan' | 'tool' | 'model' | 'note' | 'error' | 'permission' | 'state';
  label: string;
  detail?: string;
  ok?: boolean;
  ms?: number;
}

export interface Task {
  id: string;
  title: string;
  prompt: string;
  agentId: string;
  state: TaskState;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  steps: TaskStep[];
  outputs: string[];
  error?: string;
  cancelRequested?: boolean;
  workflowId?: string;
  dependsOn?: string[];
  tokens?: { in: number; out: number; costUsd?: number; source: string };
}

export interface AuditEvent {
  id: string;
  at: number;
  severity: Severity;
  actor: string;
  action: string;
  detail: string;
}

export interface MemoryEntry {
  id: string;
  agentId: string;
  text: string;
  provenance: Provenance;
  source: string;
  scope: 'agent' | 'global';
  at: number;
}

export interface AgentPermissions {
  caps: Capability[];
  roots: string[];           // path prefixes this agent may touch
  requireApproval: Capability[];
  networkModels: boolean;    // may this agent use a cloud model
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  summary: string;
  accent: string;
  glyph: string;
  enabled: boolean;
  revoked: boolean;
  model: string;             // '' = inherit default
  permissions: AgentPermissions;
  workingDir: string;
}

export interface ApprovalRequest {
  id: string;
  at: number;
  agentId: string;
  taskId: string;
  cap: Capability;
  target: string;
  reason: string;
  resolved?: 'approved' | 'denied';
}

export interface Settings {
  processing: 'local-first' | 'cloud-allowed' | 'offline-only';
  lowResource: boolean;
  maxConcurrent: number;
  motion: boolean;
  retentionDays: number;
  telemetry: false;          // HarmOS ships no telemetry. Typed as literal false.
  voiceEnabled: boolean;
  onboarded: boolean;
  accent: 'cyan' | 'violet' | 'amber';
}

export interface ProviderConfig {
  id: string;
  kind: 'ollama' | 'openai-compatible' | 'anthropic' | 'google' | 'openrouter';
  label: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;           // the key itself is NEVER stored in kernel state
  reachable: 'unknown' | 'yes' | 'no';
  lastChecked?: number;
  note?: string;
}

export interface KernelState {
  bootedAt: number;
  vfs: Record<string, VNode>;
  tasks: Task[];
  agents: Agent[];
  audit: AuditEvent[];
  memory: MemoryEntry[];
  approvals: ApprovalRequest[];
  settings: Settings;
  providers: ProviderConfig[];
  activeProvider: string;
  dimStatus: Record<number, 'ok' | 'degraded' | 'offline'>;
  plugins: Record<string, { enabled: boolean; health: 'ok' | 'error' | 'unknown'; error?: string }>;
}

/* ------------------------------------------------------------------ utils */

export const uid = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;

/** Non-cryptographic content fingerprint (FNV-1a). Used for integrity *change
 *  detection* in the browser build — explicitly not a security hash. KaliOS on the
 *  appliance uses sha256sum via coreutils. */
export function fingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return 'fnv1a:' + h.toString(16).padStart(8, '0');
}

const SECRET_PATTERNS: RegExp[] = [
  /sk-or-v1-[A-Za-z0-9]{8,}/g,
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /sk-[A-Za-z0-9]{16,}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /(?<=(api[_-]?key|token|password|secret)["'\s:=]{1,6})[A-Za-z0-9_\-.]{16,}/gi,
];

/** KaliOS secret redaction. Applied to every string that enters a log, a task step,
 *  a memory entry or an exported file. */
export function redact(input: string): string {
  let out = String(input ?? '');
  for (const re of SECRET_PATTERNS) out = out.replace(re, (m) => m.slice(0, 4) + '…[redacted:' + m.length + ']');
  return out;
}

export function normPath(p: string): string {
  const parts = String(p || '').replace(/\\/g, '/').split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') { stack.pop(); continue; }   // no traversal above root
    stack.push(part);
  }
  return '/' + stack.join('/');
}

export class PermissionDenied extends Error {
  constructor(public cap: Capability, public target: string, public agentId: string) {
    super(`PermissionDenied: ${agentId} lacks ${cap} for ${target}`);
    this.name = 'PermissionDenied';
  }
}

/* ------------------------------------------------------------------ store */

const STORAGE_KEY = 'harmos.kernel.v1';
const VERSION = '0.1.0-alpha';

type Listener = () => void;

function dirNode(path: string, author = 'harmos'): VNode {
  const now = Date.now();
  return { path, kind: 'dir', content: '', createdAt: now, updatedAt: now, author, provenance: 'verified', sha: fingerprint(path) };
}

function fileNode(path: string, content: string, author: string, provenance: Provenance): VNode {
  const now = Date.now();
  return { path, kind: 'file', content, createdAt: now, updatedAt: now, author, provenance, sha: fingerprint(content) };
}

export const DEFAULT_SETTINGS: Settings = {
  processing: 'local-first',
  lowResource: false,
  maxConcurrent: 2,
  motion: true,
  retentionDays: 90,
  telemetry: false,
  voiceEnabled: false,
  onboarded: false,
  accent: 'cyan',
};

export class Kernel {
  state: KernelState;
  private listeners = new Set<Listener>();
  private running = new Set<string>();
  private pump: number | null = null;
  /** Secrets live here only — never in `state`, never serialised to storage by the
   *  kernel, never included in exports or task logs. */
  private secrets = new Map<string, string>();
  private executor: ((task: Task, k: Kernel) => Promise<void>) | null = null;
  lagMs = 0;

  constructor(seed: { agents: Agent[]; files: Array<[string, string]> }) {
    const restored = this.load();
    if (restored) {
      this.state = restored;
      // agent definitions may gain fields across versions: merge forward
      const byId = new Map(restored.agents.map((a) => [a.id, a]));
      this.state.agents = seed.agents.map((def) => ({ ...def, ...(byId.get(def.id) || {}) }));
    } else {
      const vfs: Record<string, VNode> = {};
      for (const d of ['/home/harmos', '/home/harmos/HarmOS', '/home/harmos/HarmOS/workspace',
        '/home/harmos/HarmOS/outbox', '/home/harmos/HarmOS/notes', '/var/lib/harmos', '/var/log/harmos']) {
        vfs[d] = dirNode(d);
      }
      for (const [p, c] of seed.files) vfs[normPath(p)] = fileNode(normPath(p), c, 'harmos', 'verified');
      this.state = {
        bootedAt: Date.now(), vfs, tasks: [], agents: seed.agents, audit: [], memory: [], approvals: [],
        settings: { ...DEFAULT_SETTINGS }, providers: [], activeProvider: '', dimStatus: {}, plugins: {},
      };
      this.log('info', 'kernel', 'boot', `HarmOS ${VERSION} kernel initialised (fresh state)`);
    }
    this.measureLag();
  }

  /* ---------------- persistence ---------------- */
  private load(): KernelState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as KernelState;
      if (!parsed.vfs || !parsed.settings) return null;
      parsed.settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
      // Any task that was mid-flight when the session ended did not survive: be honest.
      parsed.tasks = (parsed.tasks || []).map((t) =>
        t.state === 'RUNNING' || t.state === 'QUEUED'
          ? { ...t, state: 'FAILED' as TaskState, error: 'Interrupted by session restart (state restored from disk).', endedAt: Date.now() }
          : t);
      return parsed;
    } catch { return null; }
  }

  save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state)); }
    catch (e) { this.log('warn', 'kernel', 'persist.fail', String(e)); }
  }

  subscribe = (fn: Listener) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.state;

  commit(mut: (s: KernelState) => void) {
    mut(this.state);
    this.state = { ...this.state };
    this.save();
    for (const l of this.listeners) l();
  }

  /* ---------------- audit ---------------- */
  log(severity: Severity, actor: string, action: string, detail: string) {
    const ev: AuditEvent = { id: uid('ev'), at: Date.now(), severity, actor, action, detail: redact(detail).slice(0, 600) };
    this.commit((s) => { s.audit = [ev, ...s.audit].slice(0, 500); });
    return ev;
  }

  /* ---------------- permissions (enforced here, not in the UI) ---------------- */
  agent(id: string): Agent | undefined { return this.state.agents.find((a) => a.id === id); }

  authorize(agentId: string, cap: Capability, target = '-'): true {
    const a = this.agent(agentId);
    if (!a) { this.log('deny', agentId, 'authorize', `unknown agent requested ${cap}`); throw new PermissionDenied(cap, target, agentId); }
    if (a.revoked) { this.log('deny', a.name, 'authorize', `revoked agent requested ${cap}`); throw new PermissionDenied(cap, target, agentId); }
    if (!a.enabled) { this.log('deny', a.name, 'authorize', `disabled agent requested ${cap}`); throw new PermissionDenied(cap, target, agentId); }
    if (!a.permissions.caps.includes(cap)) {
      this.log('deny', a.name, 'authorize', `capability ${cap} not granted (target ${target})`);
      throw new PermissionDenied(cap, target, agentId);
    }
    if (target.startsWith('/')) {
      const p = normPath(target);
      if (!a.permissions.roots.some((r) => p === normPath(r) || p.startsWith(normPath(r) + '/'))) {
        this.log('deny', a.name, 'authorize', `path ${p} is outside granted roots [${a.permissions.roots.join(', ')}]`);
        throw new PermissionDenied(cap, p, agentId);
      }
    }
    if (cap === 'model.cloud') {
      if (this.state.settings.processing === 'offline-only') {
        this.log('deny', a.name, 'authorize', 'cloud model blocked: processing mode is offline-only');
        throw new PermissionDenied(cap, target, agentId);
      }
      if (!a.permissions.networkModels) {
        this.log('deny', a.name, 'authorize', 'cloud model blocked: agent is not permitted network-backed models');
        throw new PermissionDenied(cap, target, agentId);
      }
    }
    return true;
  }

  needsApproval(agentId: string, cap: Capability) {
    const a = this.agent(agentId);
    return !!a && a.permissions.requireApproval.includes(cap);
  }

  requestApproval(req: Omit<ApprovalRequest, 'id' | 'at'>): Promise<boolean> {
    const full: ApprovalRequest = { ...req, id: uid('ap'), at: Date.now() };
    this.commit((s) => { s.approvals = [full, ...s.approvals].slice(0, 50); });
    this.log('warn', this.agent(req.agentId)?.name || req.agentId, 'approval.request', `${req.cap} → ${req.target}: ${req.reason}`);
    return new Promise((resolve) => {
      const stop = this.subscribe(() => {
        const cur = this.state.approvals.find((x) => x.id === full.id);
        if (cur?.resolved) { stop(); resolve(cur.resolved === 'approved'); }
      });
      // Auto-deny after 3 minutes so a task can never hang forever awaiting a human.
      setTimeout(() => {
        const cur = this.state.approvals.find((x) => x.id === full.id);
        if (cur && !cur.resolved) { this.resolveApproval(full.id, 'denied', 'timed out'); }
      }, 180000);
    });
  }

  resolveApproval(id: string, decision: 'approved' | 'denied', note = '') {
    this.commit((s) => { s.approvals = s.approvals.map((a) => (a.id === id ? { ...a, resolved: decision } : a)); });
    this.log(decision === 'approved' ? 'info' : 'deny', 'operator', 'approval.' + decision, `${id} ${note}`);
  }

  /* ---------------- virtual filesystem (Sovereign Vault) ---------------- */
  list(prefix = '/'): VNode[] {
    const p = normPath(prefix);
    return Object.values(this.state.vfs)
      .filter((n) => n.path !== p && (p === '/' ? true : n.path.startsWith(p + '/')))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  read(agentId: string, path: string): string {
    const p = normPath(path);
    this.authorize(agentId, 'fs.read', p);
    const n = this.state.vfs[p];
    if (!n || n.kind !== 'file') throw new Error(`ENOENT: no such file ${p}`);
    return n.content;
  }

  write(agentId: string, path: string, content: string, provenance: Provenance = 'model'): VNode {
    const p = normPath(path);
    this.authorize(agentId, 'fs.write', p);
    const author = this.agent(agentId)?.name || agentId;
    const prev = this.state.vfs[p];
    const node: VNode = prev && prev.kind === 'file'
      ? { ...prev, content, updatedAt: Date.now(), author, provenance, sha: fingerprint(content) }
      : fileNode(p, content, author, provenance);
    this.commit((s) => {
      // materialise parent directories
      const segs = p.split('/').filter(Boolean); segs.pop();
      let acc = '';
      for (const seg of segs) { acc += '/' + seg; if (!s.vfs[acc]) s.vfs[acc] = dirNode(acc, author); }
      s.vfs[p] = node;
    });
    this.log('info', author, 'fs.write', `${p} (${content.length} bytes, provenance=${provenance})`);
    return node;
  }

  remove(agentId: string, path: string) {
    const p = normPath(path);
    this.authorize(agentId, 'fs.delete', p);
    if (!this.state.vfs[p]) throw new Error(`ENOENT: ${p}`);
    this.commit((s) => { delete s.vfs[p]; for (const k of Object.keys(s.vfs)) if (k.startsWith(p + '/')) delete s.vfs[k]; });
    this.log('warn', this.agent(agentId)?.name || agentId, 'fs.delete', p);
  }

  search(agentId: string, query: string): Array<{ path: string; line: number; text: string }> {
    this.authorize(agentId, 'fs.search');
    const q = query.toLowerCase().trim();
    if (!q) return [];
    const out: Array<{ path: string; line: number; text: string }> = [];
    const roots = this.agent(agentId)!.permissions.roots.map(normPath);
    for (const n of Object.values(this.state.vfs)) {
      if (n.kind !== 'file') continue;
      if (!roots.some((r) => n.path.startsWith(r))) continue;
      n.content.split('\n').forEach((line, i) => {
        if (line.toLowerCase().includes(q) && out.length < 60) out.push({ path: n.path, line: i + 1, text: line.trim().slice(0, 180) });
      });
    }
    return out;
  }

  /* ---------------- secrets (never in state / never exported) ---------------- */
  setSecret(providerId: string, key: string) {
    if (!key) { this.secrets.delete(providerId); } else { this.secrets.set(providerId, key); }
    this.commit((s) => { s.providers = s.providers.map((p) => (p.id === providerId ? { ...p, hasKey: !!key } : p)); });
    this.log('info', 'operator', 'secret.set', `credential for provider ${providerId} ${key ? 'stored in volatile kernel memory (not persisted)' : 'cleared'}`);
  }
  getSecret(providerId: string) { return this.secrets.get(providerId) || ''; }
  hasSecret(providerId: string) { return this.secrets.has(providerId); }
  secretCount() { return this.secrets.size; }

  /* ---------------- memory ---------------- */
  remember(agentId: string, text: string, provenance: Provenance, source: string, scope: 'agent' | 'global' = 'agent') {
    const e: MemoryEntry = { id: uid('mem'), agentId, text: redact(text).slice(0, 2000), provenance, source, scope, at: Date.now() };
    this.commit((s) => { s.memory = [e, ...s.memory].slice(0, 400); });
    return e;
  }
  forget(id: string) { this.commit((s) => { s.memory = s.memory.filter((m) => m.id !== id); }); this.log('warn', 'operator', 'memory.delete', id); }

  /* ---------------- task lifecycle ---------------- */
  setExecutor(fn: (task: Task, k: Kernel) => Promise<void>) { this.executor = fn; }

  submit(agentId: string, prompt: string, opts: Partial<Task> = {}): Task {
    const agent = this.agent(agentId);
    const task: Task = {
      id: uid('task'),
      title: opts.title || prompt.slice(0, 72),
      prompt, agentId, state: 'PENDING', createdAt: Date.now(),
      steps: [{ at: Date.now(), kind: 'state', label: 'PENDING', detail: 'accepted by HarmOS Nexus' }],
      outputs: [], ...opts,
    };
    if (!agent || agent.revoked || !agent.enabled) {
      task.state = 'FAILED';
      task.error = !agent ? 'Unknown agent.' : agent.revoked ? 'Agent revoked by operator (ESAI).' : 'Agent disabled.';
      task.endedAt = Date.now();
      this.commit((s) => { s.tasks = [task, ...s.tasks].slice(0, 200); });
      this.log('deny', agentId, 'task.reject', task.error);
      return task;
    }
    this.commit((s) => { s.tasks = [task, ...s.tasks].slice(0, 200); });
    this.transition(task.id, 'QUEUED', 'waiting for an execution slot');
    this.schedule();
    return this.state.tasks.find((t) => t.id === task.id)!;
  }

  transition(id: string, state: TaskState, detail = '') {
    this.commit((s) => {
      s.tasks = s.tasks.map((t) => {
        if (t.id !== id) return t;
        const next: Task = { ...t, state, steps: [...t.steps, { at: Date.now(), kind: 'state', label: state, detail }] };
        if (state === 'RUNNING') next.startedAt = Date.now();
        if (state === 'COMPLETED' || state === 'FAILED' || state === 'CANCELLED') next.endedAt = Date.now();
        return next;
      });
    });
    const t = this.state.tasks.find((x) => x.id === id);
    this.log(state === 'FAILED' ? 'warn' : 'info', this.agent(t?.agentId || '')?.name || 'nexus', 'task.' + state.toLowerCase(), `${t?.title || id}${detail ? ' — ' + detail : ''}`);
  }

  step(id: string, step: Omit<TaskStep, 'at'>) {
    this.commit((s) => {
      s.tasks = s.tasks.map((t) => (t.id === id
        ? { ...t, steps: [...t.steps, { at: Date.now(), ...step, detail: step.detail ? redact(step.detail) : undefined }] }
        : t));
    });
  }

  addOutput(id: string, path: string) {
    this.commit((s) => { s.tasks = s.tasks.map((t) => (t.id === id && !t.outputs.includes(path) ? { ...t, outputs: [...t.outputs, path] } : t)); });
  }

  cancel(id: string) {
    const t = this.state.tasks.find((x) => x.id === id);
    if (!t) return;
    if (t.state === 'QUEUED' || t.state === 'PENDING') { this.transition(id, 'CANCELLED', 'cancelled before execution'); return; }
    if (t.state === 'RUNNING') {
      this.commit((s) => { s.tasks = s.tasks.map((x) => (x.id === id ? { ...x, cancelRequested: true } : x)); });
      this.step(id, { kind: 'note', label: 'cancel requested', detail: 'the executor stops at the next checkpoint' });
    }
  }

  /** ESAI emergency stop: cancel everything in flight. */
  haltAll(reason = 'operator emergency stop') {
    const live = this.state.tasks.filter((t) => t.state === 'RUNNING' || t.state === 'QUEUED' || t.state === 'PENDING');
    live.forEach((t) => this.cancel(t.id));
    this.log('critical', 'operator', 'esai.halt', `${reason} — ${live.length} task(s) signalled`);
  }

  isCancelled(id: string) {
    const t = this.state.tasks.find((x) => x.id === id);
    return !!t?.cancelRequested || t?.state === 'CANCELLED';
  }

  private schedule() {
    if (this.pump !== null) return;
    this.pump = window.setTimeout(() => { this.pump = null; this.drain(); }, 0);
  }

  private async drain() {
    const limit = this.state.settings.lowResource ? 1 : Math.max(1, this.state.settings.maxConcurrent);
    while (this.running.size < limit) {
      const next = [...this.state.tasks].reverse().find((t) => t.state === 'QUEUED' && this.depsSatisfied(t));
      if (!next) break;
      this.running.add(next.id);
      this.transition(next.id, 'RUNNING', `slot ${this.running.size}/${limit}`);
      const exec = this.executor;
      (async () => {
        try {
          if (!exec) throw new Error('No executor registered on the kernel.');
          await exec(this.state.tasks.find((t) => t.id === next.id)!, this);
          if (this.isCancelled(next.id)) this.transition(next.id, 'CANCELLED', 'stopped at checkpoint');
          else if (this.state.tasks.find((t) => t.id === next.id)?.state === 'RUNNING') this.transition(next.id, 'COMPLETED', 'executor returned');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.commit((s) => { s.tasks = s.tasks.map((t) => (t.id === next.id ? { ...t, error: redact(msg) } : t)); });
          this.step(next.id, { kind: 'error', label: 'execution error', detail: msg, ok: false });
          if (!this.isCancelled(next.id)) this.transition(next.id, 'FAILED', msg.slice(0, 160));
          else this.transition(next.id, 'CANCELLED', 'cancelled during failure handling');
        } finally {
          this.running.delete(next.id);
          this.schedule();
        }
      })();
    }
  }

  private depsSatisfied(t: Task) {
    if (!t.dependsOn?.length) return true;
    return t.dependsOn.every((d) => this.state.tasks.find((x) => x.id === d)?.state === 'COMPLETED');
  }

  runningCount() { return this.running.size; }
  queueDepth() { return this.state.tasks.filter((t) => t.state === 'QUEUED').length; }

  /* ---------------- settings / providers ---------------- */
  updateSettings(patch: Partial<Settings>) {
    this.commit((s) => { s.settings = { ...s.settings, ...patch }; });
    this.log('info', 'operator', 'settings.update', Object.keys(patch).join(', '));
  }

  upsertProvider(p: ProviderConfig) {
    this.commit((s) => {
      const i = s.providers.findIndex((x) => x.id === p.id);
      if (i >= 0) s.providers[i] = { ...s.providers[i], ...p };
      else s.providers = [...s.providers, p];
      if (!s.activeProvider) s.activeProvider = p.id;
    });
  }
  removeProvider(id: string) {
    this.secrets.delete(id);
    this.commit((s) => {
      s.providers = s.providers.filter((p) => p.id !== id);
      if (s.activeProvider === id) s.activeProvider = s.providers[0]?.id || '';
    });
    this.log('warn', 'operator', 'provider.remove', id);
  }
  activeProvider(): ProviderConfig | undefined {
    return this.state.providers.find((p) => p.id === this.state.activeProvider);
  }

  updateAgent(id: string, patch: Partial<Agent>) {
    this.commit((s) => { s.agents = s.agents.map((a) => (a.id === id ? { ...a, ...patch, permissions: { ...a.permissions, ...(patch.permissions || {}) } } : a)); });
    this.log('info', 'operator', 'agent.update', `${id}: ${Object.keys(patch).join(', ')}`);
  }

  /* ---------------- data sovereignty (ESAI) ---------------- */
  exportAll(): string {
    this.log('info', 'operator', 'esai.export', 'full state export requested');
    const clone = JSON.parse(JSON.stringify(this.state)) as KernelState;
    // Export never carries credentials, and every string is redacted on the way out.
    clone.providers = clone.providers.map((p) => ({ ...p, hasKey: false }));
    const json = JSON.stringify({ harmos: VERSION, exportedAt: new Date().toISOString(), state: clone }, null, 2);
    return redact(json);
  }

  wipe(scope: 'memory' | 'tasks' | 'audit' | 'files' | 'everything') {
    this.commit((s) => {
      if (scope === 'memory' || scope === 'everything') s.memory = [];
      if (scope === 'tasks' || scope === 'everything') s.tasks = [];
      if (scope === 'audit' || scope === 'everything') s.audit = [];
      if (scope === 'files' || scope === 'everything') {
        for (const k of Object.keys(s.vfs)) if (k.startsWith('/home/harmos/HarmOS/')) delete s.vfs[k];
      }
    });
    this.log('critical', 'operator', 'esai.wipe', `scope=${scope}`);
  }

  /* ---------------- observability ---------------- */
  private measureLag() {
    let last = performance.now();
    window.setInterval(() => {
      const now = performance.now();
      this.lagMs = Math.max(0, Math.round(now - last - 500));
      last = now;
    }, 500);
  }

  vfsBytes() { return Object.values(this.state.vfs).reduce((n, v) => n + v.content.length, 0); }
}

export const VERSION_STRING = VERSION;
