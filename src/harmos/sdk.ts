/* HarmOS Extension SDK — the public surface third-party modules program against.
 *
 * A module is a manifest plus a factory. The host validates the manifest, checks API
 * version compatibility, hands the module a *scoped* capability object, and can revoke
 * that object at any time. Anything a module does is written to the audit log with the
 * module's id, so "which extension wrote this file" always has an answer.
 */

export const SDK_VERSION = '1.0.0';

/** Modules are compatible with the same major and an equal-or-lower minor. */
export function apiCompatible(wants: string): { ok: boolean; reason: string } {
  const [wm, wmi] = wants.split('.').map(Number);
  const [hm, hmi] = SDK_VERSION.split('.').map(Number);
  if (!Number.isFinite(wm) || !Number.isFinite(hm)) return { ok: false, reason: `malformed version "${wants}"` };
  if (wm !== hm) return { ok: false, reason: `module wants API ${wants}, host provides ${SDK_VERSION} (major differs)` };
  if (wmi > hmi) return { ok: false, reason: `module wants API ${wants}, host provides ${SDK_VERSION} (minor newer than host)` };
  return { ok: true, reason: `module API ${wants} satisfied by host ${SDK_VERSION}` };
}

export type Capability =
  | 'vault:read'
  | 'vault:write'
  | 'network:fetch'
  | 'ui:panel'
  | 'ui:command'
  | 'schedule:create'
  | 'notify';

export const KNOWN_CAPABILITIES: Capability[] = ['vault:read', 'vault:write', 'network:fetch', 'ui:panel', 'ui:command', 'schedule:create', 'notify'];

export interface ModuleManifest {
  id: string;
  name: string;
  version: string;              // semver
  apiVersion: string;           // SDK API the module was written against
  author: string;
  description: string;
  capabilities: Capability[];
  entry: string;
  homepage?: string;
  license?: string;
  minHostVersion?: string;
  permissionsJustification?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const SEMVER = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;

export function validateManifest(m: ModuleManifest): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!m || typeof m !== 'object') return { ok: false, errors: ['manifest is not an object'], warnings };
  if (!m.id) errors.push('id is required');
  else if (!/^[a-z0-9][a-z0-9._-]{2,40}$/.test(m.id)) errors.push(`id "${m.id}" must be lowercase, 3-41 chars, matching [a-z0-9][a-z0-9._-]`);
  if (!m.name) errors.push('name is required');
  if (!SEMVER.test(m.version || '')) errors.push(`version "${m.version}" is not semver (expected 1.2.3)`);
  if (!m.apiVersion) errors.push('apiVersion is required');
  else {
    const c = apiCompatible(m.apiVersion);
    if (!c.ok) errors.push(c.reason);
  }
  if (!m.author) errors.push('author is required');
  if (!m.description || m.description.length < 10) errors.push('description must be at least 10 characters');
  if (!m.entry) errors.push('entry is required');
  if (!Array.isArray(m.capabilities) || m.capabilities.length === 0) errors.push('capabilities must be a non-empty array');
  else {
    for (const c of m.capabilities) {
      if (!KNOWN_CAPABILITIES.includes(c)) errors.push(`unknown capability "${String(c)}"`);
    }
    if (new Set(m.capabilities).size !== m.capabilities.length) errors.push('duplicate capability declared');
  }
  if (m.capabilities?.includes('network:fetch') && !m.permissionsJustification) {
    warnings.push('network:fetch without a permissionsJustification — users deserve to know where their data goes');
  }
  if (m.capabilities?.includes('vault:write') && !m.permissionsJustification) {
    warnings.push('vault:write without a permissionsJustification');
  }
  if (m.homepage && !/^https:\/\//.test(m.homepage)) warnings.push('homepage should be https');
  if (m.id?.includes('harmos.official')) warnings.push('ids containing "harmos.official" are reserved for first-party modules');
  return { ok: errors.length === 0, errors, warnings };
}

/* ------------------------------- host API -------------------------------- */

export interface HostContext {
  moduleId: string;
  log(level: 'info' | 'warn' | 'error', message: string): void;
  readVault(path: string): string | null;
  writeVault(path: string, content: string): void;
  notify(message: string): void;
  registerCommand(label: string, run: () => void): void;
  fetch(url: string): Promise<unknown>;
}

export interface RevokedError extends Error { revoked: true; }

function revoked(kind: string): Error {
  const e = new Error(`Capability "${kind}" was revoked while the module was running.`) as RevokedError;
  e.revoked = true;
  return e;
}

/** Wraps a host so a module can only reach the capabilities its manifest declares.
 *  Revocation is checked on every call, not only at registration. */
export function grantCapabilities(m: ModuleManifest, host: Omit<HostContext, 'moduleId'>): { api: HostContext; revoke(): void; revoked(): boolean } {
  const live = new Set<Capability>(m.capabilities);
  const has = (c: Capability) => live.has(c);
  const guard = <A extends unknown[], R>(c: Capability, fn: (...a: A) => R) => (...a: A): R => {
    if (!has(c)) throw revoked(c);
    return fn(...a);
  };
  const guardAsync = <A extends unknown[], R>(c: Capability, fn: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => {
    if (!has(c)) throw revoked(c);
    return fn(...a);
  };

  const api: HostContext = {
    moduleId: m.id,
    log: guard('ui:command', host.log),
    readVault: guard('vault:read', host.readVault),
    writeVault: guard('vault:write', host.writeVault),
    notify: guard('notify', host.notify),
    registerCommand: guard('ui:command', host.registerCommand),
    fetch: guardAsync('network:fetch', host.fetch),
  };
  return { api, revoke: () => live.clear(), revoked: () => live.size === 0 };
}

/* ------------------------------ module loader ----------------------------- */

export type ModuleState = 'registered' | 'active' | 'error' | 'disabled' | 'revoked';

export interface LoadedModule {
  manifest: ModuleManifest;
  state: ModuleState;
  registeredAt: number;
  error?: string;
  calls: number;
  events: string[];
}

export interface SampleModule { manifest: ModuleManifest; setup(host: HostContext): void | Promise<void>; teardown?(host: HostContext): void; }

export const EXAMPLE_MODULE: SampleModule = {
  manifest: {
    id: 'com.example.vault-inventory',
    name: 'Vault Inventory',
    version: '1.0.0',
    apiVersion: '1.0.0',
    author: 'HarmOS example',
    description: 'Writes a manifest of vault files and registers one launcher command. Demonstrates the capability gate.',
    capabilities: ['vault:read', 'vault:write', 'ui:command', 'notify'],
    entry: 'builtin://inventory',
    license: 'MIT',
    permissionsJustification: 'Reads file paths and sizes only; writes a single report into the outbox. No network access.',
  },
  setup(host) {
    host.registerCommand('Generate vault inventory', () => {
      const report = host.readVault('index');
      host.writeVault('/home/harmos/HarmOS/outbox/inventory.md', report || '# empty');
      host.notify('Vault inventory written to the outbox.');
    });
    host.log('info', 'registered one command');
  },
};

export const HOSTILE_MANIFESTS: ModuleManifest[] = [
  {
    id: 'BAD', name: 'Bad id', version: '1.0.0', apiVersion: '1.0.0', author: 'x',
    description: 'Uses an id that is not lowercase', capabilities: ['vault:read'], entry: 'x',
  },
  {
    id: 'com.bad.version', name: 'Bad version', version: 'one', apiVersion: '1.0.0', author: 'x',
    description: 'Version is not semver at all', capabilities: ['vault:read'], entry: 'x',
  },
  {
    id: 'com.bad.api', name: 'Future API', version: '1.0.0', apiVersion: '9.0.0', author: 'x',
    description: 'Written against an API this host does not provide', capabilities: ['vault:read'], entry: 'x',
  },
  {
    id: 'com.bad.caps', name: 'Unknown capability', version: '1.0.0', apiVersion: '1.0.0', author: 'x',
    description: 'Requests a capability that does not exist', capabilities: ['root:everything' as Capability], entry: 'x',
  },
  {
    id: 'com.bad.dup', name: 'Duplicate capability', version: '1.0.0', apiVersion: '1.0.0', author: 'x',
    description: 'Declares the same capability twice', capabilities: ['vault:read', 'vault:read'], entry: 'x',
  },
];
