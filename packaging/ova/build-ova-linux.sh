#!/usr/bin/env bash
# ==============================================================================
# HarmOS 0.1.0 — Reproducible Linux-Host OVA Builder & QEMU Smoke Verifier
# Produces: release/HarmOS-0.1.0-x86_64.ova (+ .sha256 + ova-manifest.json)
# ==============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="/tmp/harmos-ova-build"
STARNET_SRC="/tmp/starnet-runtime"
RELEASE_DIR="$REPO_ROOT/release"
OVA_NAME="HarmOS-0.1.0-x86_64"
OVA_FILE="$RELEASE_DIR/${OVA_NAME}.ova"

MNT="$WORK/mnt"
LOOP_ROOT=""
LOOP_BOOT=""
TEST_LOOP=""

cleanup() {
  set +e
  for mp in "$MNT/dev/pts" "$MNT/dev" "$MNT/proc" "$MNT/sys" "$MNT/boot/efi" "$MNT/boot" "$MNT"; do
    mountpoint -q "$mp" 2>/dev/null && sudo umount -lf "$mp"
  done
  [ -n "$LOOP_BOOT" ] && sudo losetup -d "$LOOP_BOOT" 2>/dev/null
  [ -n "$LOOP_ROOT" ] && sudo losetup -d "$LOOP_ROOT" 2>/dev/null
  [ -n "$TEST_LOOP" ] && sudo losetup -d "$TEST_LOOP" 2>/dev/null
}
trap cleanup EXIT

mkdir -p "$WORK" "$MNT" "$RELEASE_DIR"

echo "[1/7] Fetching & SHA-256 verifying Canonical Ubuntu 24.04 LTS image..."
cd "$WORK"
if [ ! -f noble-server-cloudimg-amd64.img ]; then
  curl -fSL --retry 3 -o SHA256SUMS https://cloud-images.ubuntu.com/noble/current/SHA256SUMS
  curl -fSL --retry 3 -o noble-server-cloudimg-amd64.img https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img
fi
grep ' \*noble-server-cloudimg-amd64\.img$' SHA256SUMS | sha256sum -c -

echo "[2/7] Converting to 30 GB sparse RAW image & expanding rootfs..."
rm -f "$WORK/harmos-30g.raw"
qemu-img convert -f qcow2 -O raw noble-server-cloudimg-amd64.img "$WORK/harmos-30g.raw"
truncate -s 30G "$WORK/harmos-30g.raw"
sudo sgdisk -e "$WORK/harmos-30g.raw" >/dev/null

P1_START=$(sudo sgdisk -p "$WORK/harmos-30g.raw" | awk '$1==1{print $2}')
P1_GUID=$(sudo sgdisk -i 1 "$WORK/harmos-30g.raw" | awk -F': ' '/Partition unique GUID/{print $2}')
P16_START=$(sudo sgdisk -p "$WORK/harmos-30g.raw" | awk '$1==16{print $2}')
P16_END=$(sudo sgdisk -p "$WORK/harmos-30g.raw" | awk '$1==16{print $3}')

sudo sgdisk -d 1 -n "1:${P1_START}:0" -t 1:8300 -u "1:${P1_GUID}" "$WORK/harmos-30g.raw" >/dev/null
P1_END=$(sudo sgdisk -p "$WORK/harmos-30g.raw" | awk '$1==1{print $3}')
P1_BYTES=$(((P1_END - P1_START + 1) * 512))
LOOP_ROOT=$(sudo losetup -f --show -o $((P1_START * 512)) --sizelimit "$P1_BYTES" "$WORK/harmos-30g.raw")
sudo e2fsck -f -y "$LOOP_ROOT" >/dev/null 2>&1 || true
sudo resize2fs "$LOOP_ROOT" >/dev/null

echo "[3/7] Mounting guest filesystems and provisioning HarmOS runtime..."
sudo mount "$LOOP_ROOT" "$MNT"
if [ -n "${P16_START:-}" ] && [ -n "${P16_END:-}" ]; then
  LOOP_BOOT=$(sudo losetup -f --show -o $((P16_START * 512)) --sizelimit $(((P16_END - P16_START + 1) * 512)) "$WORK/harmos-30g.raw")
  sudo mkdir -p "$MNT/boot"
  sudo mount "$LOOP_BOOT" "$MNT/boot"
fi
sudo mount --bind /dev "$MNT/dev"
sudo mount --bind /dev/pts "$MNT/dev/pts"
sudo mount -t proc proc "$MNT/proc"
sudo mount -t sysfs sysfs "$MNT/sys"

sudo rm -f "$MNT/etc/resolv.conf"
sudo cp /etc/resolv.conf "$MNT/etc/resolv.conf"

# Prevent daemons from starting inside chroot during package installation
sudo tee "$MNT/usr/sbin/policy-rc.d" >/dev/null <<'EOF'
#!/bin/sh
exit 101
EOF
sudo chmod +x "$MNT/usr/sbin/policy-rc.d"

sudo chroot "$MNT" /bin/bash -eux <<'CHROOT_PKG'
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends \
  nodejs ca-certificates curl jq sqlite3 acl ufw fail2ban rkhunter \
  iproute2 lsof procps psmisc sudo openssh-server \
  xorg xfce4-session xfwm4 xfce4-panel xfce4-terminal lightdm lightdm-gtk-greeter dbus-x11 x11-xserver-utils xdg-utils
node --version
CHROOT_PKG

echo "[4/7] Installing HarmOS Nexus (StarNet-derived harness), AetherFrame & KaliOS hardening..."
sudo install -d -m 0755 "$MNT/opt/harmos" "$MNT/opt/harmos/frontend"
sudo cp -a "$STARNET_SRC/sidecar" "$STARNET_SRC/shared" "$STARNET_SRC/package.json" \
           "$STARNET_SRC/LICENSE" "$STARNET_SRC/NOTICE.md" "$MNT/opt/harmos/"
sudo cp -a "$STARNET_SRC/frontend/app" "$STARNET_SRC/frontend/js" "$MNT/opt/harmos/frontend/"
sudo cp -a "$STARNET_SRC/node_modules" "$MNT/opt/harmos/"
sudo cp -a "$REPO_ROOT/os" "$REPO_ROOT/tests" "$REPO_ROOT/docs" "$MNT/opt/harmos/"

# Split built dist/index.html into CSP-clean external bundle + stylesheet for sidecar/index.js ('self' CSP)
sudo node - "$REPO_ROOT/dist/index.html" "$MNT/opt/harmos/frontend" <<'SPLIT_EOF'
const fs = require('fs');
const path = require('path');
const [srcHtml, outDir] = process.argv.slice(2);
let html = fs.readFileSync(srcHtml, 'utf8');
let jsIdx = 0, cssIdx = 0;
html = html.replace(/<script type="module" crossorigin>([\s\S]*?)<\/script>/g, (_, code) => {
  const fn = `harmos-app-${++jsIdx}.js`;
  fs.writeFileSync(path.join(outDir, fn), code);
  return `<script type="module" src="/${fn}"></script>`;
});
html = html.replace(/<style rel="stylesheet" crossorigin>([\s\S]*?)<\/style>/g, (_, css) => {
  const fn = `harmos-style-${++cssIdx}.css`;
  fs.writeFileSync(path.join(outDir, fn), css);
  return `<link rel="stylesheet" href="/${fn}">`;
});
fs.writeFileSync(path.join(outDir, 'index.html'), html);
SPLIT_EOF

# Install KaliOS kernel & firewall hardening files
sudo install -m 0644 "$REPO_ROOT/os/security/99-harmos-hardening.conf" "$MNT/etc/sysctl.d/99-harmos-hardening.conf"
sudo install -d -m 0755 "$MNT/etc/fail2ban/jail.d"
sudo install -m 0644 "$REPO_ROOT/os/security/fail2ban-harmos.local" "$MNT/etc/fail2ban/jail.d/harmos.local"
sudo install -m 0755 "$REPO_ROOT/os/security/ufw-harmos.sh" "$MNT/usr/local/sbin/ufw-harmos"

# Install systemd units, firstboot, desktop autostart
sudo install -m 0644 "$REPO_ROOT/os/systemd/harmos-nexus.service"     "$MNT/etc/systemd/system/harmos-nexus.service"
sudo install -m 0644 "$REPO_ROOT/os/systemd/harmos-firstboot.service" "$MNT/etc/systemd/system/harmos-firstboot.service"
sudo install -m 0755 "$REPO_ROOT/os/firstboot/harmos-firstboot.sh"    "$MNT/usr/local/sbin/harmos-firstboot"
sudo install -d -m 0755 "$MNT/etc/xdg/autostart"
sudo install -m 0644 "$REPO_ROOT/os/desktop/aetherframe.desktop"      "$MNT/etc/xdg/autostart/aetherframe.desktop"
sudo chmod 0755 "$MNT/opt/harmos/os/desktop/aetherframe-launch.sh" "$MNT/opt/harmos/tests/smoke-appliance.sh"

# Configure accounts, permissions, NAT DHCP netplan, disable cloud-init boot delays, seal image
sudo chroot "$MNT" /bin/bash -eux <<'CHROOT_CFG'
id -u harmos-svc >/dev/null 2>&1 || useradd --system --create-home \
  --home-dir /var/lib/harmos-svc --shell /usr/sbin/nologin harmos-svc
id -u harmos >/dev/null 2>&1 || useradd --create-home --shell /bin/bash harmos
usermod -aG sudo harmos
echo 'harmos:harmos-first-login' | chpasswd
chage -d 0 harmos

install -d -o harmos-svc -g harmos-svc -m 0700 /var/lib/harmos /var/lib/harmos/vault /var/lib/harmos/memory /var/lib/harmos-svc
install -d -o harmos-svc -g harmos-svc -m 0750 /var/lib/harmos/outbox /var/log/harmos
install -d -o harmos -g harmos -m 0755 /home/harmos/HarmOS /home/harmos/HarmOS/workspace
setfacl -m u:harmos-svc:x /home/harmos
setfacl -m u:harmos-svc:rwx /home/harmos/HarmOS /home/harmos/HarmOS/workspace

chown -R root:root /opt/harmos
chmod -R go-w /opt/harmos

install -d -m 0750 /etc/harmos
cat >/etc/harmos/nexus.env <<'EOF'
HARMOS_EDITION=nexus-virtualbox
STARNET_DESKTOP_SHELL=0
HOST=127.0.0.1
PORT=8787
STARNET_PORT=8787
STARNET_DATA_DIR=/var/lib/harmos
STARNET_WORKSPACES=/home/harmos/HarmOS/workspace
HARMOS_STATE_DIR=/var/lib/harmos
HARMOS_WORKSPACES=/home/harmos/HarmOS/workspace
HARMOS_LOG_DIR=/var/log/harmos
HOME=/var/lib/harmos-svc
EOF
chown root:harmos-svc /etc/harmos/nexus.env
chmod 0640 /etc/harmos/nexus.env

# Ensure VirtualBox & QEMU NICs (en* / eth*) come up immediately via systemd-networkd DHCP
rm -f /etc/netplan/*.yaml
cat >/etc/netplan/10-harmos-dhcp.yaml <<'EOF'
network:
  version: 2
  ethernets:
    all-en:
      match:
        name: "en*"
      dhcp4: true
      optional: true
    all-eth:
      match:
        name: "eth*"
      dhcp4: true
      optional: true
EOF
chmod 0600 /etc/netplan/10-harmos-dhcp.yaml

# Disable cloud-init so VirtualBox boot never stalls on metadata probes
touch /etc/cloud/cloud-init.disabled

# Hostname & LightDM defaults
echo "harmos" >/etc/hostname
grep -q 'harmos' /etc/hosts || echo "127.0.1.1 harmos" >>/etc/hosts
install -d -m 0755 /etc/lightdm/lightdm.conf.d
cat >/etc/lightdm/lightdm.conf.d/50-harmos.conf <<'EOF'
[Seat:*]
user-session=xfce
greeter-hide-users=false
allow-guest=false
EOF

systemctl enable harmos-firstboot.service harmos-nexus.service fail2ban.service
systemctl disable ssh.service ssh.socket 2>/dev/null || true
systemctl set-default graphical.target

# Clean build state, apt cache, SSH host keys & machine-id before sealing
rm -f /usr/sbin/policy-rc.d /etc/sudoers.d/90-harmos-build /etc/ssh/ssh_host_*
apt-get clean
rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* /root/.bash_history
find /var/log -type f -exec truncate -s 0 {} \;
truncate -s 0 /etc/machine-id
rm -f /var/lib/dbus/machine-id
ln -sf /etc/machine-id /var/lib/dbus/machine-id
CHROOT_CFG

KERNEL_VER=$(ls "$MNT/lib/modules" | sort -V | tail -1)
echo "Guest Linux kernel version: $KERNEL_VER"

# Unmount pristine image cleanly
sync
for mp in "$MNT/dev/pts" "$MNT/dev" "$MNT/proc" "$MNT/sys" "$MNT/boot" "$MNT"; do
  mountpoint -q "$mp" 2>/dev/null && sudo umount "$mp"
done
[ -n "$LOOP_BOOT" ] && sudo losetup -d "$LOOP_BOOT" && LOOP_BOOT=""
sudo losetup -d "$LOOP_ROOT"
LOOP_ROOT=""

echo "[5/7] Booting sparse clone in QEMU x86_64 to run real in-guest smoke-appliance.sh..."
cp --sparse=always "$WORK/harmos-30g.raw" "$WORK/boot-test.raw"
TEST_LOOP=$(sudo losetup -f --show -o $((P1_START * 512)) --sizelimit "$P1_BYTES" "$WORK/boot-test.raw")
sudo mount "$TEST_LOOP" "$MNT"

# Inject oneshot smoke-runner into the disposable clone ONLY (pristine image stays untouched)
sudo tee "$MNT/etc/systemd/system/harmos-ci-smoke.service" >/dev/null <<'EOF'
[Unit]
Description=HarmOS In-Guest Automated Smoke Verification
After=harmos-firstboot.service harmos-nexus.service
Requires=harmos-firstboot.service harmos-nexus.service

[Service]
Type=oneshot
TimeoutStartSec=300
ExecStart=/bin/bash -c 'for i in $(seq 1 60); do curl -fsS http://127.0.0.1:8787/api/health >/dev/null 2>&1 && break; sleep 2; done; echo "===HARMOS_SMOKE_BEGIN===" >/dev/ttyS0; uname -srmo >/dev/ttyS0; bash /opt/harmos/tests/smoke-appliance.sh >/dev/ttyS0 2>&1; echo "SMOKE_EXIT=$?" >/dev/ttyS0; echo "===HARMOS_SMOKE_END===" >/dev/ttyS0; poweroff -f'
StandardOutput=journal+console
StandardError=journal+console

[Install]
WantedBy=multi-user.target
EOF
sudo ln -sf /etc/systemd/system/harmos-ci-smoke.service "$MNT/etc/systemd/system/multi-user.target.wants/harmos-ci-smoke.service"
# Boot into multi-user.target for fast headless serial verification
sudo ln -sf /lib/systemd/system/multi-user.target "$MNT/etc/systemd/system/default.target"
sync
sudo umount "$MNT"
sudo losetup -d "$TEST_LOOP"
TEST_LOOP=""

SMOKE_LOG="$WORK/qemu-serial.log"
rm -f "$SMOKE_LOG"
timeout 420 qemu-system-x86_64 \
  -cpu max -m 1024 -smp 2 \
  -drive file="$WORK/boot-test.raw",format=raw,if=virtio \
  -netdev user,id=net0 \
  -device e1000,netdev=net0 \
  -nographic -no-reboot >"$SMOKE_LOG" 2>&1 || true

rm -f "$WORK/boot-test.raw"

echo "--- Extracted QEMU Guest Smoke Output ---"
sed -n '/===HARMOS_SMOKE_BEGIN===/,/===HARMOS_SMOKE_END===/p' "$SMOKE_LOG" | tee "$WORK/smoke-summary.txt"
grep -q "SMOKE_EXIT=0" "$WORK/smoke-summary.txt" || {
  echo "QEMU SMOKE TEST FAILED! Last 60 serial lines:"
  tail -n 60 "$SMOKE_LOG"
  exit 1
}

echo "[6/7] Converting pristine 30 GB disk to OVF 1.0 streamOptimized VMDK..."
VMDK_NAME="${OVA_NAME}-disk001.vmdk"
OVF_NAME="${OVA_NAME}.ovf"
MF_NAME="${OVA_NAME}.mf"
STAGE="$WORK/ova-stage"
rm -rf "$STAGE" && mkdir -p "$STAGE"

qemu-img convert -f raw -O vmdk -o subformat=streamOptimized \
  "$WORK/harmos-30g.raw" "$STAGE/$VMDK_NAME"
rm -f "$WORK/harmos-30g.raw" "$WORK/noble-server-cloudimg-amd64.img"

VMDK_BYTES=$(stat -c %s "$STAGE/$VMDK_NAME")
DISK_UUID=$(cat /proc/sys/kernel/random/uuid)
VM_UUID=$(cat /proc/sys/kernel/random/uuid)

cat >"$STAGE/$OVF_NAME" <<EOF
<?xml version="1.0"?>
<Envelope ovf:version="1.0" xml:lang="en-US"
  xmlns="http://schemas.dmtf.org/ovf/envelope/1"
  xmlns:ovf="http://schemas.dmtf.org/ovf/envelope/1"
  xmlns:rasd="http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_ResourceAllocationSettingData"
  xmlns:vssd="http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_VirtualSystemSettingData"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:vbox="http://www.virtualbox.org/ovf/machine">
  <References>
    <File ovf:href="${VMDK_NAME}" ovf:id="file1" ovf:size="${VMDK_BYTES}"/>
  </References>
  <DiskSection>
    <Info>Virtual disk information</Info>
    <Disk ovf:capacity="32212254720" ovf:diskId="vmdisk1" ovf:fileRef="file1"
          ovf:format="http://www.vmware.com/interfaces/specifications/vmdk.html#streamOptimized"
          vbox:uuid="${DISK_UUID}"/>
  </DiskSection>
  <NetworkSection>
    <Info>Logical networks used in the package</Info>
    <Network ovf:name="NAT">
      <Description>Default isolated NAT network</Description>
    </Network>
  </NetworkSection>
  <VirtualSystem ovf:id="HarmOS-0.1.0-x86_64">
    <Info>HarmOS Nexus — VirtualBox Edition (0.1.0-alpha)</Info>
    <ProductSection>
      <Info>Product metadata</Info>
      <Product>HarmOS Nexus — VirtualBox Edition</Product>
      <Vendor>HarmOS Project (StarNet MIT derivative)</Vendor>
      <Version>0.1.0-alpha</Version>
      <FullVersion>0.1.0-alpha-x86_64</FullVersion>
    </ProductSection>
    <OperatingSystemSection ovf:id="94">
      <Info>Ubuntu 24.04 LTS 64-bit</Info>
      <Description>Ubuntu_64</Description>
      <vbox:OSType ovf:required="false">Ubuntu_64</vbox:OSType>
    </OperatingSystemSection>
    <VirtualHardwareSection>
      <Info>Virtual hardware requirements for HarmOS</Info>
      <System>
        <vssd:ElementName>Virtual Hardware Family</vssd:ElementName>
        <vssd:InstanceID>0</vssd:InstanceID>
        <vssd:VirtualSystemIdentifier>HarmOS-0.1.0-x86_64</vssd:VirtualSystemIdentifier>
        <vssd:VirtualSystemType>virtualbox-2.2</vssd:VirtualSystemType>
      </System>
      <Item>
        <rasd:Caption>4 virtual CPU</rasd:Caption>
        <rasd:Description>Number of virtual CPUs</rasd:Description>
        <rasd:ElementName>4 virtual CPU</rasd:ElementName>
        <rasd:InstanceID>1</rasd:InstanceID>
        <rasd:ResourceType>3</rasd:ResourceType>
        <rasd:VirtualQuantity>4</rasd:VirtualQuantity>
      </Item>
      <Item>
        <rasd:AllocationUnits>MegaBytes</rasd:AllocationUnits>
        <rasd:Caption>4096 MB of memory</rasd:Caption>
        <rasd:Description>Memory Size</rasd:Description>
        <rasd:ElementName>4096 MB of memory</rasd:ElementName>
        <rasd:InstanceID>2</rasd:InstanceID>
        <rasd:ResourceType>4</rasd:ResourceType>
        <rasd:VirtualQuantity>4096</rasd:VirtualQuantity>
      </Item>
      <Item>
        <rasd:Address>0</rasd:Address>
        <rasd:Caption>sataController0</rasd:Caption>
        <rasd:Description>SATA Controller</rasd:Description>
        <rasd:ElementName>sataController0</rasd:ElementName>
        <rasd:InstanceID>3</rasd:InstanceID>
        <rasd:ResourceSubType>AHCI</rasd:ResourceSubType>
        <rasd:ResourceType>20</rasd:ResourceType>
      </Item>
      <Item>
        <rasd:AddressOnParent>0</rasd:AddressOnParent>
        <rasd:ElementName>disk1</rasd:ElementName>
        <rasd:HostResource>ovf:/disk/vmdisk1</rasd:HostResource>
        <rasd:InstanceID>4</rasd:InstanceID>
        <rasd:Parent>3</rasd:Parent>
        <rasd:ResourceType>17</rasd:ResourceType>
      </Item>
      <Item>
        <rasd:AutomaticAllocation>true</rasd:AutomaticAllocation>
        <rasd:Caption>Ethernet adapter on 'NAT'</rasd:Caption>
        <rasd:Connection>NAT</rasd:Connection>
        <rasd:ElementName>Ethernet adapter on 'NAT'</rasd:ElementName>
        <rasd:InstanceID>5</rasd:InstanceID>
        <rasd:ResourceSubType>E1000</rasd:ResourceSubType>
        <rasd:ResourceType>10</rasd:ResourceType>
      </Item>
    </VirtualHardwareSection>
    <vbox:Machine ovf:required="false" version="1.19-linux" uuid="{${VM_UUID}}" name="HarmOS-0.1.0-x86_64" OSType="Ubuntu_64">
      <ovf:Info>VirtualBox machine configuration</ovf:Info>
      <Hardware>
        <CPU count="4"><PAE enabled="true"/><LongMode enabled="true"/></CPU>
        <Memory RAMSize="4096"/>
        <Display controller="VMSVGA" VRAMSize="128"/>
        <BIOS><IOAPIC enabled="true"/></BIOS>
        <Network>
          <Adapter slot="0" enabled="true" cable="true" type="82540EM"><NAT/></Adapter>
        </Network>
        <Clipboard mode="Bidirectional"/>
        <DragAndDrop mode="Disabled"/>
      </Hardware>
      <StorageControllers>
        <StorageController name="SATA" type="AHCI" PortCount="1" useHostIOCache="false" Bootable="true">
          <AttachedDevice type="HardDisk" port="0" device="0">
            <Image uuid="{${DISK_UUID}}"/>
          </AttachedDevice>
        </StorageController>
      </StorageControllers>
    </vbox:Machine>
  </VirtualSystem>
</Envelope>
EOF

OVF_SHA=$(sha256sum "$STAGE/$OVF_NAME" | awk '{print $1}')
VMDK_SHA=$(sha256sum "$STAGE/$VMDK_NAME" | awk '{print $1}')
cat >"$STAGE/$MF_NAME" <<EOF
SHA256(${OVF_NAME})= ${OVF_SHA}
SHA256(${VMDK_NAME})= ${VMDK_SHA}
EOF

echo "[7/7] Packaging OVF 1.0 archive: $OVA_FILE ..."
(
  cd "$STAGE"
  # OVF 1.0 spec requires ustar tar with .ovf FIRST, then .mf, then disks
  tar --format=ustar -cf "$OVA_FILE" "$OVF_NAME" "$MF_NAME" "$VMDK_NAME"
)
rm -rf "$STAGE"

OVA_BYTES=$(stat -c %s "$OVA_FILE")
OVA_SHA=$(sha256sum "$OVA_FILE" | awk '{print $1}')
printf "%s  %s\n" "$OVA_SHA" "${OVA_NAME}.ova" >"${OVA_FILE}.sha256"

# Copy installers alongside the OVA in release/
cp "$REPO_ROOT/packaging/installer/HarmOS-Installer.exe" "$RELEASE_DIR/HarmOS-Installer.exe"
cp "$REPO_ROOT/packaging/installer/install-harmos.sh"    "$RELEASE_DIR/install-harmos.sh"

node - "$RELEASE_DIR/ova-manifest.json" "$OVA_BYTES" "$OVA_SHA" "$VMDK_BYTES" "$KERNEL_VER" "$WORK/smoke-summary.txt" <<'META_EOF'
const fs = require('fs');
const [out, ovaBytes, ovaSha, vmdkBytes, kver, smokeFile] = process.argv.slice(2);
const transcript = fs.readFileSync(smokeFile, 'utf8').trim();
const resLine = (transcript.match(/RESULT:.*$/m) || ['in-guest smoke test passed'])[0];
fs.writeFileSync(out, JSON.stringify({
  built: true,
  filename: 'HarmOS-0.1.0-x86_64.ova',
  path: 'release/HarmOS-0.1.0-x86_64.ova',
  sizeBytes: Number(ovaBytes),
  sha256: ovaSha,
  vmdkName: 'HarmOS-0.1.0-x86_64-disk001.vmdk',
  vmdkSizeBytes: Number(vmdkBytes),
  virtualDiskGb: 30,
  guestOs: 'Ubuntu 24.04 LTS (Noble Numbat) x86_64',
  kernelVersion: kver,
  builtAt: new Date().toISOString(),
  qemuBootVerified: true,
  smokeSummary: `QEMU x86_64 guest boot verified — ${resLine}`,
  smokeTranscript: transcript,
}, null, 2));
META_EOF

echo "=== OVA BUILD COMPLETE ==="
ls -lh "$RELEASE_DIR"
cat "${OVA_FILE}.sha256"
