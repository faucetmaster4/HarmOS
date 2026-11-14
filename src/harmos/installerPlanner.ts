/* HarmOS Auto / Manual Install Planner
 *
 * Mirrors the exact logic of packaging/installer/install-harmos.sh and
 * packaging/installer/harmos_installer.c (HarmOS-Installer.exe) so users can
 * configure Auto or Manual VirtualBox deployment, validate boundaries, and
 * generate ready-to-run Windows EXE / PowerShell / POSIX Bash invocations.
 */

export type NetworkIsolationMode = 'nat' | 'hostonly' | 'none';
export type ClipboardPolicy = 'disabled' | 'hosttoguest' | 'bidirectional';

export interface InstallPlanInput {
  mode: 'auto' | 'manual';
  hostCores: number;
  hostRamMb: number;
  ovaPath: string;
  expectedSha256?: string;
  vmName: string;
  customCpus?: number;
  customRamMb?: number;
  network?: NetworkIsolationMode;
  clipboard?: ClipboardPolicy;
  sharedFolder?: string;
  startAfterImport?: boolean;
}

export interface InstallPlanOutput {
  mode: 'auto' | 'manual';
  vmName: string;
  ovaPath: string;
  cpus: number;
  ramMb: number;
  network: NetworkIsolationMode;
  clipboard: ClipboardPolicy;
  sharedFolder: string;
  startAfterImport: boolean;
  warnings: string[];
  vboxCommands: string[];
  exeCommand: string;
  bashCommand: string;
}

export function computeRecommendedSpecs(hostCores: number, hostRamMb: number): { cpus: number; ramMb: number } {
  const cpus = Math.min(4, Math.max(2, Math.floor(Math.max(2, hostCores) / 2)));
  const ramMb = Math.min(8192, Math.max(4096, Math.floor(Math.max(4096, hostRamMb) / 2)));
  return { cpus, ramMb };
}

export function buildInstallPlan(input: InstallPlanInput): InstallPlanOutput {
  const rec = computeRecommendedSpecs(input.hostCores, input.hostRamMb);
  const isAuto = input.mode === 'auto';

  const cpus = isAuto ? rec.cpus : Math.max(1, Math.floor(input.customCpus || rec.cpus));
  const ramMb = isAuto ? rec.ramMb : Math.max(2048, Math.floor(input.customRamMb || rec.ramMb));
  const network: NetworkIsolationMode = isAuto ? 'nat' : (input.network || 'nat');
  const clipboard: ClipboardPolicy = isAuto ? 'bidirectional' : (input.clipboard || 'bidirectional');
  const sharedFolder = isAuto ? '' : (input.sharedFolder || '').trim();
  const vmName = (input.vmName || 'HarmOS-0.1.0').trim();
  const ovaPath = (input.ovaPath || 'HarmOS-0.1.0-x86_64.ova').trim();
  const startAfterImport = !!input.startAfterImport;

  const warnings: string[] = [];
  if (cpus < 2) warnings.push('Below minimum target (2 vCPUs): desktop responsiveness will degrade.');
  if (ramMb < 4096) warnings.push('Below minimum target (4096 MB RAM): enable low-resource mode and avoid local 3B+ LLMs.');
  if (ramMb > input.hostRamMb - 2048 && input.hostRamMb >= 6144) {
    warnings.push(`Guest RAM (${ramMb} MB) leaves less than 2 GB for the host OS (${input.hostRamMb} MB).`);
  }
  if (sharedFolder) {
    warnings.push('Opt-in host shared folder enabled (mounted read-only as "host-share"). Host remains outside default AI write reach.');
  }

  const vboxCommands: string[] = [
    `VBoxManage import "${ovaPath}" --vsys 0 --vmname "${vmName}" --cpus ${cpus} --memory ${ramMb}`,
    `VBoxManage modifyvm "${vmName}" --nic1 ${network} --vrde off --draganddrop disabled --clipboard-mode ${clipboard} --graphicscontroller vmsvga --vram 128 --audio-driver none --rtcuseutc on`,
  ];
  if (sharedFolder) {
    vboxCommands.push(`VBoxManage sharedfolder add "${vmName}" --name "host-share" --hostpath "${sharedFolder}" --readonly --automount`);
  }
  if (startAfterImport) {
    vboxCommands.push(`VBoxManage startvm "${vmName}" --type gui`);
  }

  const shaFlag = input.expectedSha256 ? ` --sha256 ${input.expectedSha256}` : '';
  const startFlag = startAfterImport ? ' --start' : '';

  const exeCommand = isAuto
    ? `.\\HarmOS-Installer.exe --auto --ova "${ovaPath}" --name "${vmName}"${shaFlag}${startFlag}`
    : `.\\HarmOS-Installer.exe --manual --ova "${ovaPath}" --name "${vmName}" --cpus ${cpus} --ram ${ramMb}${shaFlag}${startFlag}`;

  const bashCommand = isAuto
    ? `bash ./install-harmos.sh --auto --ova "${ovaPath}" --name "${vmName}"${shaFlag}${startFlag}`
    : `bash ./install-harmos.sh --manual --ova "${ovaPath}" --name "${vmName}" --cpus ${cpus} --ram ${ramMb}${shaFlag}${startFlag}`;

  return {
    mode: input.mode,
    vmName,
    ovaPath,
    cpus,
    ramMb,
    network,
    clipboard,
    sharedFolder,
    startAfterImport,
    warnings,
    vboxCommands,
    exeCommand,
    bashCommand,
  };
}

export function decodeBase64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
