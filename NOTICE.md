# HarmOS — attribution and third-party notices

HarmOS 0.1.0-alpha ("HarmOS Nexus — VirtualBox Edition") is a derivative work.

## Upstream

**StarNet** — <https://github.com/androoAGI/starnet>, branch `feat/harness-backend`,
commit `d540d503d9c8d5140685881880d46985b27e2f9c`, package `starnet-harness` 0.13.5.

> MIT License — Copyright (c) 2026 Andrew Sims

The MIT licence text (`LICENSE` in the upstream tree) and the upstream `NOTICE.md` are shipped
unmodified inside the HarmOS appliance payload at `/opt/harmos/`. **Authorship of upstream code
is not claimed by this project.**

The HarmOS Nexus AI core is the upstream `sidecar/` Node host, installed and supervised by the
HarmOS systemd units in `os/systemd/`. Upstream itself credits the **Hermes agent project**
(© 2025 Nous Research, MIT) and a number of community skill authors; those notices travel with
the payload.

## Replaced, not redistributed

StarNet's name, logos and pixel-art "station" artwork are **not** redistributed under HarmOS
branding. The AetherFrame interface, the HarmOS mark (`src/ui/firstboot.tsx`), the 45D registry,
the Elahy'ra protocol contract, the ESAI/KaliOS/QAL/LGAI modules and all packaging scripts in
this repository are original work authored for HarmOS.

## Base image and tooling (not bundled in this repository)

| Component | Licence | Role |
| --- | --- | --- |
| Ubuntu 24.04 LTS | various (GPL/MIT/BSD) | guest operating system, downloaded and checksum-verified at build time |
| Linux kernel, systemd, XFCE, LightDM | GPL-2.0 / LGPL-2.1 / GPL-2.0 | guest base system |
| Node.js 20 (NodeSource) | MIT | HarmOS Nexus runtime |
| Ollama | MIT | optional local inference runtime, installed without any model |
| VirtualBox Guest Additions | GPL-2.0 | clipboard, display resize, time sync |
| React, Vite, Tailwind CSS | MIT | AetherFrame interface build |
| Packer | BUSL-1.1 (build tooling only) | image pipeline — used, never shipped in the appliance |

A full dependency manifest for the appliance is produced by the build pipeline at
`dist/ova/release-manifest.json` (Packer `manifest` post-processor). That file does not exist
until a build is actually run.
