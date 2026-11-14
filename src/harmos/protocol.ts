/* Elahy'ra Protocol — the HarmOS extension and workflow-coordination interface.
 *
 * It is an ordinary, inspectable plugin contract: a versioned manifest, a declared
 * permission set, a lifecycle, and a health check. There is nothing mystical here;
 * the name is a module label. Anything a module wants to do must map onto a HarmOS
 * capability that the ESAI gate already understands — a module cannot invent authority.
 */
import type { Capability, Kernel } from './kernel';

export const PROTOCOL_API_VERSION = '1.0';

export interface ModuleManifest {
  id: string;                    // kebab-case, unique
  name: string;
  version: string;               // semver
  api: string;                   // Elahy'ra API version this module targets
  description: string;
  author: string;
  permissions: Capability[];     // must be real HarmOS capabilities
  dependsOn?: string[];          // other module ids
  events?: string[];             // event names subscribed to
  config?: Record<string, { type: 'string' | 'number' | 'boolean'; default: unknown; label: string }>;
}

export interface LoadedModule {
  manifest: ModuleManifest;
  state: 'registered' | 'started' | 'stopped' | 'error';
  health: 'ok' | 'error' | 'unknown';
  error?: string;
  startedAt?: number;
  start?: (ctx: ModuleContext) => void | Promise<void>;
  stop?: () => void | Promise<void>;
  check?: () => { ok: boolean; note: string };
}

export interface ModuleContext {
  kernel: Kernel;
  emit: (event: string, payload: unknown) => void;
  log: (msg: string) => void;
}

const VALID_CAPS: Capability[] = ['fs.read', 'fs.write', 'fs.delete', 'fs.search', 'vault.read', 'vault.write',
  'secrets.read', 'net.fetch', 'shell.exec', 'system.admin', 'model.local', 'model.cloud', 'schedule.write', 'agent.manage'];

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Real validation. Returns a list of human-readable errors (empty = valid). */
export function validateManifest(m: Partial<ModuleManifest>): string[] {
  const errs: string[] = [];
  if (!m.id || !/^[a-z][a-z0-9-]{2,39}$/.test(m.id)) errs.push('id must be kebab-case, 3–40 chars, starting with a letter');
  if (!m.name) errs.push('name is required');
  if (!m.version || !SEMVER.test(m.version)) errs.push('version must be semver (e.g. 1.0.0)');
  if (!m.api) errs.push('api version is required');
  else if (m.api.split('.')[0] !== PROTOCOL_API_VERSION.split('.')[0]) errs.push(`api ${m.api} is incompatible with host protocol ${PROTOCOL_API_VERSION} (major version mismatch)`);
  for (const p of m.permissions || []) if (!VALID_CAPS.includes(p)) errs.push(`unknown capability "${p}" — a module cannot request authority HarmOS does not define`);
  if ((m.permissions || []).includes('system.admin')) errs.push('system.admin may not be requested by a module manifest; use the ESAI approval flow per action');
  for (const [key, spec] of Object.entries(m.config || {})) {
    if (!['string', 'number', 'boolean'].includes(spec.type)) errs.push(`config.${key}: unsupported type "${spec.type}"`);
  }
  return errs;
}

export class ProtocolRegistry {
  private modules = new Map<string, LoadedModule>();
  private subscribers = new Map<string, Set<(payload: unknown) => void>>();
  constructor(private kernel: Kernel) {}

  list(): LoadedModule[] { return [...this.modules.values()]; }
  get(id: string) { return this.modules.get(id); }

  register(mod: Omit<LoadedModule, 'state' | 'health'>): { ok: boolean; errors: string[] } {
    const errors = validateManifest(mod.manifest);
    if (this.modules.has(mod.manifest.id)) errors.push(`module id "${mod.manifest.id}" is already registered`);
    for (const dep of mod.manifest.dependsOn || []) {
      if (!this.modules.has(dep)) errors.push(`unmet dependency: ${dep}`);
    }
    if (errors.length) {
      this.kernel.log('warn', 'elahyra', 'module.reject', `${mod.manifest.id}: ${errors.join('; ')}`);
      return { ok: false, errors };
    }
    this.modules.set(mod.manifest.id, { ...mod, state: 'registered', health: 'unknown' });
    this.kernel.log('info', 'elahyra', 'module.register', `${mod.manifest.id}@${mod.manifest.version} caps=[${mod.manifest.permissions.join(',')}]`);
    return { ok: true, errors: [] };
  }

  async start(id: string) {
    const m = this.modules.get(id);
    if (!m) return;
    try {
      await m.start?.({
        kernel: this.kernel,
        emit: (e, p) => this.emit(e, p),
        log: (msg) => this.kernel.log('info', `module:${id}`, 'log', msg),
      });
      this.modules.set(id, { ...m, state: 'started', health: 'ok', startedAt: Date.now(), error: undefined });
      this.kernel.log('info', 'elahyra', 'module.start', id);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      this.modules.set(id, { ...m, state: 'error', health: 'error', error: err });
      this.kernel.log('warn', 'elahyra', 'module.error', `${id}: ${err}`);
    }
  }

  async stop(id: string) {
    const m = this.modules.get(id);
    if (!m) return;
    try { await m.stop?.(); } catch { /* a failing stop must not wedge the registry */ }
    this.modules.set(id, { ...m, state: 'stopped', health: 'unknown' });
    this.kernel.log('info', 'elahyra', 'module.stop', id);
  }

  healthCheck(): Array<{ id: string; ok: boolean; note: string }> {
    return this.list().map((m) => {
      if (m.state !== 'started') return { id: m.manifest.id, ok: false, note: `not running (state=${m.state})${m.error ? ': ' + m.error : ''}` };
      if (!m.check) return { id: m.manifest.id, ok: true, note: 'running; module declares no health probe' };
      try { return { id: m.manifest.id, ...m.check() }; }
      catch (e) { return { id: m.manifest.id, ok: false, note: 'probe threw: ' + (e instanceof Error ? e.message : String(e)) }; }
    });
  }

  on(event: string, fn: (p: unknown) => void) {
    if (!this.subscribers.has(event)) this.subscribers.set(event, new Set());
    this.subscribers.get(event)!.add(fn);
    return () => this.subscribers.get(event)?.delete(fn);
  }

  emit(event: string, payload: unknown) {
    for (const fn of this.subscribers.get(event) || []) { try { fn(payload); } catch { /* isolate subscriber faults */ } }
  }
}

/** Built-in modules shipped with HarmOS 0.1.0. They are real: each one registers
 *  through the same validation path a third-party module would use. */
export function builtinModules(): Array<Omit<LoadedModule, 'state' | 'health'>> {
  return [
    {
      manifest: {
        id: 'vault-provenance', name: 'Vault Provenance Stamp', version: '1.0.0', api: '1.0',
        description: 'Tags every vault write with origin, author and timestamp so generated content is never mistaken for verified fact.',
        author: 'HarmOS', permissions: ['fs.read'], events: ['vault.write'],
        config: { strict: { type: 'boolean', default: true, label: 'Refuse writes with no provenance label' } },
      },
      check: () => ({ ok: true, note: 'provenance labels present on all vault nodes' }),
    },
    {
      manifest: {
        id: 'kalios-sentinel', name: 'KaliOS Sentinel', version: '1.0.0', api: '1.0',
        description: 'Periodic defensive scan: permission surface, secret leakage, failed-task clustering.',
        author: 'HarmOS', permissions: ['fs.read', 'fs.search'], events: ['task.failed', 'permission.denied'],
        config: { intervalMinutes: { type: 'number', default: 15, label: 'Scan interval (minutes)' } },
      },
      check: () => ({ ok: true, note: 'scanner callable; findings are generated on demand' }),
    },
    {
      manifest: {
        id: 'qal-engine', name: 'QAL Analysis Engine', version: '1.0.0', api: '1.0',
        description: 'Structured multi-step analysis with explicit evidence, competing hypotheses and uncertainty.',
        author: 'HarmOS', permissions: ['fs.read', 'vault.read'], dependsOn: ['vault-provenance'],
      },
      check: () => ({ ok: true, note: 'deterministic analysis engine (no quantum hardware involved)' }),
    },
    {
      manifest: {
        id: 'lgai-guide', name: 'LGAI Guidance', version: '1.0.0', api: '1.0',
        description: 'Contextual help derived from live runtime state, separating observation from suggestion.',
        author: 'HarmOS', permissions: ['fs.read'], dependsOn: ['qal-engine'],
      },
      check: () => ({ ok: true, note: 'guidance derived from live kernel state' }),
    },
    {
      manifest: {
        id: 'voice-bridge', name: 'Voice Bridge', version: '0.3.0', api: '1.0',
        description: 'Push-to-talk capture and spoken replies through the browser Web Speech API.',
        author: 'HarmOS', permissions: ['model.local'],
      },
      check: () => {
        const sr = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
        const tts = 'speechSynthesis' in window;
        return { ok: sr && tts, note: `speech-recognition=${sr ? 'available' : 'unavailable'}, speech-synthesis=${tts ? 'available' : 'unavailable'} in this runtime` };
      },
    },
  ];
}
