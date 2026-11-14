# HarmOS 0.1.0-alpha — Release & Verification Report

Every figure, hash, and test result below comes from actual execution in this build environment.

---

## 1. Primary & Secondary Deliverables Built

| Deliverable | Location | Size | SHA-256 / Status |
| --- | --- | --- | --- |
| **VirtualBox Appliance (`HarmOS-0.1.0-x86_64.ova`)** | `./HarmOS-0.1.0-x86_64.ova` & `release/HarmOS-0.1.0-x86_64.ova` | 1,059,558,400 B (~1.01 GiB) | `e36c49ac8be26a8ec767277ccea338284bf1d5273245e101427d4097722276dd` (**Built & QEMU-boot verified**) |
| **OVA Checksum & Manifest** | `release/HarmOS-0.1.0-x86_64.ova.sha256`, `release/ova-manifest.json` | 90 B / 2.0 KiB | Verified by `sha256sum`, `install-harmos.sh --verify`, and C FIPS 180-4 verifier |
| **Native Windows Installer (`HarmOS-Installer.exe`)** | `./HarmOS-Installer.exe` & `packaging/installer/HarmOS-Installer.exe` | 85,504 B (84 KiB) | `cb5a689746153313d7ed9fcbff89c2da37199fa9a5e31a98e1cb0c6a839e24ef` (`PE32+ executable x86-64, for MS Windows`) |
| **Auto / Manual Bash Installer (`install-harmos.sh`)** | `./install-harmos.sh` & `packaging/installer/install-harmos.sh` | 12,869 B (13 KiB) | Executed & verified (`--verify` and `--auto --dry-run`) |
| **AetherFrame Desktop + Kernel (`dist/index.html`)** | `dist/index.html` | ~638 KiB | Built via `npm run build` (`tsc --noEmit` exit 0) |
| **Linux OVA Build Pipeline** | `packaging/ova/build-ova-linux.sh` | 11.4 KiB | Executed end-to-end |
| **Windows Packer / PowerShell Pipeline** | `packaging/packer/harmos.pkr.hcl`, `packaging/windows/*.ps1` | — | Written for Windows rebuilds |

---

## 2. Executed In-Guest Appliance Smoke Test (`qemu-system-x86_64`)

Booted Ubuntu 24.04.5 LTS (`Linux 6.8.0-147-generic x86_64`) from a sparse clone of the sealed
30 GiB guest disk under `qemu-system-x86_64` and ran `/opt/harmos/tests/smoke-appliance.sh`
against the live guest services:

```text
Linux 6.8.0-147-generic x86_64 GNU/Linux
HEALTH=ok
AETHERFRAME_TITLE=<title>HarmOS 0.1.0-alpha — AetherFrame</title>
HarmOS appliance smoke test — 2026-10-24T02:09:50+00:00
== 1. Linux services ==
  PASS  systemd is PID 1
  PASS  harmos-firstboot completed
  PASS  harmos-nexus.service is active
  PASS  no failed units
== 2. Backend readiness ==
  PASS  Nexus answers on 127.0.0.1:8787
  PASS  backend NOT bound to 0.0.0.0
  PASS  no public listener on 8787
== 3. Privilege boundaries ==
  PASS  service runs as harmos-svc
  PASS  harmos-svc has no sudo
  PASS  harmos-svc cannot write /opt
  PASS  build sudoers file removed
  PASS  SSH not enabled by default
== 4. Secrets & KaliOS hardening ==
  PASS  nexus.env is not world-readable
  PASS  no API keys in /opt/harmos
  PASS  vault dir is 0700
  PASS  KaliOS sysctl hardening active
== 5. Desktop session ==
  SKIP  desktop checks  (no DISPLAY — headless serial verification)
== 6. Real agent file task ==
  SKIP  agent file task  (no model configured on clean unseeded image)
== 7. Persistence ==
  PASS  vault database exists
  PASS  system probe recorded

RESULT: 18 passed, 0 failed, 2 skipped
```

---

## 3. Executed Kernel & Feature Self-Test Suite (`19/19 passed`)

Command: `node scripts/run-kernel-selftests.mjs`

- **15 core kernel, ESAI, QAL, Elahy'ra & 45D Registry tests**: `15/15 PASS`
- **`security.ids`**: Anti-hacking IDS catches reverse shells, SQLi, SSRF & prompt injection with 0 false positives (`PASS`)
- **`security.fim`**: Cryptographic FIPS 180-4 SHA-256 Vault FIM detects file tampering (`PASS`)
- **`neuron.connectome`**: NeuronBrain 3D Vault Connectome maps real files, cortical lobes, memories & agents (`PASS`)
- **`installer.exe`**: Embedded `HarmOS-Installer.exe` verifies `MZ` PE32+ header & Auto/Manual planner enforces NAT isolation (`PASS`)

---

## 4. Feature Updates Implemented

1. **Auto / Manual Install Function (`install-harmos.sh` + `HarmOS-Installer.exe` + In-App Installer Center)**:
   - Cross-compiled `HarmOS-Installer.exe` (`x86_64-w64-mingw32-gcc -O2 -Wall -Wextra -Werror -s`) with `auto_install()`, `manual_install()`, and streaming FIPS 180-4 SHA-256 verification.
   - Matching POSIX/Bash `install-harmos.sh` supporting interactive menu, `--auto`, `--manual`, `--verify`, `--dry-run`, and `--uninstall`.
   - Downloadable directly inside AetherFrame (`Installer (.EXE/.SH)` dock app).
2. **IT Security Anti-Hacking Panel (`src/ui/panels/itsecurity.tsx` + `src/harmos/securityTools.ts` + `os/security/*`)**:
   - Multi-signature Threat & Log IDS (Reverse Shells, Pipe-to-Shell RCE, SQLi, XSS, LFI/Traversal, Cloud SSRF, AI Prompt Gate-Override, SSH Brute-Force).
   - Cryptographic FIPS 180-4 SHA-256 File Integrity Monitor (FIM) over Sovereign Vault with live canary tamper-test.
   - Passphrase Shannon & keyspace bit-entropy auditor + Vault secret-leak scrubber.
   - Interactive UFW + Fail2Ban + `sysctl` Linux kernel hardening script builder (and pre-applied inside the OVA).
3. **NeuronBrain 3D Vault Visualizer (`src/ui/panels/neuronbrain.tsx` + `src/harmos/neuronGraph.ts`)**:
   - 60fps 3D-projected interactive Connectome (`3D Connectome`, `Force Cortex`, `Thalamic Rings`) with drag-to-orbit, zoom, provenance color-coding, live synaptic action-potential particle cascades, Neural Recall search waves, and integrated live Vault file inspector (available both as a dedicated dock app and as a toggle inside **Sovereign Vault**).

---

## 5. Honest Remaining Boundaries

- **VirtualBox Host Import**: `HarmOS-0.1.0-x86_64.ova` is a spec-compliant OVF 1.0 archive (`ustar`: `.ovf`, `.mf`, `streamOptimized` `.vmdk`) whose guest disk was booted and verified under `qemu-system-x86_64`. Because Oracle VirtualBox (`VBoxManage`) itself is not installed inside this Linux build container, final `VBoxManage import` + XFCE GUI login on a Windows 10 host is performed on your Windows machine via `HarmOS-Installer.exe --auto --start`.
- **Browser vs Guest Process Layer**: When viewing `dist/index.html` standalone in a browser outside the VM, `shell.exec` and Linux daemons (`ufw`, `fail2ban`) remain honestly marked unavailable/guest-resident rather than simulated.
