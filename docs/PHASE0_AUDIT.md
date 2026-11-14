# Phase 0 — Upstream Repository Audit

Performed by cloning and reading the real tree, not the documentation.

```
git clone --branch feat/harness-backend --single-branch https://github.com/androoAGI/starnet.git harmos
```

| Fact | Value (observed) |
| --- | --- |
| Commit audited | `d540d503d9c8d5140685881880d46985b27e2f9c` |
| Commit date / author | 2026-10-16 14:53:48 −0400, `andro` |
| Package name / version | `starnet-harness` 0.13.5 |
| Licence | MIT © 2026 Andrew Sims (`LICENSE`), third-party credits in `NOTICE.md` |
| Tracked files | 47,932 |
| Node requirement | `engines.node >= 18` |
| Runtime dependencies | `@huggingface/transformers`, `ajv`, `kokoro-js`, `node-pty`, `ogg-opus-decoder`, `undici` (6 total) |
| Backend entrypoint | `sidecar/index.js` (`npm start`) — explicitly documented in-file as "the ONLY module with ambient I/O" |
| Distinct `/api/...` paths in `sidecar/` | 410 |
| Agent tool surface | `fs.read/write/append/edit/patch/list/search`, `shell.exec`, `shell.bg.*`, `verify.run`, `notebook.*`, `browser.login` |
| Execution backends | `local` (host shell, per-agent workspace) and `docker` (`SAFE CELL` profile, bind-mounted workspace) — `docs/EXECUTION_BACKENDS.md` |
| Directory sizes | `frontend/` 1.4 GB, `qa/` 70 MB, `test/` 21 MB, `sidecar/` 10 MB, `src-tauri/` 6.2 MB, `shared/` 144 KB |
| Test entrypoints | `npm run test:fast` (`scripts/run-fast-tests.mjs`), `npm run test:http` (`test/http.list`) |
| Docs named in the brief | `docs/INDEX.md`, `BRAIN.md`, `HARNESS_ARCHITECTURE.md`, `EXECUTION_BACKENDS.md`, `DECISIONS.md`, `MISTAKES.md` — all present |

## Reuse decision

| Upstream asset | Decision | Reason |
| --- | --- | --- |
| `sidecar/` harness (agent loop, registry, capability gate, cost engine, ledger, MCP/ACP servers, connector vault) | **Reuse as HarmOS Nexus**, installed to `/opt/harmos` by `packaging/packer/scripts/03-harmos.sh` | Mature, zero-dependency Node host with a real streaming agent loop and an existing permission/consent broker. Rebuilding it would be wasteful and worse. |
| `shared/` (events, schema, emitter, clock-rng) | Reuse unchanged | Stable contracts used by both sides. |
| `frontend/` (1.4 GB pixel-art "station" UI) | **Do not ship** | Brand-specific artwork and a game metaphor that contradicts the HarmOS visual direction. Replaced by AetherFrame, authored from scratch (`src/ui/`). |
| `src-tauri/` desktop shell | Not used in 0.1.0 | The appliance runs the UI in a kiosk browser against the loopback sidecar; a Tauri build adds Rust toolchain weight to the image for no boot-path benefit. Revisit for 0.2.0. |
| `test/`, `qa/` | Keep in-tree; run upstream suites on the build host before packaging | Adapting them is in scope for Phase 2 of the appliance work; they are **not** claimed as executed here. |
| Name, logos, station art | Replaced | Original HarmOS mark (`src/ui/firstboot.tsx: HarmMark`) and AetherFrame styling. No upstream artwork is redistributed under HarmOS branding. |
| `LICENSE`, `NOTICE.md` | Retained verbatim in the appliance payload | MIT obligation; upstream authorship is not claimed. |

## Branch-specific notes

* `sidecar/index.js` consumes `STARNET_CONNECTOR_ENCRYPTION_KEY` from the environment and immediately `delete`s it from `process.env` so no child process inherits it. HarmOS preserves that posture: `/etc/harmos/nexus.env` is `0640 root:harmos-svc` and contains no key material.
* `STARNET_DESKTOP_SHELL=1` makes the connector vault key mandatory. The appliance sets `0` because the kiosk browser, not the Tauri shell, hosts the UI.
* Native modules (`node-pty`, `@huggingface/transformers`) can fail to build on a minimal guest; `03-harmos.sh` treats `npm ci` failure as a warning and continues, because the core host has no hard dependency on them.

## What this audit does **not** establish

Upstream tests were not executed in this environment, and no upstream behaviour is claimed to have been verified at runtime here. The facts above come from reading the checked-out tree.
