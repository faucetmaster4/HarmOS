#!/usr/bin/env bash
# 01-base.sh — base packages, Node 20, VirtualBox Guest Additions, optional Ollama.
# STATUS: written, not executed in the authoring sandbox.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get -y upgrade
apt-get -y install --no-install-recommends \
  curl ca-certificates gnupg git jq sqlite3 acl \
  build-essential dkms linux-headers-"$(uname -r)" \
  iproute2 lsof htop unzip rsync

# --- Node 20 (NodeSource) — the Nexus sidecar requires Node >= 18 ---
install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
apt-get update && apt-get -y install nodejs
node --version

# --- VirtualBox Guest Additions (clipboard, resolution, time sync) ---
if [ -f /tmp/VBoxGuestAdditions.iso ]; then
  mkdir -p /mnt/ga && mount -o loop,ro /tmp/VBoxGuestAdditions.iso /mnt/ga
  # Exit 2 means "installed, X not running yet" — acceptable at this stage.
  /mnt/ga/VBoxLinuxAdditions.run --nox11 || [ $? -eq 2 ]
  umount /mnt/ga && rmdir /mnt/ga
else
  echo "[harmos][warn] Guest Additions ISO not uploaded; clipboard and auto-resize will be unavailable"
fi

# --- Local inference runtime (binary only; NO model is downloaded at build time) ---
if curl -fsSL --max-time 60 https://ollama.com/install.sh -o /tmp/ollama.sh; then
  sh /tmp/ollama.sh || echo "[harmos][warn] Ollama install failed; HarmOS still boots and runs deterministic tools"
  rm -f /tmp/ollama.sh
  systemctl disable ollama 2>/dev/null || true   # the user opts in during first-run setup
else
  echo "[harmos][warn] could not fetch the Ollama installer; local AI must be installed by the user"
fi

echo "[harmos] base layer ready"
