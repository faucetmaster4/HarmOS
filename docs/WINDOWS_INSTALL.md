# HarmOS on Windows 10 x64 — build, import, first login, troubleshooting

> **Status:** these instructions describe scripts that exist in this repository and have been
> written and reviewed, but **have not been executed** — the authoring environment had no
> Windows host, no VirtualBox and no hardware virtualisation. Treat the first run as a build
> you are performing, not a build you are repeating.

## 1. Prerequisites

```powershell
winget install Oracle.VirtualBox      # 7.0 or newer
winget install HashiCorp.Packer       # 1.11 or newer
```

* 40 GB free disk, 8 GB+ host RAM (16 GB recommended if you want an 8 GB guest).
* Hardware virtualisation enabled in firmware (Intel VT-x / AMD-V).
* **Hyper-V, WSL2 and Memory Integrity compete for VT-x.** If the build dies with
  `VERR_VMX_NO_VMX` or runs absurdly slowly:
  ```powershell
  bcdedit /set hypervisorlaunchtype off   # then reboot
  ```

## 2. Get a verified Ubuntu ISO

Download `ubuntu-24.04.x-live-server-amd64.iso` and its hash from
<https://releases.ubuntu.com/24.04/SHA256SUMS>. The build **refuses to run without a checksum** —
an unverified base image is a supply-chain hole.

## 3. Build the appliance

```powershell
powershell -ExecutionPolicy Bypass -File .\packaging\windows\Build-HarmOS.ps1 `
  -IsoPath "D:\iso\ubuntu-24.04.3-live-server-amd64.iso" `
  -IsoChecksum "sha256:0e2f0a3ba9b8f1c...paste the real value..."
```

Expect 30–60 minutes. The script validates dependencies first, stages `payload/`, runs
`packer init/validate/build`, verifies the OVA with `VBoxManage import --dry-run`, and writes
`dist\ova\HarmOS-0.1.0-alpha-x86_64.ova` plus a `.sha256` file.

Paths with spaces are handled (`-LiteralPath` everywhere, quoted arguments).

## 4. Import

```powershell
powershell -ExecutionPolicy Bypass -File .\packaging\windows\Import-HarmOS.ps1 `
  -OvaPath ".\dist\ova\HarmOS-0.1.0-alpha-x86_64.ova" `
  -ExpectedSha256 "<contents of the .sha256 file>" -Start
```

Applied defaults: **NAT only**, VRDE off, drag-and-drop disabled, no shared folders, VMSVGA
with 128 MB VRAM, bidirectional clipboard (Guest Additions permitting).

Manual equivalent:
```powershell
VBoxManage import "HarmOS-0.1.0-alpha-x86_64.ova" --vsys 0 --vmname HarmOS --cpus 4 --memory 8192
VBoxManage modifyvm HarmOS --nic1 nat --vrde off
VBoxManage startvm HarmOS --type gui
```

## 5. First login

| Item | Value |
| --- | --- |
| Username | `harmos` |
| Password | the build password — **you are forced to change it immediately** (`chage -d 0`) |
| Admin | `harmos` is in `sudo`; the service account `harmos-svc` is not and has no login shell |

On first boot `harmos-firstboot.service` runs once: new machine-id, regenerated SSH host keys,
forced password reset, resource probe to `/var/lib/harmos/system-probe.json`. Then LightDM starts
XFCE, and `aetherframe-launch.sh` waits for `http://127.0.0.1:8787/` before opening AetherFrame.
If the backend never answers you get the real `systemctl`/`journalctl` error, not a fake desktop.

## 6. AI model setup

```bash
# inside the guest
ollama pull qwen2.5:0.5b    # ~400 MB, works in a 4 GB guest
ollama pull llama3.2:3b     # ~2 GB, better quality, 8 GB guest recommended
systemctl --user enable --now ollama
```
Then open **AI Model Manager → Probe 127.0.0.1:11434**. Nothing multi-gigabyte is ever downloaded
without your explicit action. For cloud providers, add a key in the same panel; it is held by the
sidecar, never by the page.

## 7. Verify honestly

```bash
bash /opt/harmos/tests/smoke-appliance.sh
```
Record the real output. Checks that cannot run (no `DISPLAY`, no model configured) report **SKIP**,
never PASS.

## 8. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `VERR_VMX_NO_VMX` | Hyper-V/WSL2 holds VT-x | `bcdedit /set hypervisorlaunchtype off`, reboot |
| Packer hangs at "Waiting for SSH" | autoinstall failed | Watch the VM console; check `packaging/packer/http/user-data` |
| Checksum mismatch | wrong/partial ISO | Re-download, re-copy the hash from SHA256SUMS |
| Desktop shows the backend error dialog | `harmos-nexus` failed | `sudo journalctl -u harmos-nexus -n 100 --no-pager` |
| Tiny screen, no auto-resize | Guest Additions missing | `sudo apt install virtualbox-guest-x11 && reboot` |
| Ollama very slow | CPU-only inference | Use `qwen2.5:0.5b`, raise vCPUs, enable low-resource mode |
| Import fails with "already exists" | name collision | `-VmName HarmOS2` or `VBoxManage unregistervm HarmOS --delete` |

## 9. Recovery

* Rescue shell: hold **Shift** at boot → GRUB → *Advanced* → recovery mode.
* Disable the AI core: `sudo systemctl disable --now harmos-nexus` (the desktop still boots).
* Reset onboarding: `sudo rm /var/lib/harmos/.firstboot-done` and reboot.
* Your data lives in `/home/harmos/HarmOS` and `/var/lib/harmos` — snapshot the VM before upgrades.
