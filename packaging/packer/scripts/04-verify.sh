#!/usr/bin/env bash
# 04-verify.sh — in-guest build gate. A non-zero exit FAILS the Packer build, so a
# broken image is never exported and never checksummed as if it worked.
# STATUS: written, not executed in the authoring sandbox.
set -euo pipefail
fail=0
need() { if eval "$2" >/dev/null 2>&1; then echo "  ok   $1"; else echo "  FAIL $1"; fail=1; fi; }

echo "[harmos] build verification"
need "node >= 18"                     "[ \"\$(node -p 'process.versions.node.split(\".\")[0]')\" -ge 18 ]"
need "sidecar entrypoint present"     "test -f /opt/harmos/sidecar/index.js"
need "harmos-svc exists"              "id -u harmos-svc"
need "harmos-svc has no login shell"  "getent passwd harmos-svc | grep -q nologin"
need "harmos-svc not in sudo group"   "! id -nG harmos-svc | tr ' ' '\n' | grep -qx sudo"
need "nexus unit installed"           "test -f /etc/systemd/system/harmos-nexus.service"
need "nexus unit enabled"             "systemctl is-enabled harmos-nexus"
need "firstboot unit enabled"         "systemctl is-enabled harmos-firstboot"
need "unit binds loopback only"       "grep -q 'HOST=127.0.0.1' /etc/harmos/nexus.env"
need "desktop autostart installed"    "test -f /etc/xdg/autostart/aetherframe.desktop"
need "graphical target default"       "[ \"\$(systemctl get-default)\" = graphical.target ]"
need "workspace writable by service"  "sudo -u harmos-svc test -w /home/harmos/HarmOS/workspace"
need "base system NOT writable by svc" "! sudo -u harmos-svc test -w /opt/harmos"
need "no API keys baked into image"   "! grep -rlE '(sk-[A-Za-z0-9]{20,}|sk-or-v1-|AIza[0-9A-Za-z_-]{20,})' /opt/harmos --exclude-dir=node_modules"

# Start the backend once and prove it answers on loopback before we ship it.
systemctl start harmos-nexus || true
for i in $(seq 1 30); do curl -fsS --max-time 2 http://127.0.0.1:8787/ -o /dev/null && break; sleep 2; done
need "nexus answers on 127.0.0.1:8787" "curl -fsS --max-time 5 http://127.0.0.1:8787/ -o /dev/null"
need "nexus not on a routable address" "! ss -ltn | awk '{print \$4}' | grep -qE '^(0\.0\.0\.0|\[::\]):8787'"
systemctl stop harmos-nexus || true

[ "$fail" -eq 0 ] || { echo "[harmos] VERIFICATION FAILED — aborting the build"; exit 1; }
echo "[harmos] verification passed"
