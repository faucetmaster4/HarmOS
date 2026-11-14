#!/usr/bin/env bash
# aetherframe-launch — open the AetherFrame desktop only after the Nexus backend is
# genuinely ready. If the backend never answers, show the real reason instead of a
# desktop that pretends to be connected.
# STATUS: written, not executed in the authoring sandbox.
set -uo pipefail
URL="http://127.0.0.1:8787/"
LOG="$HOME/.harmos-session.log"
exec >>"$LOG" 2>&1
echo "=== AetherFrame session $(date -Is) ==="

for i in $(seq 1 60); do
  if curl -fsS --max-time 2 "$URL" -o /dev/null; then
    echo "[aetherframe] backend ready after ${i} attempt(s)"
    BROWSER=$(command -v chromium-browser || command -v chromium || command -v firefox)
    exec "$BROWSER" --app="$URL" --window-size=1600,900 --disable-features=TranslateUI
  fi
  sleep 2
done

echo "[aetherframe] backend never became ready"
STATUS=$(systemctl is-active harmos-nexus 2>/dev/null || echo unknown)
ERR=$(tail -n 20 /var/log/harmos/nexus.err 2>/dev/null || echo "(no error log readable)")
zenity --error --width=560 --title="HarmOS Nexus did not start" \
  --text="AetherFrame will not open a desktop that is not backed by a running AI core.

harmos-nexus.service: ${STATUS}

Last errors:
${ERR}

Recover with:
  sudo systemctl status harmos-nexus
  sudo journalctl -u harmos-nexus -n 100 --no-pager
  sudo systemctl restart harmos-nexus" 2>/dev/null \
  || xmessage -center "HarmOS Nexus did not start (service: ${STATUS}). See $LOG and journalctl -u harmos-nexus."
exit 1
