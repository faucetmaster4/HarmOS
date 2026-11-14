/* Beginner ("dummy") install walkthroughs.
 * Example names and paths are samples. Commands match the real HarmOS installers.
 * "KaliOS" in HarmOS is the defensive subsystem. The Kali Linux track is for people
 * whose host OS is Kali Linux — it does not enable offensive tooling.
 */

export type HostOs = 'windows' | 'macos' | 'ubuntu' | 'kali';

export interface GuideStep {
  title: string;
  see: string;
  do: string;
  command?: string;
  dummy: string;
  check: string;
}

export interface InstallGuide {
  id: HostOs;
  title: string;
  subtitle: string;
  minutes: string;
  steps: GuideStep[];
}

export function installGuides(sha256 = '<sha256 from HarmOS-0.1.0-x86_64.ova.sha256>'): InstallGuide[] {
  const winOva = 'C:\\Users\\Alex\\Downloads\\HarmOS-0.1.0-x86_64.ova';
  const unixOva = '$HOME/Downloads/HarmOS-0.1.0-x86_64.ova';
  return [
    {
      id: 'windows',
      title: 'Windows 10 or 11',
      subtitle: 'VirtualBox + HarmOS-Installer.exe',
      minutes: '25–40 min',
      steps: [
        { title: 'Install VirtualBox', see: 'A normal Windows installer wizard. Reboot if it asks.', do: 'Install Oracle VirtualBox 7.x. Leave the network options at their defaults.', command: 'winget install Oracle.VirtualBox', dummy: 'Example PC name does not matter. Example user folder: C:\\Users\\Alex', check: 'VBoxManage.exe exists under C:\\Program Files\\Oracle\\VirtualBox\\' },
        { title: 'Put the appliance where you can find it', see: 'A file about 1 GB named HarmOS-0.1.0-x86_64.ova plus a .sha256 sidecar.', do: 'Download both into Downloads. Do not rename the .ova.', dummy: `Example path: ${winOva}`, check: 'Both files sit in the same folder.' },
        { title: 'Check the file was not corrupted', see: 'A line that says the SHA-256 matched, or a red mismatch and a stop.', do: 'Run the installer in verify-only mode. If it mismatches, delete the file and download again. Do not import it.', command: `HarmOS-Installer.exe --verify --ova "${winOva}" --sha256 ${sha256}`, dummy: 'Dummy expected digest is the real release hash, not a made-up one. A mismatch means stop.', check: 'The window prints SHA-256 verified and the same 64 hex characters as the .sha256 file.' },
        { title: 'Auto-install (recommended)', see: 'VirtualBox gains a VM named HarmOS-0.1.0. Networking stays NAT. Remote desktop stays off.', do: 'Double-click HarmOS-Installer.exe and choose 1, or run the auto command. Auto mode picks 2–4 vCPUs and 4–8 GB RAM from your PC and refuses bridged networking.', command: `HarmOS-Installer.exe --auto --ova "${winOva}" --start`, dummy: 'Example: Alex\'s laptop has 16 GB RAM, so auto mode asks VirtualBox for 4 vCPUs and 8192 MB. That is a sample, not a requirement.', check: 'VirtualBox Manager lists HarmOS-0.1.0 and the VM window opens.' },
        { title: 'Or walk through Manual mode', see: 'The installer asks eight questions, then shows a summary before it imports.', do: 'Choose 2 in the menu. Press Enter to accept a default. Type a number only when you want to override it.', command: 'HarmOS-Installer.exe --manual', dummy: 'Example answers: VM name HarmOS-Lab, 2 vCPUs, 4096 MB RAM, network nat, clipboard bidirectional, shared folder left blank, boot yes.', check: 'The summary says net=nat and you typed y only after reading it.' },
        { title: 'First login inside the VM', see: 'A Linux login prompt, then a demand to change the password.', do: 'User harmos. Use the build password once, then set your own. It will not accept an empty password.', dummy: 'Example new password you type twice: a passphrase you can remember. Do not reuse your Windows password. Do not post it.', check: 'You land on an XFCE desktop. AetherFrame opens after the backend answers on 127.0.0.1:8787.' },
        { title: 'If the desktop says the backend did not start', see: 'A dialog with systemctl status, not a fake "all good" screen.', do: 'Open the terminal in the VM and read the unit, then restart it.', command: 'sudo systemctl status harmos-nexus --no-pager\nsudo systemctl restart harmos-nexus', dummy: 'Example failure: "address already in use" means something else took port 8787. Restarting the unit is the first try, not reinstalling Windows.', check: 'curl -fsS http://127.0.0.1:8787/api/health prints ok.' },
        { title: 'Optional: local model, still your choice', see: 'AI Model Manager in AetherFrame. It will say unreachable until Ollama answers.', do: 'Nothing downloads until you run ollama pull yourself.', command: 'ollama pull qwen2.5:0.5b', dummy: 'Example: a 4 GB VM should stay on the 0.5B model. Do not pull a 70B model "to try".', check: 'Probe 127.0.0.1:11434 lists the model you pulled. If you skip this, HarmOS still boots.' },
      ],
    },
    {
      id: 'macos',
      title: 'macOS',
      subtitle: 'VirtualBox or the bash installer',
      minutes: '30–45 min',
      steps: [
        { title: 'Install VirtualBox for Mac', see: 'A standard macOS installer. You may need to allow a system extension in System Settings → Privacy & Security.', do: 'Install Oracle VirtualBox 7.x from virtualbox.org. Apple Silicon can run the x86_64 appliance only under emulation, and it will be slow. An Intel Mac is the comfortable host.', dummy: 'Example Mac: Intel MacBook Pro, user short name alex, file in /Users/alex/Downloads.', check: 'VBoxManage -v prints a 7.x version in Terminal.' },
        { title: 'Allow the kernel extension if macOS blocked it', see: 'A System Settings banner: system software from Oracle was blocked.', do: 'Open Privacy & Security, allow Oracle, reboot. This is a macOS prompt, not a HarmOS password.', dummy: 'Example: you click Allow, reboot, and only then retry the import. Skipping the reboot leaves VBoxManage unable to start VMs.', check: 'After reboot, VirtualBox opens without the extension warning.' },
        { title: 'Verify the appliance', see: 'Terminal prints OK or a mismatch.', do: 'Use the bash installer that shipped next to the OVA. chmod +x once.', command: `chmod +x install-harmos.sh\n./install-harmos.sh --verify --ova ${unixOva} --sha256 ${sha256}`, dummy: `Example path: /Users/alex/Downloads/HarmOS-0.1.0-x86_64.ova`, check: 'SHA-256 verified, same digest as the .sha256 file.' },
        { title: 'Auto-import', see: 'VirtualBox creates HarmOS-0.1.0 with NAT only.', do: 'Run auto mode. Add --start if you want the VM window immediately.', command: `./install-harmos.sh --auto --ova ${unixOva} --start`, dummy: 'Example: alex accepts the detected 4 vCPU / 8192 MB profile. Shared folders stay off.', check: 'VirtualBox lists the VM. Adapter 1 says NAT.' },
        { title: 'Manual mode if you want smaller hardware', see: 'Eight prompts. Defaults are in brackets.', do: 'Run manual mode and type the smaller numbers. Leave the shared-folder question empty.', command: './install-harmos.sh --manual --ram 4096 --cpus 2', dummy: 'Example answers: name HarmOS-Mac, network 1 (nat), clipboard 3, shared folder blank, boot y.', check: 'Summary shows 2 vCPUs, 4096 MB, nat, then you confirm.' },
        { title: 'First boot', see: 'Login user harmos, forced password change, then XFCE and AetherFrame.', do: 'Set a new password. Wait for the browser window. If it errors, the dialog quotes journalctl — read it.', dummy: 'Example password: a unique passphrase stored in your password manager, not in a screenshot.', check: 'AetherFrame title bar reads HarmOS. Control Center shows the kernel online.' },
        { title: 'Clipboard and folders', see: 'Copy from Mac to guest works only after Guest Additions. Folders do not appear unless you opted in.', do: 'Leave shared folders off unless you have a specific inbox. If you add one later, add it read-only.', dummy: 'Example inbox: /Users/alex/HarmOS-Inbox mounted read-only as host-share. The AI cannot write back to the Mac.', check: 'VirtualBox shared folders list is empty, or one read-only entry you added on purpose.' },
        { title: 'Shut down cleanly', see: 'The VM window closes after Linux powers off. A force-kill can dirty the disk.', do: 'Use the XFCE shutdown menu, or ACPI shutdown from VirtualBox.', command: 'VBoxManage controlvm HarmOS-0.1.0 acpipowerbutton', dummy: 'Example: you wait until the window closes by itself instead of clicking the X immediately.', check: 'VirtualBox shows the VM as Powered Off, not Aborted.' },
      ],
    },
    {
      id: 'ubuntu',
      title: 'Ubuntu Linux',
      subtitle: 'Host Ubuntu installing the HarmOS guest',
      minutes: '20–35 min',
      steps: [
        { title: 'Install VirtualBox on the Ubuntu host', see: 'apt finishes without a held package. Your user can run VBoxManage after a re-login if it was added to vboxusers.', do: 'Use the distro package or Oracle\'s package. You need hardware virtualization (kvm/VT-x) enabled in firmware.', command: 'sudo apt update && sudo apt install -y virtualbox virtualbox-ext-pack || sudo apt install -y virtualbox', dummy: 'Example host: Ubuntu 24.04 laptop, user alex, in group vboxusers.', check: 'VBoxManage --version prints a version. ls /dev/kvm shows the device if KVM is available (VirtualBox can still use its own driver).' },
        { title: 'Confirm you are not already out of disk', see: 'df shows several free gigabytes on the filesystem that holds ~/VirtualBox VMs.', do: 'The OVA expands when imported. Keep at least 20 GB free.', command: 'df -h "$HOME"', dummy: 'Example: /home has 40 GB free. If you only have 3 GB free, stop and free space first.', check: 'Avail is at least 20G.' },
        { title: 'Verify the download', see: 'sha256sum or the installer prints a match.', do: 'Do this before import. A partial download imports into a VM that will not boot, and the failure looks like a HarmOS bug.', command: `./install-harmos.sh --verify --ova ${unixOva} --sha256 ${sha256}`, dummy: `Example path: /home/alex/Downloads/HarmOS-0.1.0-x86_64.ova`, check: 'Printed digest equals the .sha256 file.' },
        { title: 'Auto-install', see: 'A new VM, NAT, no VRDE, no shared folder.', do: 'Run the bash auto function. It reads your RAM and CPU and clamps the guest to a safe profile.', command: `./install-harmos.sh --auto --ova ${unixOva} --start`, dummy: 'Example host with 8 GB RAM → guest 4096 MB and 2 vCPUs. That clamp is intentional.', check: 'VBoxManage showvminfo HarmOS-0.1.0 | grep nic1 shows nat.' },
        { title: 'Manual install', see: 'Prompts for name, CPU, RAM, network, clipboard, share, boot.', do: 'Choose nat unless you have a reason. hostonly and none are the other supported answers. Do not type bridged.', command: './install-harmos.sh --manual', dummy: 'Example: VM name HarmOS-Ubuntu, 2 CPUs, 4096 RAM, network nat, no share.', check: 'You confirmed the summary. Import did not print an error.' },
        { title: 'First login', see: 'harmos login, password change, XFCE, AetherFrame.', do: 'Same flow as the Windows guest. The host OS does not change the guest password rules.', dummy: 'Example: you set the guest password to a different secret than your Ubuntu login.', check: 'Inside the guest, systemctl is-active harmos-nexus prints active.' },
        { title: 'Host firewall does not need a hole', see: 'Nothing on the Ubuntu host should listen for HarmOS. The guest uses NAT.', do: 'Do not forward host port 8787. The AI core binds to the guest\'s loopback only.', dummy: 'Example mistake: alex adds a ufw allow 8787 on the host "so the browser can connect". Do not. Open the VM window instead.', check: 'On the host, ss -ltn | grep 8787 is empty.' },
        { title: 'Optional smoke test inside the guest', see: 'PASS / FAIL / SKIP lines. SKIP is not a pass you invented.', do: 'Run the script that shipped in the image.', command: 'bash /opt/harmos/tests/smoke-appliance.sh', dummy: 'Example good result: 18 passed, 0 failed, 2 skipped (no display in a serial session, no model yet).', check: 'The script exits 0. Failed lines, if any, name the exact command.' },
      ],
    },
    {
      id: 'kali',
      title: 'Kali Linux',
      subtitle: 'Kali as the host. HarmOS KaliOS is separate — it is the guest\'s defensive panel, not Kali\'s toolset.',
      minutes: '25–40 min',
      steps: [
        { title: 'Read this boundary first', see: 'This track installs HarmOS in VirtualBox. It does not configure scanners, exploits, or remote access.', do: 'Use a normal Kali user that can sudo. Do not run the installer as root if you can avoid it. Do not point HarmOS at a shared folder full of other people\'s data.', dummy: 'Example user: kali, home /home/kali. Example VM name: HarmOS-KaliHost.', check: 'You are installing an appliance, not enabling a listener on the Kali host.' },
        { title: 'Install VirtualBox on Kali', see: 'apt installs virtualbox. Secure Boot may refuse the module; that is a host firmware issue, not a HarmOS bug.', do: 'Install the package, then check the kernel module.', command: 'sudo apt update && sudo apt install -y virtualbox\nVBoxManage --version', dummy: 'Example: Kali rolling, kernel 6.x, user kali added to vboxusers, then a re-login.', check: 'VBoxManage --version works in a new terminal.' },
        { title: 'Keep Kali\'s network and HarmOS\'s network apart', see: 'HarmOS will use NAT inside VirtualBox. Kali\'s own interfaces stay yours.', do: 'Do not bridge the VM onto a network you do not administer. Do not enable VRDE. The installer refuses VRDE by default; do not turn it on "for convenience".', dummy: 'Example wrong move: bridging onto a café Wi-Fi so the VM is a peer on that LAN. Use NAT.', check: 'showvminfo nic1 is nat. VRDE is off.' },
        { title: 'Verify, then auto-install', see: 'Checksum match, then a VM named HarmOS-0.1.0 unless you passed --name.', do: 'Same bash installer as Ubuntu. Paths with spaces must stay quoted.', command: `./install-harmos.sh --verify --ova "$HOME/Downloads/HarmOS-0.1.0-x86_64.ova" --sha256 ${sha256}\n./install-harmos.sh --auto --ova "$HOME/Downloads/HarmOS-0.1.0-x86_64.ova" --name HarmOS-KaliHost --start`, dummy: 'Example path: /home/kali/Downloads/HarmOS-0.1.0-x86_64.ova. Example VM name: HarmOS-KaliHost.', check: 'Checksum matched. VirtualBox shows HarmOS-KaliHost powered on.' },
        { title: 'Manual mode', see: 'The same eight questions. Network choices are nat, hostonly, or none.', do: 'If you want the guest unable to reach the internet at all, choose none. You will not get package updates or model downloads inside the guest until you change it back.', command: './install-harmos.sh --manual --name HarmOS-KaliHost', dummy: 'Example air-gap answers: network 3 (none), shared folder blank, clipboard disabled.', check: 'Summary matches what you typed before you confirm.' },
        { title: 'First boot and KaliOS inside the guest', see: 'XFCE login, then AetherFrame. The IT Security app is the guest\'s defensive panel (HarmOS KaliOS), not Kali Linux.', do: 'Change the harmos password. Open IT Security and run the IDS sample and the FIM seal so you can see the difference between a scan and a guess.', dummy: 'Example: you open IT Security, paste the sample SSH log, and see the brute-force IP counted. That sample is fake log text, not your Kali host.', check: 'Guest curl to 127.0.0.1:8787/api/health returns ok. Kali host still has no new public listener from HarmOS.' },
        { title: 'Do not share the Kali home directory', see: 'A shared folder would expose host files to the guest. Default is none.', do: 'Leave it blank. If you later need an inbox, make a new empty directory and mount it read-only.', dummy: 'Example inbox: /home/kali/harmos-inbox, mode 0755, empty, read-only mount name host-share. Not /home/kali itself.', check: 'VBoxManage showvminfo HarmOS-KaliHost | grep -i shared is empty, or lists only that inbox.' },
        { title: 'If VirtualBox cannot see VT-x', see: 'VERR_VMX_NO_VMX or a similar error. Common when another hypervisor holds the CPU.', do: 'Close other VMs. On a dual-boot machine, check firmware virtualization. Do not "fix" it by disabling HarmOS security settings.', dummy: 'Example: Kali is itself a VM, and nested virtualization is off. Turn on nested virt in the outer hypervisor or install HarmOS on bare metal instead.', check: 'The HarmOS VM reaches the Linux login prompt.' },
      ],
    },
  ];
}
