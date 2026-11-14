#!/usr/bin/env bash
# ==============================================================================
# HarmOS 0.1.0-alpha — Auto / Manual Appliance Installer (Linux / macOS / WSL2)
# ==============================================================================
# Provides both an unattended AUTO install function and an interactive MANUAL
# configuration wizard for importing HarmOS-0.1.0-x86_64.ova into VirtualBox
# with KaliOS defensive defaults (NAT-only, no VRDE, no host shared folders).
#
# Usage:
#   bash install-harmos.sh                     # Interactive menu (Auto or Manual)
#   bash install-harmos.sh --auto [options]    # Automatic host-tuned installation
#   bash install-harmos.sh --manual [options]  # Step-by-step custom installation
#   bash install-harmos.sh --verify            # Verify OVA SHA-256 integrity only
#   bash install-harmos.sh --dry-run --auto    # Print exact VBoxManage commands
# ==============================================================================
set -euo pipefail

VERSION="0.1.0"
DEFAULT_OVA="HarmOS-0.1.0-x86_64.ova"
VM_NAME="HarmOS-0.1.0"
OVA_PATH=""
EXPECTED_SHA=""
MODE=""
DRY_RUN=0
START_VM=0
CUSTOM_RAM=0
CUSTOM_CPUS=0
NET_MODE="nat"
CLIPBOARD_MODE="bidirectional"
SHARED_DIR=""

c_cyan=$'\033[0;36m'; c_green=$'\033[0;32m'; c_yellow=$'\033[1;33m'; c_red=$'\033[0;31m'; c_reset=$'\033[0m'
info() { printf "%s[harmos]%s %s\n" "$c_cyan" "$c_reset" "$*"; }
ok()   { printf "%s[  ok  ]%s %s\n" "$c_green" "$c_reset" "$*"; }
warn() { printf "%s[ warn ]%s %s\n" "$c_yellow" "$c_reset" "$*"; }
die()  { printf "%s[ fail ]%s %s\n" "$c_red" "$c_reset" "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
HarmOS 0.1.0 Appliance Installer — Auto & Manual Modes

Modes:
  --auto              Unattended install with safe host-detected RAM/vCPU/NAT defaults
  --manual            Interactive step-by-step wizard (VM name, RAM, CPUs, network, shares)
  --verify            Verify SHA-256 checksum of HarmOS-0.1.0-x86_64.ova and exit
  --uninstall         Unregister and delete an existing HarmOS VM (requires confirmation)

Options:
  --ova <path>        Path to HarmOS-0.1.0-x86_64.ova
  --sha256 <hex>      Expected SHA-256 digest (auto-read from <ova>.sha256 if present)
  --name <vmname>     VirtualBox VM name (default: HarmOS-0.1.0)
  --ram <mb>          Guest memory in MB (min 4096, recommended 8192)
  --cpus <count>      Guest vCPUs (min 2, recommended 4)
  --start             Boot the HarmOS appliance immediately after import
  --dry-run           Validate and print every VBoxManage command without modifying VirtualBox
  -h, --help          Show this help text
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --auto)       MODE="auto"; shift ;;
    --manual)     MODE="manual"; shift ;;
    --verify)     MODE="verify"; shift ;;
    --uninstall)  MODE="uninstall"; shift ;;
    --dry-run)    DRY_RUN=1; shift ;;
    --start)      START_VM=1; shift ;;
    --ova)        OVA_PATH="${2:-}"; shift 2 ;;
    --sha256)     EXPECTED_SHA="${2:-}"; shift 2 ;;
    --name)       VM_NAME="${2:-}"; shift 2 ;;
    --ram)        CUSTOM_RAM="${2:-0}"; shift 2 ;;
    --cpus)       CUSTOM_CPUS="${2:-0}"; shift 2 ;;
    -h|--help)    usage; exit 0 ;;
    *)            die "Unknown option: $1 (pass --help for usage)" ;;
  esac
done

detect_vboxmanage() {
  if command -v VBoxManage >/dev/null 2>&1; then
    command -v VBoxManage; return 0
  fi
  for candidate in \
    "/mnt/c/Program Files/Oracle/VirtualBox/VBoxManage.exe" \
    "/c/Program Files/Oracle/VirtualBox/VBoxManage.exe" \
    "/Applications/VirtualBox.app/Contents/MacOS/VBoxManage"; do
    if [ -x "$candidate" ]; then printf "%s\n" "$candidate"; return 0; fi
  done
  return 1
}

detect_host_resources() {
  local total_mb=8192 cores=4
  if [ -r /proc/meminfo ]; then
    total_mb=$(awk '/MemTotal/{printf "%d", $2/1024}' /proc/meminfo)
  elif command -v sysctl >/dev/null 2>&1; then
    local bytes; bytes=$(sysctl -n hw.memsize 2>/dev/null || echo 8589934592)
    total_mb=$((bytes / 1048576))
  fi
  if command -v nproc >/dev/null 2>&1; then
    cores=$(nproc)
  elif command -v sysctl >/dev/null 2>&1; then
    cores=$(sysctl -n hw.ncpu 2>/dev/null || echo 4)
  fi
  HOST_RAM_MB=$total_mb
  HOST_CORES=$cores

  # Safe allocation: half of host resources, clamped to [4096..8192] MB and [2..4] vCPUs
  REC_RAM=$(( total_mb / 2 ))
  if [ "$REC_RAM" -lt 4096 ]; then REC_RAM=4096; fi
  if [ "$REC_RAM" -gt 8192 ]; then REC_RAM=8192; fi
  REC_CPUS=$(( cores / 2 ))
  if [ "$REC_CPUS" -lt 2 ]; then REC_CPUS=2; fi
  if [ "$REC_CPUS" -gt 4 ]; then REC_CPUS=4; fi
}

resolve_ova_path() {
  if [ -n "$OVA_PATH" ]; then return 0; fi
  local script_dir; script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  for p in \
    "./$DEFAULT_OVA" \
    "$script_dir/$DEFAULT_OVA" \
    "$script_dir/../../$DEFAULT_OVA" \
    "$script_dir/../../release/$DEFAULT_OVA" \
    "$script_dir/../../dist/ova/$DEFAULT_OVA"; do
    if [ -f "$p" ]; then OVA_PATH="$p"; return 0; fi
  done
  OVA_PATH="./$DEFAULT_OVA"
}

verify_ova_integrity() {
  local target="$1"
  [ -f "$target" ] || die "Appliance file not found: $target"
  info "Computing SHA-256 digest of $target ..."
  local actual=""
  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$target" | awk '{print tolower($1)}')
  elif command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 "$target" | awk '{print tolower($1)}')
  else
    die "Neither sha256sum nor shasum is installed."
  fi

  local expected="${EXPECTED_SHA#sha256:}"
  if [ -z "$expected" ] && [ -f "${target}.sha256" ]; then
    expected=$(awk '{print tolower($1)}' "${target}.sha256" | head -1)
  fi

  if [ -n "$expected" ]; then
    expected=$(printf "%s" "$expected" | tr '[:upper:]' '[:lower:]')
    if [ "$actual" != "$expected" ]; then
      die "SHA-256 MISMATCH! Expected $expected, got $actual. Refusing to import tampered OVA."
    fi
    ok "SHA-256 verified: $actual"
  else
    warn "No .sha256 companion file supplied; computed SHA-256: $actual"
  fi
}

run_vbox() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "  [dry-run] %q" "$VBOX"
    for arg in "$@"; do printf " %q" "$arg"; done
    printf "\n"
  else
    "$VBOX" "$@"
  fi
}

apply_vm_import_and_hardening() {
  local ova="$1" name="$2" ram="$3" cpus="$4" net="$5" clip="$6" share="$7"
  info "Importing '$ova' as VM '$name' (${cpus} vCPUs, ${ram} MB RAM, net=${net}) ..."

  if [ "$DRY_RUN" -eq 0 ]; then
    if "$VBOX" list vms | grep -Fq "\"$name\""; then
      die "A VM named '$name' already exists in VirtualBox. Pass --name <other> or --uninstall."
    fi
  fi

  run_vbox import "$ova" --vsys 0 --vmname "$name" --cpus "$cpus" --memory "$ram"
  info "Applying KaliOS VirtualBox isolation & security boundaries ..."
  run_vbox modifyvm "$name" --nic1 "$net"
  run_vbox modifyvm "$name" --vrde off
  run_vbox modifyvm "$name" --draganddrop disabled
  run_vbox modifyvm "$name" --clipboard-mode "$clip"
  run_vbox modifyvm "$name" --graphicscontroller vmsvga --vram 128
  run_vbox modifyvm "$name" --audio-driver none
  run_vbox modifyvm "$name" --rtcuseutc on

  if [ -n "$share" ]; then
    [ -d "$share" ] || die "Shared folder path does not exist: $share"
    warn "Mounting opt-in read-only host folder '$share' as 'host-share'"
    run_vbox sharedfolder add "$name" --name "host-share" --hostpath "$share" --readonly --automount
  fi

  ok "HarmOS VM '$name' configured (NAT-isolated, VRDE off, drag-and-drop off)."
  if [ "$START_VM" -eq 1 ]; then
    info "Starting HarmOS VM '$name' ..."
    run_vbox startvm "$name" --type gui
  else
    printf "\n  Launch anytime with:  %q startvm %q --type gui\n" "$VBOX" "$name"
    printf "  First-boot login   :  username 'harmos' (password rotation enforced on first login)\n\n"
  fi
}

# ------------------------------------------------------------------------------
# 1. AUTO INSTALL FUNCTION
# ------------------------------------------------------------------------------
auto_install() {
  info "Running HarmOS AUTO INSTALL"
  detect_host_resources
  resolve_ova_path
  local ram="${CUSTOM_RAM}"
  local cpus="${CUSTOM_CPUS}"
  if [ "$ram" -le 0 ]; then ram="$REC_RAM"; fi
  if [ "$cpus" -le 0 ]; then cpus="$REC_CPUS"; fi

  info "Host detected: ${HOST_CORES} cores, ${HOST_RAM_MB} MB RAM -> Guest profile: ${cpus} vCPUs, ${ram} MB RAM"
  if [ "$DRY_RUN" -eq 0 ] || [ -f "$OVA_PATH" ]; then
    verify_ova_integrity "$OVA_PATH"
  else
    warn "Dry-run: OVA '$OVA_PATH' not verified on disk"
  fi
  apply_vm_import_and_hardening "$OVA_PATH" "$VM_NAME" "$ram" "$cpus" "nat" "bidirectional" ""
}

# ------------------------------------------------------------------------------
# 2. MANUAL INSTALL FUNCTION
# ------------------------------------------------------------------------------
manual_install() {
  info "Running HarmOS MANUAL INSTALL WIZARD"
  detect_host_resources
  resolve_ova_path

  local in_ova in_name in_cpus in_ram in_net in_clip in_share in_boot confirm
  read -r -p "1. Path to OVA [${OVA_PATH}]: " in_ova
  OVA_PATH="${in_ova:-$OVA_PATH}"
  verify_ova_integrity "$OVA_PATH"

  read -r -p "2. VirtualBox VM Name [${VM_NAME}]: " in_name
  VM_NAME="${in_name:-$VM_NAME}"

  read -r -p "3. Guest vCPUs (min 2, host has ${HOST_CORES}) [${REC_CPUS}]: " in_cpus
  local cpus="${in_cpus:-$REC_CPUS}"
  [[ "$cpus" =~ ^[0-9]+$ ]] && [ "$cpus" -ge 1 ] || die "Invalid vCPU count: $cpus"

  read -r -p "4. Guest RAM in MB (min 4096, host has ${HOST_RAM_MB} MB) [${REC_RAM}]: " in_ram
  local ram="${in_ram:-$REC_RAM}"
  [[ "$ram" =~ ^[0-9]+$ ]] && [ "$ram" -ge 2048 ] || die "Invalid RAM MB: $ram"

  printf "5. Network Isolation Mode:\n   [1] nat (Recommended: outbound OK, no unsolicited inbound)\n   [2] hostonly (Offline host-guest subnet only)\n   [3] none (Air-gapped — zero virtual NIC connectivity)\n"
  read -r -p "   Choice [1]: " in_net
  case "${in_net:-1}" in
    1|nat)      NET_MODE="nat" ;;
    2|hostonly) NET_MODE="hostonly" ;;
    3|none)     NET_MODE="none" ;;
    *)          die "Invalid network choice: $in_net" ;;
  esac

  printf "6. Clipboard Sharing:\n   [1] disabled (Strictest isolation)\n   [2] hosttoguest\n   [3] bidirectional (Default)\n"
  read -r -p "   Choice [3]: " in_clip
  case "${in_clip:-3}" in
    1) CLIPBOARD_MODE="disabled" ;;
    2) CLIPBOARD_MODE="hosttoguest" ;;
    3) CLIPBOARD_MODE="bidirectional" ;;
    *) die "Invalid clipboard choice" ;;
  esac

  read -r -p "7. Optional read-only host shared folder (leave blank for NONE): " in_share
  SHARED_DIR="${in_share:-}"

  read -r -p "8. Boot VM immediately after import? [y/N]: " in_boot
  [[ "${in_boot:-N}" =~ ^[Yy]$ ]] && START_VM=1 || START_VM=0

  printf "\n--- Manual Configuration Summary ---\n"
  printf "  OVA       : %s\n  VM Name   : %s\n  Resources : %s vCPUs / %s MB RAM\n  Network   : %s\n  Clipboard : %s\n  Host Share: %s\n\n" \
    "$OVA_PATH" "$VM_NAME" "$cpus" "$ram" "$NET_MODE" "$CLIPBOARD_MODE" "${SHARED_DIR:-none}"
  read -r -p "Proceed with installation? [y/N]: " confirm
  [[ "${confirm:-N}" =~ ^[Yy]$ ]] || die "Aborted by operator."

  apply_vm_import_and_hardening "$OVA_PATH" "$VM_NAME" "$ram" "$cpus" "$NET_MODE" "$CLIPBOARD_MODE" "$SHARED_DIR"
}

uninstall_vm() {
  local confirm
  read -r -p "Type DELETE to unregister and permanently remove VM '${VM_NAME}': " confirm
  [ "$confirm" = "DELETE" ] || die "Cancelled."
  run_vbox unregistervm "$VM_NAME" --delete
  ok "Removed VM '$VM_NAME'"
}

# ------------------------------------------------------------------------------
# Entrypoint
# ------------------------------------------------------------------------------
if [ "$MODE" = "verify" ]; then
  resolve_ova_path
  verify_ova_integrity "$OVA_PATH"
  exit 0
fi

VBOX=""
if VBOX=$(detect_vboxmanage); then
  ok "Found VirtualBox CLI: $VBOX"
elif [ "$DRY_RUN" -eq 1 ]; then
  VBOX="VBoxManage"
  warn "VBoxManage not installed on this machine — continuing in --dry-run preview mode"
else
  die "VBoxManage not found. Install Oracle VirtualBox 7.x+ from https://www.virtualbox.org/ or pass --dry-run."
fi

if [ -z "$MODE" ]; then
  printf "\n========================================================\n"
  printf "  HarmOS %s — VirtualBox Appliance Installer\n" "$VERSION"
  printf "========================================================\n"
  printf "  [1] Auto Install    (Recommended: host-tuned + NAT isolation)\n"
  printf "  [2] Manual Install  (Custom vCPUs, RAM, network, clipboard)\n"
  printf "  [3] Verify OVA      (SHA-256 integrity check only)\n"
  printf "  [4] Dry-Run Preview (Show VBoxManage commands without running)\n"
  printf "  [q] Quit\n\n"
  read -r -p "Select mode [1]: " choice
  case "${choice:-1}" in
    1) MODE="auto" ;;
    2) MODE="manual" ;;
    3) resolve_ova_path; verify_ova_integrity "$OVA_PATH"; exit 0 ;;
    4) DRY_RUN=1; MODE="auto" ;;
    q|Q) exit 0 ;;
    *) die "Invalid selection: $choice" ;;
  esac
fi

case "$MODE" in
  auto)      auto_install ;;
  manual)    manual_install ;;
  uninstall) uninstall_vm ;;
esac
