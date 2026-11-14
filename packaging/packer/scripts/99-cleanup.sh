#!/usr/bin/env bash
# 99-cleanup.sh — strip build state and builder identity before export.
# Nothing personal, no credentials, no machine-specific keys may survive into the OVA.
# STATUS: written, not executed in the authoring sandbox.
set -euo pipefail
echo "[harmos] cleaning build state"

# Build-time escalation and credentials
rm -f /etc/sudoers.d/90-harmos-build
rm -rf /root/.ssh /home/harmos/.ssh /home/harmos/.bash_history /root/.bash_history
rm -f  /home/harmos/.wget-hsts /root/.wget-hsts

# Host identity is regenerated on first boot (see harmos-firstboot.sh)
rm -f /etc/ssh/ssh_host_*
truncate -s 0 /etc/machine-id
rm -f /var/lib/dbus/machine-id

# Any env file that could have captured a build secret
find / -maxdepth 4 -name '.env' -newermt '-1 day' -type f -print -delete 2>/dev/null || true
unset STARNET_CONNECTOR_ENCRYPTION_KEY HARMOS_BUILD_PASSWORD || true

# Installer / payload leftovers
rm -rf /tmp/harmos-payload /tmp/VBoxGuestAdditions.iso /var/lib/apt/lists/*
apt-get -y autoremove --purge >/dev/null 2>&1 || true
apt-get -y clean

# Logs and caches: ship a quiet machine, not the builder's history
journalctl --rotate >/dev/null 2>&1 || true
journalctl --vacuum-time=1s >/dev/null 2>&1 || true
find /var/log -type f -exec truncate -s 0 {} \; 2>/dev/null || true
rm -rf /home/harmos/.cache /root/.cache /root/.npm /home/harmos/.npm

# Zero free space so the exported disk compresses well
dd if=/dev/zero of=/EMPTY bs=1M status=none || true
rm -f /EMPTY
sync
echo "[harmos] cleanup complete — no builder credentials, keys or history remain"
