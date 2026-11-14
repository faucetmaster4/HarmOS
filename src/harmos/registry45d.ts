/* HarmOS 45D Integration Registry.
 *
 * HONESTY NOTE — read before quoting this file anywhere:
 *   "45D" here means forty-five *addressable architectural dimensions* of the HarmOS
 *   software system. They are software responsibilities, not physical dimensions, and
 *   nothing in this registry describes verified physics. No prior HarmOS specification
 *   was found in the upstream StarNet checkout (commit d540d503), so every dimension
 *   below is marked `proposed` in origin and carries an explicit implementation status
 *   describing what actually exists in THIS build.
 *
 * Status vocabulary (no fourth option — a thing is one of these):
 *   implemented  — executable in this browser build, exercised by the in-app test runner
 *   partial      — core path works, documented gaps remain
 *   script-only  — shipped as a real script/unit file, NOT executed in this environment
 *   proposed     — design + schema only, no executable behaviour yet
 */

export type DimStatus = 'implemented' | 'partial' | 'script-only' | 'proposed';

export interface Dimension {
  id: number;
  name: string;
  purpose: string;
  module: string;
  inputs: string;
  outputs: string;
  dependsOn: number[];
  status: DimStatus;
  permissions: string[];
  verification: string;
  test: string;
}

type Row = [number, string, string, string, string, string, number[], DimStatus, string[], string, string];

const ROWS: Row[] = [
  [1, 'Boot Sequence', 'Ordered bring-up from firmware to AetherFrame session', 'os/firstboot', 'systemd targets', 'ready signal', [], 'script-only', ['system.admin'], 'systemctl is-system-running returns running/degraded with no failed units', 'tests/smoke-appliance.sh §1'],
  [2, 'Service Supervision', 'Restart, health and resource limits for HarmOS units', 'os/systemd', 'unit files', 'unit state', [1], 'script-only', ['system.admin'], 'harmos-nexus.service active and sandboxed', 'tests/smoke-appliance.sh §1'],
  [3, 'Kernel State Store', 'Authoritative in-process state and persistence', 'harmos/core/kernel', 'mutations', 'snapshots', [], 'implemented', [], 'state survives reload; restored snapshot equals saved snapshot', 'selftest: persistence.roundtrip'],
  [4, 'Identity & Accounts', 'Desktop user, unprivileged service account, admin escalation', 'os/firstboot', 'useradd policy', 'account set', [1], 'script-only', ['system.admin'], 'harmos-svc has no sudo and cannot write /opt/harmos', 'tests/smoke-appliance.sh §3'],
  [5, 'Capability Gate', 'Deny-by-default capability checks for every agent action', 'harmos/esai', 'agentId + capability + target', 'allow | PermissionDenied', [3], 'implemented', [], 'denied capability throws and writes a deny audit event', 'selftest: permission.denied'],
  [6, 'Path Scoping', 'Agents act only inside granted filesystem roots', 'harmos/esai', 'path', 'allow | deny', [5], 'implemented', ['fs.read', 'fs.write'], 'traversal and out-of-root writes rejected', 'selftest: path.escape'],
  [7, 'Task Lifecycle', 'PENDING→QUEUED→RUNNING→COMPLETED/FAILED/CANCELLED', 'harmos/nexus', 'task request', 'persisted transitions', [3], 'implemented', [], 'every transition appended to the task log and the audit log', 'selftest: task.lifecycle'],
  [8, 'Concurrency Governor', 'Execution slots, queue depth, low-resource throttling', 'harmos/nexus', 'queue + settings', 'scheduling decisions', [7], 'implemented', [], 'running count never exceeds the configured limit', 'selftest: concurrency.limit'],
  [9, 'Cancellation', 'Cooperative stop for queued and running work', 'harmos/nexus', 'cancel intent', 'CANCELLED state', [7], 'implemented', [], 'running task stops at its next checkpoint', 'selftest: task.cancel'],
  [10, 'Tool Router', 'Dispatch of fs/vault/analysis/security tools with logging', 'harmos/nexus', 'tool call', 'tool result', [5, 7], 'implemented', ['fs.read', 'fs.write'], 'each call recorded with arguments and duration', 'selftest: tool.trace'],
  [11, 'Deterministic Planner', 'Maps natural language to a tool plan without a model', 'harmos/nexus', 'prompt', 'plan steps', [10], 'implemented', [], 'known intents produce a plan; unknown intents fail loudly', 'selftest: planner.intents'],
  [12, 'Model Provider Registry', 'Configure local and cloud inference endpoints', 'harmos/core/models', 'provider config', 'active provider', [3], 'implemented', ['model.local', 'model.cloud'], 'reachability is probed, never assumed', 'in-app: Model Manager probe'],
  [13, 'Local Inference (Ollama)', 'Detect, list and call a local runtime', 'harmos/core/models', 'HTTP 11434', 'completions', [12], 'partial', ['model.local'], 'tag list returned by a live daemon', 'in-app: Model Manager probe'],
  [14, 'Cloud Inference', 'OpenAI-compatible / Anthropic / Google / OpenRouter calls', 'harmos/core/models', 'endpoint + key', 'completions + usage', [12], 'partial', ['model.cloud', 'net.fetch'], 'usage reported only when the provider returns it', 'in-app: Model Manager probe'],
  [15, 'Credential Custody', 'Keys held outside persisted state and redacted everywhere', 'harmos/vault', 'secret', 'handle only', [3], 'implemented', ['secrets.read'], 'no key appears in state, exports or logs', 'selftest: secret.redaction'],
  [16, 'Sovereign Vault FS', 'Persistent workspace, outbox and notes with provenance', 'harmos/vault', 'file ops', 'VNode tree', [3, 6], 'implemented', ['fs.write'], 'files survive reload with author and provenance intact', 'selftest: persistence.roundtrip'],
  [17, 'Provenance Labelling', 'verified / user / model / inferred on every record', 'harmos/vault', 'write metadata', 'labelled record', [16], 'implemented', [], 'UI renders the label stored with the record', 'selftest: provenance.labels'],
  [18, 'Agent Memory', 'Scoped, inspectable, deletable memory entries', 'harmos/vault', 'observations', 'memory entries', [16, 17], 'implemented', ['vault.write'], 'entries carry source, scope and timestamp; deletion is immediate', 'selftest: memory.delete'],
  [19, 'Local Search', 'Substring/line search across authorised roots', 'harmos/vault', 'query', 'ranked hits', [16], 'implemented', ['fs.search'], 'results never include files outside the agent roots', 'selftest: search.scope'],
  [20, 'Semantic Index', 'Embedding-backed retrieval over vault documents', 'harmos/vault', 'documents', 'vectors', [19], 'proposed', ['vault.read'], 'recall@5 measured against a labelled set', 'not implemented'],
  [21, 'Audit Log', 'Append-only record of every privileged action', 'harmos/kalios', 'kernel events', 'audit stream', [3], 'implemented', [], 'deny decisions always produce an entry', 'selftest: permission.denied'],
  [22, 'Secret Redaction', 'Pattern-based scrubbing before any sink', 'harmos/kalios', 'strings', 'redacted strings', [21], 'implemented', [], 'known key formats never reach a log or export', 'selftest: secret.redaction'],
  [23, 'Integrity Fingerprints', 'Change detection for vault artefacts', 'harmos/kalios', 'file content', 'fingerprint', [16], 'partial', [], 'fingerprint changes when content changes (FNV-1a, not cryptographic)', 'selftest: integrity.change'],
  [24, 'Permission Audit', 'Report of effective agent capability surface', 'harmos/kalios', 'agent set', 'capability matrix', [5], 'implemented', [], 'matrix matches the enforced capability lists', 'in-app: Security Center'],
  [25, 'Network Exposure Review', 'What is listening, and to whom', 'harmos/kalios', 'socket table', 'exposure report', [2], 'script-only', ['system.admin'], 'nothing bound to 0.0.0.0', 'tests/smoke-appliance.sh §2'],
  [26, 'Process Inspection', 'Observable signals for suspicious processes', 'harmos/kalios', '/proc', 'findings', [2], 'proposed', ['system.admin'], 'flags only on observable evidence', 'not implemented'],
  [27, 'Backup & Restore', 'Export, checksum and reimport of HarmOS state', 'harmos/vault', 'state', 'archive', [3, 16], 'implemented', [], 'exported archive reimports to an equal state', 'selftest: export.import'],
  [28, 'Retention Policy', 'Age-based pruning of logs and memory', 'harmos/esai', 'retention days', 'pruned stores', [18, 21], 'partial', [], 'records older than the window are removed on demand', 'in-app: Settings → Privacy'],
  [29, 'Approval Workflow', 'Human-in-the-loop gate for risky capabilities', 'harmos/esai', 'approval request', 'approved | denied', [5], 'implemented', [], 'task blocks until a human answers or the request times out', 'selftest: approval.gate'],
  [30, 'Agent Revocation', 'Immediate, enforced removal of an agent authority', 'harmos/esai', 'operator intent', 'revoked agent', [5], 'implemented', ['agent.manage'], 'revoked agent cannot start or continue work', 'selftest: agent.revoke'],
  [31, 'Emergency Halt', 'One action stops all in-flight work', 'harmos/esai', 'operator intent', 'cancelled tasks', [9], 'implemented', [], 'queue drains to zero running tasks', 'selftest: task.cancel'],
  [32, 'Processing Locality', 'offline-only / local-first / cloud-allowed policy', 'harmos/esai', 'policy', 'routing decision', [14], 'implemented', ['model.cloud'], 'offline-only blocks cloud calls at the gate, not in the UI', 'selftest: offline.block'],
  [33, 'LGAI Guidance', 'Context-aware explanation of state, errors and risk', 'harmos/lgai', 'runtime snapshot', 'guidance cards', [3], 'implemented', [], 'every card cites the observation it came from', 'in-app: LGAI panel'],
  [34, 'QAL Reasoning', 'Structured multi-step analysis with uncertainty', 'harmos/qal', 'question + evidence', 'structured finding', [10], 'implemented', [], 'output separates evidence, inference and confidence', 'selftest: qal.structure'],
  [35, 'Contradiction Detection', 'Flag conflicting statements across sources', 'harmos/qal', 'statement set', 'conflicts', [34], 'partial', [], 'negation/opposition pairs surfaced with both sources', 'selftest: qal.contradiction'],
  [36, 'Dependency Analysis', 'Order, cycles and blockers across tasks', 'harmos/qal', 'task graph', 'ordering report', [7, 34], 'implemented', [], 'cycles reported rather than silently reordered', 'selftest: workflow.cycle'],
  [37, 'Workflow Engine', 'Chained and parallel multi-agent pipelines', 'harmos/nexus', 'workflow spec', 'task graph', [7, 36], 'implemented', ['schedule.write'], 'dependent task starts only after its parent completes', 'selftest: workflow.chain'],
  [38, 'Scheduling', 'Deferred and recurring task execution', 'harmos/nexus', 'schedule', 'queued tasks', [7], 'partial', ['schedule.write'], 'a scheduled task fires once while the session is open', 'in-app: Workflow Builder'],
  [39, 'Architect Workspace', 'Editor, diffs and reversible change review', 'harmos/architect', 'files + proposals', 'approved diffs', [16, 29], 'implemented', ['fs.write'], 'no change lands without an explicit diff approval', 'selftest: architect.diff'],
  [40, 'Sandboxed Execution', 'Real shell/process execution for agents', 'harmos/architect', 'command', 'stdout/stderr', [5], 'proposed', ['shell.exec'], 'requires the Linux guest; unavailable in the browser build', 'tests/smoke-appliance.sh §6'],
  [41, 'Elahy\u2019ra Protocol', 'Versioned module manifests, lifecycle and health', 'harmos/protocols', 'manifest', 'registered module', [3], 'implemented', [], 'invalid manifest is rejected with a reason', 'selftest: protocol.validate'],
  [42, '45D Registry', 'Self-describing dimension registry with validation', 'harmos/registry-45d', 'dimension rows', 'validated registry', [41], 'implemented', [], 'duplicate ids, bad deps and cycles are detected', 'selftest: registry.validate'],
  [43, 'Resource Governor', 'Observable resource pressure and low-resource mode', 'harmos/core', 'runtime metrics', 'throttle decisions', [8], 'partial', [], 'metrics are measured, never invented; gaps are shown as unavailable', 'in-app: System Monitor'],
  [44, 'Voice I/O', 'Push-to-talk capture and spoken responses', 'harmos/core/voice', 'microphone', 'transcript + speech', [3], 'partial', [], 'uses the browser Web Speech API when present; otherwise disabled', 'in-app: Settings → Voice'],
  [45, 'Release Pipeline', 'Reproducible OVA build, checksums and manifest', 'packaging/', 'repo + ISO', 'OVA + sha256', [1, 2], 'script-only', [], 'Packer build exports an importable appliance', 'packaging/windows/Build-HarmOS.ps1'],
];

export const DIMENSIONS: Dimension[] = ROWS.map(([id, name, purpose, module, inputs, outputs, dependsOn, status, permissions, verification, test]) => ({
  id, name, purpose, module, inputs, outputs, dependsOn, status, permissions, verification, test,
}));

export interface RegistryIssue { level: 'error' | 'warn'; dim: number; message: string; }

/** Real validation: duplicate ids, out-of-range ids, missing dependencies,
 *  dependency cycles, and dimensions that claim to be implemented without a test. */
export function validateRegistry(dims: Dimension[] = DIMENSIONS): RegistryIssue[] {
  const issues: RegistryIssue[] = [];
  const seen = new Set<number>();
  const byId = new Map(dims.map((d) => [d.id, d]));

  for (const d of dims) {
    if (seen.has(d.id)) issues.push({ level: 'error', dim: d.id, message: `duplicate dimension id ${d.id}` });
    seen.add(d.id);
    if (d.id < 1 || d.id > 45) issues.push({ level: 'error', dim: d.id, message: `id ${d.id} outside the 1..45 address space` });
    if (!d.name.trim()) issues.push({ level: 'error', dim: d.id, message: 'empty name' });
    for (const dep of d.dependsOn) {
      if (!byId.has(dep)) issues.push({ level: 'error', dim: d.id, message: `depends on unregistered dimension ${dep}` });
      if (dep === d.id) issues.push({ level: 'error', dim: d.id, message: 'self-dependency' });
    }
    if ((d.status === 'implemented' || d.status === 'partial') && (!d.test || d.test === 'not implemented')) {
      issues.push({ level: 'warn', dim: d.id, message: `claims status "${d.status}" but declares no test` });
    }
    if (d.status === 'proposed' && d.test !== 'not implemented' && !d.test.startsWith('tests/')) {
      issues.push({ level: 'warn', dim: d.id, message: 'proposed dimension references an in-app test' });
    }
  }
  for (let i = 1; i <= 45; i++) if (!byId.has(i)) issues.push({ level: 'warn', dim: i, message: `address ${i} is unallocated` });

  // cycle detection (DFS)
  const colour = new Map<number, 0 | 1 | 2>();
  const walk = (id: number, path: number[]): void => {
    if (colour.get(id) === 1) { issues.push({ level: 'error', dim: id, message: `dependency cycle: ${[...path, id].join(' → ')}` }); return; }
    if (colour.get(id) === 2) return;
    colour.set(id, 1);
    for (const dep of byId.get(id)?.dependsOn || []) walk(dep, [...path, id]);
    colour.set(id, 2);
  };
  for (const d of dims) walk(d.id, []);
  return issues;
}

export function registryStats(dims: Dimension[] = DIMENSIONS) {
  const by = (s: DimStatus) => dims.filter((d) => d.status === s).length;
  return {
    total: dims.length,
    implemented: by('implemented'),
    partial: by('partial'),
    scriptOnly: by('script-only'),
    proposed: by('proposed'),
  };
}
