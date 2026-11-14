#!/usr/bin/env bash
# harmos-firstboot — runs once, before the desktop session, on the first boot of a
# freshly imported HarmOS appliance. Its job is to make the shipped image safe:
# no builder credentials, no reused host identity, no stale machine-id.
# STATUS: written, not executed in the authoring sandbox.
set -euo pipefail
mkdir -p /var/log/harmos /var/lib/harmos
STAMP=/var/lib/harmos/.firstboot-done
LOG=/var/log/harmos/firstboot.log
exec >>"$LOG" 2>&1

[ -f "$STAMP" ] && { echo "[firstboot] already completed, nothing to do"; exit 0; }
echo "[firstboot] $(date -Is) initialising HarmOS appliance identity"

# 1. Unique machine identity for this import.
rm -f /etc/machine-id /var/lib/dbus/machine-id
systemd-machine-id-setup
ln -sf /etc/machine-id /var/lib/dbus/machine-id

# 2. Regenerate SSH host keys (build-time keys were deleted at export; ssh service stays disabled).
rm -f /etc/ssh/ssh_host_*
ssh-keygen -A

# 3. Force the desktop user to set their own password at first login.
chage -d 0 harmos || true
rm -f /etc/sudoers.d/90-harmos-build

# 4. Secure storage root for the Sovereign Vault. The data key is derived from the
#    user's passphrase during the AetherFrame welcome flow; nothing is pre-seeded here.
install -d -o harmos-svc -g harmos-svc -m 0700 /var/lib/harmos/vault
install -d -o harmos-svc -g harmos-svc -m 0700 /var/lib/harmos/memory
install -d -o harmos-svc -g harmos-svc -m 0750 /var/lib/harmos/outbox

# 5. Record detected resources so the Control Center shows real numbers and can
#    propose low-resource mode instead of guessing.
{
  echo "{"
  echo "  \"detected_at\": \"$(date -Is)\","
  echo "  \"cpus\": $(nproc),"
  echo "  \"mem_total_kb\": $(awk '/MemTotal/{print $2}' /proc/meminfo),"
  echo "  \"disk_free_kb\": $(df --output=avail -k / | tail -1 | tr -d ' '),"
  echo "  \"virtualbox_guest_additions\": $(lsmod | grep -q vboxguest && echo true || echo false),"
  echo "  \"ollama_installed\": $(command -v ollama >/dev/null && echo true || echo false),"
  echo "  \"low_resource_recommended\": $(awk '/MemTotal/{print ($2 < 6000000) ? "true" : "false"}' /proc/meminfo)"
  echo "}"
} > /var/lib/harmos/system-probe.json
chown harmos-svc:harmos-svc /var/lib/harmos/system-probe.json
chmod 0644 /var/lib/harmos/system-probe.json

# 6. Mark onboarding as pending so AetherFrame opens the welcome flow.
echo '{"onboarding":"pending","version":"0.1.0-alpha"}' > /var/lib/harmos/firstrun.json
chown harmos-svc:harmos-svc /var/lib/harmos/firstrun.json

touch "$STAMP"
echo "[firstboot] complete"
