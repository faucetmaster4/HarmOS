# HarmOS 0.1.0-alpha — Architecture

HarmOS is a userspace AI operating environment on a maintained Linux kernel. No custom kernel
is built; everything HarmOS-specific lives in userspace, enforced by ordinary Unix privilege
boundaries plus systemd sandboxing.

```
┌──────────────────────── VirtualBox guest (Ubuntu 24.04 LTS, x86_64) ────────────────────────┐
│ Linux kernel + systemd                                                                      │
│   ├── harmos-firstboot.service  (oneshot: identity, keys, password reset, resource probe)   │
│   ├── harmos-nexus.service      (User=harmos-svc, ProtectSystem=strict, IPAddressDeny=any,  │
│   │                              IPAddressAllow=localhost, MemoryMax=3G, no capabilities)   │
│   └── lightdm → XFCE session (user: harmos)                                                 │
│         └── aetherframe-launch.sh → waits for 127.0.0.1:8787 → kiosk browser                │
│                                                                                             │
│  HarmOS Nexus (Node, /opt/harmos/sidecar — StarNet-derived, MIT)                            │
│    agent loop · tool registry · capability gate · cost ledger · MCP/ACP · streaming          │
│                                                                                             │
│  AetherFrame (this repository, src/)                                                         │
│    kernel.ts   authoritative state, permissions, task lifecycle, VFS, audit                  │
│    runtime.ts  planner, tool router, QAL, KaliOS, LGAI, self-tests                           │
│    protocol.ts Elahy'ra module contract                                                      │
│    registry45d.ts  45 addressable dimensions + validation                                    │
│                                                                                             │
│  State:  /home/harmos/HarmOS/{workspace,outbox,notes}   /var/lib/harmos/{vault,memory}       │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
          ▲ NAT only · no VRDE · no shared folders · host is outside the AI's reach
```

## Two builds, one codebase — stated plainly

| | Browser build (what runs here) | VirtualBox appliance (what the pipeline produces) |
| --- | --- | --- |
| Kernel/state | `src/harmos/kernel.ts` in-page, persisted to `localStorage` | same UI, backed by the Node sidecar + SQLite on disk |
| Permission gate | enforced in the kernel module, not in components | enforced in the sidecar + Unix users + systemd sandbox |
| Shell execution | **unavailable, refused and logged — never simulated** | `shell.exec` as `harmos-svc`, cwd pinned to the agent workspace |
| Host metrics | only what the browser exposes; gaps labelled unavailable | `/proc`, `ss`, `systemctl` via the sidecar |
| Credentials | volatile in-memory map, never persisted/exported/logged | Linux keyring; the key never reaches the page |

## Privilege model

1. **Deny by default.** `Kernel.authorize(agentId, capability, target)` is the only path to a
   privileged action. It checks: agent exists → not revoked → enabled → capability granted →
   target inside the agent's roots → (for `model.cloud`) processing policy and per-agent network flag.
2. **Path scoping.** `normPath` strips `..`, so traversal cannot escape a granted root.
3. **Approval gate.** Capabilities listed in `requireApproval` suspend the task until a human
   answers; unanswered requests auto-deny after 180 s so nothing hangs forever.
4. **No ambient admin.** No agent ships with `system.admin`. System Node — the Linux
   administration specialist — has *read* capabilities only, and every `shell.exec` attempt in
   this build is refused and written to the audit log.
5. **Two accounts on the appliance.** `harmos` (interactive, in `sudo`) and `harmos-svc`
   (`nologin`, no sudo, cannot write `/opt/harmos`). The AI runs as the latter.

## Task lifecycle

`PENDING → QUEUED → RUNNING → COMPLETED | FAILED | CANCELLED`

Every transition is appended to the task's step log *and* the audit log, then persisted.
The scheduler honours a concurrency limit (clamped to 1 in low-resource mode) and dependency
edges (`dependsOn`), so chained workflow stages genuinely wait. Cancellation is cooperative:
the executor checks `isCancelled` at each step boundary. Tasks interrupted by a session restart
are restored as `FAILED` with the reason stated — they are never silently resurrected as complete.

## Data and provenance

Every vault node carries `author`, `createdAt`, `updatedAt`, a content fingerprint, and one of
four provenance labels: `verified` (HarmOS-produced or user-confirmed), `user`, `model`,
`inferred`. The UI renders the stored label; it is never inferred at display time. Memory
entries additionally carry `source` and `scope`.

## Modules

| Module | Responsibility | Source |
| --- | --- | --- |
| HarmOS Nexus | orchestration, scheduling, tool routing | `src/harmos/kernel.ts`, `runtime.ts` + upstream `sidecar/` |
| AetherFrame | desktop shell, window manager, launcher | `src/App.tsx`, `src/ui/` |
| ESAI | capability gate, approvals, revocation, export/wipe, locality policy | `kernel.ts`, Settings + Security Center |
| LGAI | guidance separated into observed / suggestion / risk | `runtime.ts: lgaiGuidance` |
| QAL | evidence, competing hypotheses, contradictions, confidence, uncertainty | `runtime.ts: qalAnalyze` |
| KaliOS | audit log, redaction, integrity fingerprints, permission + exposure review | `kernel.ts: redact/log`, `runtime.ts: kaliosScan` |
| Sovereign Vault | persistent VFS, memory, provenance, credential custody | `kernel.ts`, `ui/panels/data.tsx` |
| Architect Core | editor, diff review, approval-before-apply | `ui/panels/data.tsx` |
| Elahy'ra Protocol | versioned manifests, lifecycle, health, events | `src/harmos/protocol.ts` |
| 45D Registry | 45 dimensions, statuses, dependency validation | `src/harmos/registry45d.ts` |

## Naming honesty

* **QAL** is deterministic analysis software. No quantum library or quantum hardware is involved.
* **45D** means forty-five addressable *software* dimensions — architectural responsibilities.
  It makes no claim about physics, and no dimension is presented as a previously shipped
  specification: none was found in the upstream tree, so all are marked as proposed in origin
  with an explicit implementation status.
* **Elahy'ra Protocol** is a plugin contract with JSON manifests and semver checks.

## Extending HarmOS (SDK sketch)

```ts
import { validateManifest } from './harmos/protocol';

const manifest = {
  id: 'my-module', name: 'My Module', version: '1.0.0', api: '1.0',
  description: 'Does one useful thing', author: 'you',
  permissions: ['fs.read'],            // must be real HarmOS capabilities
  dependsOn: ['vault-provenance'],
  config: { limit: { type: 'number', default: 10, label: 'Row limit' } },
};
registry.register({ manifest, start: (ctx) => ctx.log('up'), check: () => ({ ok: true, note: 'healthy' }) });
```
`system.admin` cannot be requested by a manifest — privileged actions go through the ESAI
approval flow, per action, per target. Try an invalid manifest in the Elahy'ra panel: it is
rejected with reasons.
