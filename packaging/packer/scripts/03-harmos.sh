#!/usr/bin/env bash
# 03-harmos.sh — install the HarmOS runtime into the guest.
# Runs as root inside the Packer build VM. STATUS: written, not executed in the
# authoring sandbox (no VirtualBox there). Every command is ordinary, inspectable Linux.
set -euo pipefail

HARMOS_VERSION="${HARMOS_VERSION:-0.1.0-alpha}"
PAYLOAD=/tmp/harmos-payload
PREFIX=/opt/harmos
STATE=/var/lib/harmos
LOGS=/var/log/harmos

echo "[harmos] installing runtime ${HARMOS_VERSION}"

# --- 1. Accounts -------------------------------------------------------------
# harmos-svc: unprivileged service account that runs HarmOS Nexus. No login shell,
# no sudo, no membership in the desktop user's groups.
id -u harmos-svc >/dev/null 2>&1 || useradd --system --create-home \
  --home-dir /var/lib/harmos-svc --shell /usr/sbin/nologin harmos-svc
# harmos: the desktop user (interactive, in sudo for the explicit escalation flow).
id -u harmos >/dev/null 2>&1 || useradd --create-home --shell /bin/bash harmos
usermod -aG sudo harmos

install -d -o harmos-svc -g harmos-svc -m 0750 "$STATE" "$STATE/vault" "$STATE/memory" "$STATE/outbox"
install -d -o harmos-svc -g harmos-svc -m 0750 "$LOGS"
install -d -o harmos -g harmos -m 0755 /home/harmos/HarmOS /home/harmos/HarmOS/workspace

# --- 2. Runtime payload ------------------------------------------------------
rm -rf "$PREFIX"
install -d -m 0755 "$PREFIX"
cp -a "$PAYLOAD/." "$PREFIX/"
chown -R root:root "$PREFIX"          # agents cannot rewrite their own base system
chmod -R go-w "$PREFIX"

# The Nexus harness is the StarNet sidecar (Node 18+, no runtime deps for the core host).
if [ -f "$PREFIX/package.json" ]; then
  ( cd "$PREFIX" && npm ci --omit=dev --no-audit --no-fund ) || \
    echo "[harmos][warn] npm ci failed; optional native deps (node-pty, transformers) unavailable"
fi

# --- 3. Shared workspace grant (narrow, explicit) ----------------------------
# The service account may write ONLY into the workspace, the vault and the outbox.
setfacl -m u:harmos-svc:x   /home/harmos
setfacl -m u:harmos-svc:rwx /home/harmos/HarmOS /home/harmos/HarmOS/workspace
setfacl -m u:harmos:rx      "$STATE/outbox"

# --- 4. systemd + desktop autostart -----------------------------------------
install -m 0644 "$PREFIX/os/systemd/harmos-nexus.service"     /etc/systemd/system/
install -m 0644 "$PREFIX/os/systemd/harmos-firstboot.service" /etc/systemd/system/
install -m 0755 "$PREFIX/os/firstboot/harmos-firstboot.sh"    /usr/local/sbin/harmos-firstboot
install -d -m 0755 /etc/xdg/autostart
install -m 0644 "$PREFIX/os/desktop/aetherframe.desktop" /etc/xdg/autostart/

# Environment: bind the backend to loopback only. Never 0.0.0.0.
install -d -m 0750 /etc/harmos
cat >/etc/harmos/nexus.env <<'EOF'
HARMOS_EDITION=nexus-virtualbox
STARNET_DESKTOP_SHELL=0
HOST=127.0.0.1
PORT=8787
HARMOS_STATE_DIR=/var/lib/harmos
HARMOS_WORKSPACES=/home/harmos/HarmOS/workspace
HARMOS_LOG_DIR=/var/log/harmos
EOF
chmod 0640 /etc/harmos/nexus.env
chown root:harmos-svc /etc/harmos/nexus.env

systemctl daemon-reload
systemctl enable harmos-firstboot.service harmos-nexus.service
echo "[harmos] runtime installed"
