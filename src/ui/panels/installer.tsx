import { useMemo, useState } from 'react';
import { Btn, Field, KV, Panel, Tag, cx, fmtBytes, inputCls } from '../kit';
import { INSTALLER_C_SOURCE, INSTALLER_EXE, INSTALLER_SH, OVA_MANIFEST } from '../../harmos/installerAssets';
import {
  buildInstallPlan,
  decodeBase64ToBytes,
  type ClipboardPolicy,
  type NetworkIsolationMode,
} from '../../harmos/installerPlanner';

export function InstallerPanel() {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const detectedCores = navigator.hardwareConcurrency || 4;
  const detectedRamMb = (nav.deviceMemory || 8) * 1024;

  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [vmName, setVmName] = useState('HarmOS-0.1.0');
  const [ovaPath, setOvaPath] = useState(OVA_MANIFEST.filename);
  const [cpus, setCpus] = useState(4);
  const [ramMb, setRamMb] = useState(8192);
  const [network, setNetwork] = useState<NetworkIsolationMode>('nat');
  const [clipboard, setClipboard] = useState<ClipboardPolicy>('bidirectional');
  const [sharedFolder, setSharedFolder] = useState('');
  const [startAfter, setStartAfter] = useState(true);
  const [sourcePreview, setSourcePreview] = useState<'none' | 'sh' | 'c'>('none');

  const plan = useMemo(
    () =>
      buildInstallPlan({
        mode,
        hostCores: detectedCores,
        hostRamMb: detectedRamMb,
        ovaPath,
        expectedSha256: OVA_MANIFEST.sha256 || undefined,
        vmName,
        customCpus: cpus,
        customRamMb: ramMb,
        network,
        clipboard,
        sharedFolder,
        startAfterImport: startAfter,
      }),
    [mode, detectedCores, detectedRamMb, ovaPath, vmName, cpus, ramMb, network, clipboard, sharedFolder, startAfter],
  );

  const downloadExe = () => {
    const bytes = decodeBase64ToBytes(INSTALLER_EXE.base64);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/vnd.microsoft.portable-executable' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = INSTALLER_EXE.filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const downloadText = (filename: string, content: string) => {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  return (
    <div className="space-y-4">
      {/* OVA Appliance Banner */}
      <Panel
        title="HarmOS-0.1.0-x86_64.ova — VirtualBox Appliance Status"
        subtitle="Built from verified Canonical Ubuntu 24.04 LTS + HarmOS Nexus sidecar + AetherFrame + KaliOS hardening."
        right={
          <Tag tone={OVA_MANIFEST.built ? 'ok' : 'warn'}>
            {OVA_MANIFEST.built ? 'OVA BUILT & VERIFIED' : 'OVA STAGING'}
          </Tag>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <KV k="Appliance archive" v={<span className="font-mono text-[11.5px] text-cyan-300">{OVA_MANIFEST.filename}</span>} />
            <KV k="Artifact path" v={<span className="font-mono text-[11px]">{OVA_MANIFEST.path}</span>} />
            <KV k="Compressed OVA size" v={OVA_MANIFEST.sizeBytes ? fmtBytes(OVA_MANIFEST.sizeBytes) : 'pending'} />
            <KV k="StreamOptimized VMDK" v={OVA_MANIFEST.vmdkSizeBytes ? `${OVA_MANIFEST.vmdkName} (${fmtBytes(OVA_MANIFEST.vmdkSizeBytes)})` : OVA_MANIFEST.vmdkName} />
            <KV k="Virtual disk capacity" v={`${OVA_MANIFEST.virtualDiskGb} GB (sparse)`} />
          </div>
          <div>
            <KV k="Guest OS" v={OVA_MANIFEST.guestOs} />
            <KV k="Linux kernel" v={<span className="font-mono text-[11px]">{OVA_MANIFEST.kernelVersion || 'Ubuntu 24.04 virtual x86_64'}</span>} />
            <KV k="QEMU x86_64 boot smoke" v={OVA_MANIFEST.qemuBootVerified ? <Tag tone="ok">PASSED</Tag> : <Tag tone="warn">PENDING</Tag>} />
            <KV k="Built timestamp" v={OVA_MANIFEST.builtAt || 'pending'} />
            <KV
              k="OVA SHA-256"
              v={<span className="font-mono text-[10px] text-emerald-300">{OVA_MANIFEST.sha256 ? `${OVA_MANIFEST.sha256.slice(0, 24)}…` : 'pending'}</span>}
            />
          </div>
        </div>
        {OVA_MANIFEST.sha256 && (
          <div className="mt-2.5 rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-[10.5px] text-slate-300">
            sha256: {OVA_MANIFEST.sha256}
          </div>
        )}
      </Panel>

      {/* Native EXE & Bash Installer Downloads */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Windows Native Installer (.EXE)"
          subtitle={INSTALLER_EXE.format}
          right={<Btn tone="primary" onClick={downloadExe}>⬇ Download {INSTALLER_EXE.filename}</Btn>}
        >
          <KV k="Binary size" v={fmtBytes(INSTALLER_EXE.sizeBytes)} />
          <KV k="Compiler" v="x86_64-w64-mingw32-gcc 12 (-O2 -Wall -Werror -s)" />
          <KV k="Modes supported" v="Interactive menu · --auto · --manual · --verify · --dry-run" />
          <KV k="Integrity engine" v="Built-in streaming FIPS 180-4 SHA-256 (zero external DLLs)" />
          <KV k="SHA-256" v={<span className="font-mono text-[10px] text-cyan-300">{INSTALLER_EXE.sha256.slice(0, 28)}…</span>} />
          <div className="mt-2.5 flex gap-2">
            <Btn onClick={() => setSourcePreview(sourcePreview === 'c' ? 'none' : 'c')}>
              {sourcePreview === 'c' ? 'Hide C Source' : 'Inspect harmos_installer.c'}
            </Btn>
            <Btn onClick={() => downloadText('harmos_installer.c', INSTALLER_C_SOURCE)}>Download .c Source</Btn>
          </div>
        </Panel>

        <Panel
          title="Linux / macOS / WSL2 Bash Installer (.SH)"
          subtitle="POSIX/Bash installer with identical auto_install() & manual_install() functions."
          right={<Btn tone="primary" onClick={() => downloadText(INSTALLER_SH.filename, INSTALLER_SH.source)}>⬇ Download {INSTALLER_SH.filename}</Btn>}
        >
          <KV k="Script size" v={fmtBytes(INSTALLER_SH.sizeBytes)} />
          <KV k="Platforms" v="Linux · macOS · Windows Git-Bash / WSL2" />
          <KV k="Modes supported" v="Interactive menu · --auto · --manual · --verify · --uninstall" />
          <KV k="Default security" v="NAT-only · VRDE off · Drag-and-drop off · No host shares" />
          <KV k="SHA-256" v={<span className="font-mono text-[10px] text-cyan-300">{INSTALLER_SH.sha256.slice(0, 28)}…</span>} />
          <div className="mt-2.5 flex gap-2">
            <Btn onClick={() => setSourcePreview(sourcePreview === 'sh' ? 'none' : 'sh')}>
              {sourcePreview === 'sh' ? 'Hide Bash Script' : 'Inspect install-harmos.sh'}
            </Btn>
          </div>
        </Panel>
      </div>

      {sourcePreview !== 'none' && (
        <Panel title={sourcePreview === 'c' ? 'packaging/installer/harmos_installer.c' : 'packaging/installer/install-harmos.sh'}>
          <pre className="max-h-72 overflow-auto rounded-lg border border-white/10 bg-black/50 p-3 font-mono text-[10.5px] leading-relaxed text-slate-300">
            {sourcePreview === 'c' ? INSTALLER_C_SOURCE : INSTALLER_SH.source}
          </pre>
        </Panel>
      )}

      {/* Interactive Auto / Manual Install Function Configurator */}
      <Panel
        title="Auto / Manual Installation Function"
        subtitle="Configure Automatic host-tuned deployment or customize every VirtualBox boundary manually."
        right={
          <div className="flex rounded-lg border border-white/10 bg-black/40 p-0.5 text-[11.5px]">
            <button
              onClick={() => setMode('auto')}
              className={cx('rounded-md px-3 py-1 font-medium transition', mode === 'auto' ? 'bg-cyan-400/20 text-cyan-200' : 'text-slate-400 hover:text-slate-200')}
            >
              Auto Install
            </button>
            <button
              onClick={() => setMode('manual')}
              className={cx('rounded-md px-3 py-1 font-medium transition', mode === 'manual' ? 'bg-violet-400/20 text-violet-200' : 'text-slate-400 hover:text-slate-200')}
            >
              Manual Install
            </button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="VirtualBox VM Name">
            <input className={inputCls} value={vmName} onChange={(e) => setVmName(e.target.value)} />
          </Field>
          <Field label="Path to HarmOS OVA">
            <input className={inputCls} value={ovaPath} onChange={(e) => setOvaPath(e.target.value)} />
          </Field>
          <div className="flex items-end pb-1.5">
            <label className="flex items-center gap-2 text-[12px] text-slate-200">
              <input type="checkbox" checked={startAfter} onChange={(e) => setStartAfter(e.target.checked)} className="accent-cyan-400" />
              Boot VM immediately after import
            </label>
          </div>
        </div>

        {mode === 'manual' ? (
          <div className="mt-3 grid gap-3 border-t border-white/10 pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={`Guest vCPUs (host reports ${detectedCores})`}>
              <input type="number" min={1} max={16} className={inputCls} value={cpus} onChange={(e) => setCpus(Number(e.target.value) || 2)} />
            </Field>
            <Field label="Guest RAM (MB)">
              <input type="number" step={1024} min={2048} className={inputCls} value={ramMb} onChange={(e) => setRamMb(Number(e.target.value) || 4096)} />
            </Field>
            <Field label="Network Isolation">
              <select className={inputCls} value={network} onChange={(e) => setNetwork(e.target.value as NetworkIsolationMode)}>
                <option value="nat">nat (Recommended default)</option>
                <option value="hostonly">hostonly (Local host-guest only)</option>
                <option value="none">none (Air-gapped)</option>
              </select>
            </Field>
            <Field label="Clipboard Policy">
              <select className={inputCls} value={clipboard} onChange={(e) => setClipboard(e.target.value as ClipboardPolicy)}>
                <option value="bidirectional">bidirectional</option>
                <option value="hosttoguest">hosttoguest</option>
                <option value="disabled">disabled (Strictest)</option>
              </select>
            </Field>
            <div className="sm:col-span-2 lg:col-span-4">
              <Field label="Opt-in Read-Only Host Shared Folder (leave empty for strict host isolation)">
                <input className={inputCls} value={sharedFolder} onChange={(e) => setSharedFolder(e.target.value)} placeholder="e.g. C:\Users\You\HarmOS-Inbox (mounted read-only)" />
              </Field>
            </div>
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-cyan-400/20 bg-cyan-950/15 px-3 py-2 text-[11.5px] text-cyan-200/90">
            <strong>Auto Mode Active:</strong> Automatically allocates <strong>{plan.cpus} vCPUs</strong> and <strong>{plan.ramMb} MB RAM</strong> based on detected host capacity, enforces <strong>NAT-only</strong> networking, disables VRDE remote desktop &amp; drag-and-drop, and verifies the OVA SHA-256 checksum prior to import.
          </p>
        )}

        {plan.warnings.length > 0 && (
          <div className="mt-3 space-y-1 rounded-lg border border-amber-400/30 bg-amber-950/20 p-2.5 text-[11px] text-amber-200">
            {plan.warnings.map((w, i) => <p key={i}>⚠ {w}</p>)}
          </div>
        )}

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div>
            <p className="mb-1 text-[10.5px] uppercase tracking-wider text-slate-400">Windows 10 Native .EXE Invocation</p>
            <pre className="overflow-auto rounded-lg border border-white/10 bg-black/50 p-2.5 font-mono text-[11px] text-cyan-300">{plan.exeCommand}</pre>
          </div>
          <div>
            <p className="mb-1 text-[10.5px] uppercase tracking-wider text-slate-400">Linux / macOS / WSL2 Bash Invocation</p>
            <pre className="overflow-auto rounded-lg border border-white/10 bg-black/50 p-2.5 font-mono text-[11px] text-emerald-300">{plan.bashCommand}</pre>
          </div>
        </div>

        <div className="mt-3">
          <p className="mb-1 text-[10.5px] uppercase tracking-wider text-slate-400">Exact VBoxManage Pipeline Executed Under the Hood</p>
          <pre className="overflow-auto rounded-lg border border-white/10 bg-black/50 p-2.5 font-mono text-[10.5px] leading-relaxed text-slate-300">
            {plan.vboxCommands.join('\n')}
          </pre>
        </div>
      </Panel>
    </div>
  );
}
