#!/usr/bin/env bash
# KaliOS Zero-Trust Host Firewall Baseline (UFW)
# Default-deny all inbound traffic; allow loopback only; outbound permitted for user-approved updates/models.
set -euo pipefail

if command -v ufw >/dev/null 2>&1; then
  ufw --force reset
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow in on lo
  # HarmOS Nexus port 8787 is explicitly denied on non-loopback interfaces as defense-in-depth
  ufw deny in proto tcp to any port 8787
  ufw --force enable || true
fi
