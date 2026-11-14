#!/usr/bin/env bash
# 02-desktop.sh — XFCE session, display manager, AetherFrame kiosk shell.
# XFCE is chosen over GNOME/KDE because it runs acceptably in a 4 GB, GPU-less
# VirtualBox guest, which is the stated minimum target.
# STATUS: written, not executed in the authoring sandbox.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get -y install --no-install-recommends \
  xfce4 xfce4-terminal xfce4-taskmanager \
  lightdm lightdm-gtk-greeter \
  dbus-x11 x11-xserver-utils xdg-utils fonts-inter \
  network-manager policykit-1 gnome-keyring libsecret-1-0 \
  chromium-browser || apt-get -y install --no-install-recommends chromium

systemctl set-default graphical.target
systemctl enable lightdm

# LightDM: no autologin. The first login forces a password change (chage -d 0).
install -d -m 0755 /etc/lightdm/lightdm.conf.d
cat >/etc/lightdm/lightdm.conf.d/50-harmos.conf <<'EOF'
[Seat:*]
user-session=xfce
greeter-hide-users=false
allow-guest=false
EOF

# Dark, high-contrast XFCE defaults so AetherFrame is not framed by a light desktop.
install -d -m 0755 /etc/skel/.config/xfce4/xfconf/xfce-perchannel-xml
cat >/etc/skel/.config/xfce4/xfconf/xfce-perchannel-xml/xsettings.xml <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<channel name="xsettings" version="1.0">
  <property name="Net" type="empty">
    <property name="ThemeName" type="string" value="Adwaita-dark"/>
    <property name="IconThemeName" type="string" value="Adwaita"/>
  </property>
</channel>
EOF

echo "[harmos] desktop layer ready"
