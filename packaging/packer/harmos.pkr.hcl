// HarmOS Nexus — VirtualBox Edition
// Packer template that builds HarmOS-0.1.0-x86_64.ova from an Ubuntu 24.04 LTS Server ISO.
//
// STATUS: WRITTEN, NOT EXECUTED in the authoring sandbox (no VirtualBox / no KVM / no
// hardware virtualisation available there). Run it on a Windows 10 x64 host that has
// Oracle VirtualBox >= 7.0 and Packer >= 1.11 installed. See docs/WINDOWS_INSTALL.md.
//
//   packer init  .
//   packer build -var-file=harmos.pkrvars.hcl .

packer {
  required_plugins {
    virtualbox = {
      version = ">= 1.1.1"
      source  = "github.com/hashicorp/virtualbox"
    }
  }
}

variable "iso_url" {
  type        = string
  description = "Ubuntu 24.04 LTS live-server ISO (local path or https URL)."
  default     = "https://releases.ubuntu.com/24.04/ubuntu-24.04.3-live-server-amd64.iso"
}

variable "iso_checksum" {
  type        = string
  description = "REQUIRED. sha256:<hex> taken from the Ubuntu SHA256SUMS file. The build must fail if it does not match."
  // Intentionally has no default: an unverified base image is a supply-chain hole.
}

variable "version"     { type = string  default = "0.1.0-alpha" }
variable "guest_ram"   { type = number  default = 8192 }
variable "guest_cpus"  { type = number  default = 4 }
variable "disk_mb"     { type = number  default = 61440 }
variable "build_user"  { type = string  default = "harmos" }
// Build-time only. harmos-firstboot.service forces a password change on first login
// and regenerates host SSH keys, so this value never survives into the shipped appliance
// as a usable credential. Never put a real/personal password here.
variable "build_password" { type = string  default = "harmos-build-only" sensitive = true }

locals {
  vm_name     = "HarmOS-${var.version}-x86_64"
  output_dir  = "${path.root}/../../dist/ova"
}

source "virtualbox-iso" "harmos" {
  vm_name              = local.vm_name
  guest_os_type        = "Ubuntu_64"
  iso_url              = var.iso_url
  iso_checksum         = var.iso_checksum
  memory               = var.guest_ram
  cpus                 = var.guest_cpus
  disk_size            = var.disk_mb
  hard_drive_interface = "sata"
  gfx_controller       = "vmsvga"
  gfx_vram_size        = 128
  gfx_accelerate_3d    = false
  firmware             = "efi"
  headless             = true

  // NAT only. The appliance must never ship bridged/host-only by default.
  vboxmanage = [
    ["modifyvm", "{{.Name}}", "--nic1", "nat"],
    ["modifyvm", "{{.Name}}", "--audio-driver", "none"],
    ["modifyvm", "{{.Name}}", "--clipboard-mode", "bidirectional"],
    ["modifyvm", "{{.Name}}", "--draganddrop", "disabled"],
    ["modifyvm", "{{.Name}}", "--vrde", "off"],
    ["modifyvm", "{{.Name}}", "--description", "HarmOS ${var.version} — AI-native operating environment (AetherFrame + HarmOS Nexus)"],
  ]

  // Ubuntu 24.04 subiquity autoinstall served over Packer's HTTP server.
  http_directory = "${path.root}/http"
  boot_wait      = "5s"
  boot_command = [
    "<wait3s>c<wait3s>",
    "linux /casper/vmlinuz --- autoinstall 'ds=nocloud-net;s=http://{{ .HTTPIP }}:{{ .HTTPPort }}/'<enter><wait3s>",
    "initrd /casper/initrd<enter><wait3s>",
    "boot<enter>"
  ]

  ssh_username           = var.build_user
  ssh_password           = var.build_password
  ssh_timeout            = "45m"
  ssh_handshake_attempts = 100
  shutdown_command       = "echo '${var.build_password}' | sudo -S shutdown -P now"
  post_shutdown_delay    = "1m"

  guest_additions_mode = "upload"
  guest_additions_path = "/tmp/VBoxGuestAdditions.iso"

  output_directory = local.output_dir
  format           = "ova"
  export_opts = [
    "--manifest",
    "--vsys", "0",
    "--product", "HarmOS Nexus — VirtualBox Edition",
    "--producturl", "https://github.com/androoAGI/starnet",
    "--version", var.version,
    "--description", "HarmOS ${var.version}: Linux + systemd + XFCE + HarmOS Nexus (StarNet-derived harness) + AetherFrame."
  ]
}

build {
  name    = "harmos"
  sources = ["source.virtualbox-iso.harmos"]

  // 1. Base OS, desktop, Guest Additions, Node, Ollama.
  provisioner "shell" {
    execute_command   = "echo '${var.build_password}' | sudo -S env {{ .Vars }} bash '{{ .Path }}'"
    expect_disconnect = true
    scripts           = ["${path.root}/scripts/01-base.sh", "${path.root}/scripts/02-desktop.sh"]
  }

  // 2. HarmOS runtime payload: the repo tree minus build junk.
  provisioner "file" {
    source      = "${path.root}/../../payload/"
    destination = "/tmp/harmos-payload/"
  }

  provisioner "shell" {
    execute_command = "echo '${var.build_password}' | sudo -S env {{ .Vars }} bash '{{ .Path }}'"
    environment_vars = ["HARMOS_VERSION=${var.version}"]
    scripts = [
      "${path.root}/scripts/03-harmos.sh",   // users, /opt/harmos, systemd units, autostart
      "${path.root}/scripts/04-verify.sh",   // in-guest readiness checks; non-zero = failed build
      "${path.root}/scripts/99-cleanup.sh",  // secrets, logs, machine-id, SSH host keys, apt cache
    ]
  }

  post-processor "checksum" {
    checksum_types = ["sha256"]
    output         = "${local.output_dir}/${local.vm_name}.{{.ChecksumType}}"
  }

  post-processor "manifest" {
    output     = "${local.output_dir}/release-manifest.json"
    strip_path = true
    custom_data = {
      edition        = "HarmOS Nexus — VirtualBox Edition"
      version        = var.version
      upstream_repo  = "https://github.com/androoAGI/starnet"
      upstream_branch = "feat/harness-backend"
      upstream_commit = "d540d503d9c8d5140685881880d46985b27e2f9c"
      upstream_license = "MIT (c) 2026 Andrew Sims — retained, see LICENSE and NOTICE.md"
      default_network = "NAT"
    }
  }
}
