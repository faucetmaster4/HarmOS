import type { Agent } from './kernel';

const WS = '/home/harmos/HarmOS/workspace';
const OUT = '/home/harmos/HarmOS/outbox';
const NOTES = '/home/harmos/HarmOS/notes';

/* The seven HarmOS specialist agents. Permissions are deliberately asymmetric:
 * no agent is granted system.admin by default, not even Architect Core or System Node.
 * Escalation happens through the ESAI approval workflow, per action, per target. */
export const AGENTS: Agent[] = [
  {
    id: 'architect-core', name: 'Architect Core', role: 'Design & build',
    summary: 'System design, software development, integration and planning. Writes real files into the workspace and proposes diffs for review.',
    accent: 'cyan', glyph: '◈', enabled: true, revoked: false, model: '', workingDir: WS,
    permissions: { caps: ['fs.read', 'fs.write', 'fs.search', 'vault.read', 'vault.write', 'model.local', 'model.cloud'], roots: [WS, OUT, NOTES], requireApproval: ['fs.delete'], networkModels: true },
  },
  {
    id: 'guardian-node', name: 'Guardian Node', role: 'Defensive security',
    summary: 'Monitoring, integrity checks, permission auditing and diagnostics. Read-mostly by design — it reports, it does not remediate silently.',
    accent: 'emerald', glyph: '◆', enabled: true, revoked: false, model: '', workingDir: OUT,
    permissions: { caps: ['fs.read', 'fs.search', 'vault.read', 'fs.write', 'model.local'], roots: [OUT, NOTES, '/var/log/harmos'], requireApproval: ['fs.write'], networkModels: false },
  },
  {
    id: 'knowledge-node', name: 'Knowledge Node', role: 'Retrieval & analysis',
    summary: 'Document search, retrieval, summarisation and knowledge organisation across the Sovereign Vault.',
    accent: 'sky', glyph: '❖', enabled: true, revoked: false, model: '', workingDir: NOTES,
    permissions: { caps: ['fs.read', 'fs.search', 'fs.write', 'vault.read', 'vault.write', 'model.local', 'model.cloud'], roots: [WS, NOTES, OUT], requireApproval: [], networkModels: true },
  },
  {
    id: 'creative-node', name: 'Creative Node', role: 'Media & writing',
    summary: 'Music-production assistance, long-form writing, media workflow drafting and creative development.',
    accent: 'violet', glyph: '✦', enabled: true, revoked: false, model: '', workingDir: WS,
    permissions: { caps: ['fs.read', 'fs.write', 'fs.search', 'vault.read', 'model.local', 'model.cloud'], roots: [WS, OUT], requireApproval: [], networkModels: true },
  },
  {
    id: 'automation-node', name: 'Automation Node', role: 'Workflows & schedules',
    summary: 'Approved workflows, scheduling, repetitive tasks and integration management.',
    accent: 'amber', glyph: '⬡', enabled: true, revoked: false, model: '', workingDir: WS,
    permissions: { caps: ['fs.read', 'fs.write', 'fs.search', 'schedule.write', 'vault.read', 'model.local'], roots: [WS, OUT], requireApproval: ['fs.delete'], networkModels: false },
  },
  {
    id: 'research-node', name: 'Research Node', role: 'Research',
    summary: 'Web research when the operator enables network access; local document research when offline.',
    accent: 'rose', glyph: '◉', enabled: true, revoked: false, model: '', workingDir: NOTES,
    permissions: { caps: ['fs.read', 'fs.search', 'fs.write', 'vault.read', 'vault.write', 'model.cloud', 'model.local'], roots: [NOTES, OUT], requireApproval: ['net.fetch'], networkModels: true },
  },
  {
    id: 'system-node', name: 'System Node', role: 'Linux administration',
    summary: 'Authorised Linux administration and diagnostics. In this browser build it has NO shell: every shell request is refused and logged.',
    accent: 'slate', glyph: '⬢', enabled: true, revoked: false, model: '', workingDir: '/var/log/harmos',
    permissions: { caps: ['fs.read', 'fs.search', 'model.local'], roots: ['/var/log/harmos', '/var/lib/harmos', OUT], requireApproval: ['shell.exec', 'system.admin'], networkModels: false },
  },
];

export const SEED_FILES: Array<[string, string]> = [
  ['/home/harmos/HarmOS/README.md', `# HarmOS 0.1.0-alpha — Sovereign Vault root

This tree is your workspace. Agents write here; you own everything in it.

  workspace/   agent deliverables and project files
  outbox/      structured outputs produced by completed tasks
  notes/       knowledge entries, research and encrypted-note placeholders

Provenance labels appear on every file:
  verified  — produced by HarmOS itself or confirmed by you
  user      — you wrote it
  model     — a language model generated it (treat as a draft)
  inferred  — derived by analysis, not directly observed
`],
  ['/home/harmos/HarmOS/notes/first-steps.md', `# First steps

1. Open **AI Model Manager** and probe for a local Ollama runtime, or add a cloud provider.
2. Open **Nexus Terminal** and ask Architect Core to create a file.
3. Open **Security Center** to see exactly what each agent is allowed to do.
4. Open **Release Workbench** for the VirtualBox build kit and its honest build status.
`],
  ['/var/log/harmos/nexus.log', `[boot] HarmOS kernel (browser build) started
[boot] permission gate: deny-by-default
[boot] network policy: no outbound call without an explicit provider probe
`],
];
