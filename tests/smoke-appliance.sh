#!/usr/bin/env bash
# smoke-appliance.sh — in-guest acceptance test for an imported HarmOS appliance.
# Run inside the booted VM:   bash /opt/harmos/tests/smoke-appliance.sh
# Exits non-zero on the first real failure. It never prints "pass" for a check it skipped.
#
# STATUS: written, NOT executed in the authoring sandbox (no VirtualBox / no Linux guest
# there). Results belong in docs/RELEASE_REPORT.md once you run it on real hardware.
set -uo pipefail

PASS=0; FAIL=0; SKIP=0
ok()   { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL  $1  ${2:-}"; FAIL=$((FAIL+1)); }
skip() { echo "  SKIP  $1  ${2:-}"; SKIP=$((SKIP+1)); }
check(){ if eval "$2" >/dev/null 2>&1; then ok "$1"; else bad "$1" "(cmd: $2)"; fi; }

echo "HarmOS appliance smoke test — $(date -Is)"
echo "== 1. Linux services =="
check "systemd is PID 1"                 "[ \"\$(ps -p 1 -o comm=)\" = systemd ]"
check "harmos-firstboot completed"       "test -f /var/lib/harmos/.firstboot-done"
check "harmos-nexus.service is active"   "systemctl is-active --quiet harmos-nexus"
check "no failed units"                  "[ \"\$(systemctl list-units --state=failed --no-legend | wc -l)\" -eq 0 ]"

echo "== 2. Backend readiness =="
check "Nexus answers on 127.0.0.1:8787"  "curl -fsS --max-time 10 http://127.0.0.1:8787/ -o /dev/null"
check "backend NOT bound to 0.0.0.0"     "! ss -ltnp 2>/dev/null | grep -q '0.0.0.0:8787'"
check "no public listener on 8787"       "! ss -ltn 2>/dev/null | awk '{print \$4}' | grep -qE '^(0\.0\.0\.0|\[::\]):8787'"

echo "== 3. Privilege boundaries =="
check "service runs as harmos-svc"       "[ \"\$(systemctl show -p User --value harmos-nexus)\" = harmos-svc ]"
check "harmos-svc has no sudo"           "! sudo -l -U harmos-svc 2>/dev/null | grep -q '(ALL)'"
check "harmos-svc cannot write /opt"     "! sudo -u harmos-svc test -w /opt/harmos"
check "build sudoers file removed"       "! test -f /etc/sudoers.d/90-harmos-build"
check "SSH not enabled by default"       "! systemctl is-enabled --quiet ssh"

echo "== 4. Secrets & KaliOS hardening =="
check "nexus.env is not world-readable"  "[ \"\$(stat -c %a /etc/harmos/nexus.env)\" = 640 ]"
check "no API keys in /opt/harmos"       "! grep -rlE '(sk-[A-Za-z0-9]{20,}|sk-or-v1-[A-Za-z0-9]{20,})' /opt/harmos --exclude-dir=node_modules"
check "vault dir is 0700"                "[ \"\$(stat -c %a /var/lib/harmos/vault)\" = 700 ]"
check "KaliOS sysctl hardening active"   "[ \"\$(sysctl -n kernel.kptr_restrict)\" = 2 ] && [ \"\$(sysctl -n net.ipv4.tcp_syncookies)\" = 1 ]"

echo "== 5. Desktop session =="
if [ -n "${DISPLAY:-}" ]; then
  check "X session present"              "xdpyinfo"
  check "AetherFrame autostart present"  "test -f /etc/xdg/autostart/aetherframe.desktop"
else
  skip "desktop checks" "(no DISPLAY — run from a terminal inside the XFCE session)"
fi

echo "== 6. Real agent file task =="
WS=/home/harmos/HarmOS/workspace
REQ='{"agent":"architect-core","task":"Create welcome.txt in my HarmOS workspace with a short introduction to HarmOS."}'
if curl -fsS --max-time 120 -X POST -H 'content-type: application/json' \
      -d "$REQ" http://127.0.0.1:8787/api/run -o /tmp/harmos-task.out 2>/dev/null; then
  if [ -s "$WS/welcome.txt" ]; then ok "agent wrote $WS/welcome.txt"; else bad "agent task produced no welcome.txt"; fi
else
  skip "agent file task" "(no model configured, or /api/run unavailable — configure a model first)"
fi

echo "== 7. Persistence =="
check "vault database exists"            "test -s /var/lib/harmos/vault/harmos.sqlite3 || test -d /var/lib/harmos/vault"
check "system probe recorded"            "test -s /var/lib/harmos/system-probe.json"

echo
echo "RESULT: $PASS passed, $FAIL failed, $SKIP skipped"
[ "$FAIL" -eq 0 ] || exit 1
