import { useMemo, useState } from 'react';
import { Btn, Field, KV, Meter, Panel, Tag, cx, inputCls, useKernel } from '../kit';
import {
  downloadEnvelope, passphraseStrength, planBackup, sealVault, subtleAvailable, unsealVault,
  type VaultEnvelope, type VaultRecord,
} from '../../harmos/remotevault';

export function RemoteVaultPanel() {
  const k = useKernel();
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [device, setDevice] = useState('laptop');
  const [includeSealed, setIncludeSealed] = useState(true);
  const [includeWorkspace, setIncludeWorkspace] = useState(true);
  const [includeOutbox, setIncludeOutbox] = useState(false);
  const [maxMb, setMaxMb] = useState(50);
  const [envelope, setEnvelope] = useState<VaultEnvelope | null>(null);
  const [restored, setRestored] = useState<{ count: number; device: string; createdAt: number } | null>(null);
  const [msg, setMsg] = useState('');
  const [roundTrip, setRoundTrip] = useState<'idle' | 'running' | 'pass' | 'fail'>('idle');

  const records: VaultRecord[] = useMemo(() => Object.values(k.state.vfs)
    .filter((f) => f.kind === 'file')
    .map((f) => ({ path: f.path, content: f.content || '', provenance: f.provenance, updatedAt: f.updatedAt })), [k.state.vfs]);

  const backup = useMemo(() => planBackup(records, {
    includeSealed, includeWorkspace, includeOutbox, maxBytes: maxMb * 1048576,
  }), [records, includeSealed, includeWorkspace, includeOutbox, maxMb]);

  const strength = passphraseStrength(pass);

  const seal = async () => {
    setMsg(''); setRestored(null); setRoundTrip('idle');
    if (pass !== pass2) { setMsg('Passphrases do not match.'); return; }
    try {
      const selection = records.filter((r) => backup.include.includes(r.path));
      const out = await sealVault(selection, pass, device);
      setEnvelope(out.envelope);
      setMsg(`Sealed ${out.envelope.itemCount} record(s) into a ${(out.bytes / 1024).toFixed(1)} KB envelope. AES-256-GCM, PBKDF2-SHA256 at 310,000 iterations.`);
      k.log('info', 'remotevault', 'seal', `${out.envelope.itemCount} records · ${(out.bytes / 1024).toFixed(1)} KB`);
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };

  const verify = async () => {
    if (!envelope) return;
    setRoundTrip('running');
    try {
      const out = await unsealVault(envelope, pass);
      const original = records.filter((r) => backup.include.includes(r.path));
      const same = original.length === out.records.length && original.every((o) => {
        const m = out.records.find((x) => x.path === o.path);
        return m && m.content === o.content && m.provenance === o.provenance;
      });
      setRoundTrip(same ? 'pass' : 'fail');
      setRestored({ count: out.records.length, device: out.device, createdAt: out.createdAt });
      setMsg(same
        ? `Round-trip verified: ${out.records.length} record(s) decrypted byte-identical. Integrity hash matched before decryption.`
        : 'Round-trip mismatch — decrypted content differs from the source. Do not trust this archive.');
      k.log(same ? 'info' : 'critical', 'remotevault', 'roundtrip', same ? 'byte-identical' : 'MISMATCH');
    } catch (e) {
      setRoundTrip('fail');
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const wrongPass = async () => {
    if (!envelope) return;
    try {
      await unsealVault(envelope, `${pass}-wrong`);
      setMsg('WARNING: decryption succeeded with a wrong passphrase — that should be impossible with AES-GCM. Report this.');
      setRoundTrip('fail');
    } catch (e) {
      setMsg(`Correctly rejected: ${e instanceof Error ? e.message : String(e)}`);
      setRoundTrip('pass');
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-violet-400/20 bg-violet-400/5 px-3 py-2.5">
        <p className="text-[12.5px] font-semibold text-violet-100">Remote vault — encrypted off-machine backup</p>
        <p className="text-[11px] text-slate-400">
          Seals the vault into a single portable envelope. Encryption happens here, on this device, before anything could leave.
          The passphrase is never stored, sent, or recoverable. Losing it means losing the archive — there is no reset.
        </p>
      </div>

      {!subtleAvailable() && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2.5">
          <p className="text-[12px] font-semibold text-rose-100">WebCrypto unavailable</p>
          <p className="text-[11px] text-rose-100/80">This page is not in a secure context. Vault sealing requires https or localhost and is disabled rather than silently weakened.</p>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[340px_1fr]">
        <div className="space-y-3">
          <Panel title="Passphrase">
            <Field label="Backup passphrase" hint="Distinct from your login. Minimum 10 characters; a 4-word phrase is stronger.">
              <input type="password" className={inputCls} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Confirm"><input type="password" className={inputCls} value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" /></Field>
            <div className="mt-1 flex items-center gap-2">
              <Meter value={strength.score} max={4} label={`entropy ≈ ${strength.entropyBits} bits · ${strength.label}`} />
            </div>
            {strength.notes.map((n) => <p key={n} className="text-[10.5px] text-slate-500">• {n}</p>)}
            <Field label="Device label" hint="Written into the envelope in plaintext so you can tell archives apart."><input className={inputCls} value={device} onChange={(e) => setDevice(e.target.value)} /></Field>
          </Panel>

          <Panel title="Selection" subtitle={`${backup.fileCount} file(s) · ${(backup.totalBytes / 1024).toFixed(1)} KB`}>
            {([
              ['includeWorkspace', 'Workspace files', setIncludeWorkspace, includeWorkspace],
              ['includeSealed', 'Sealed notes', setIncludeSealed, includeSealed],
              ['includeOutbox', 'Generated reports & ledgers', setIncludeOutbox, includeOutbox],
            ] as const).map(([key, label, setter, val]) => (
              <label key={key} className="flex items-center gap-2 py-1 text-[12px] text-slate-200">
                <input type="checkbox" className="accent-cyan-400" checked={val} onChange={(e) => setter(e.target.checked)} />
                {label}
              </label>
            ))}
            <Field label={`Max archive size (${maxMb} MB)`}>
              <input type="range" min={5} max={200} value={maxMb} onChange={(e) => setMaxMb(+e.target.value)} className="w-full accent-cyan-400" />
            </Field>
            {backup.warnings.map((w) => <p key={w} className="text-[10.5px] text-amber-300">⚠ {w}</p>)}
          </Panel>
        </div>

        <div className="space-y-3">
          <Panel title="Seal & verify" subtitle="Sealing is local. Verification decrypts the archive and compares it byte-for-byte against the source."
            right={<div className="flex gap-2">
              <Btn tone="primary" onClick={seal} disabled={!subtleAvailable() || !backup.fileCount}>Seal</Btn>
              <Btn onClick={verify} disabled={!envelope || roundTrip === 'running'}>Verify round-trip</Btn>
              <Btn onClick={wrongPass} disabled={!envelope}>Test wrong passphrase</Btn>
              <Btn onClick={() => envelope && downloadEnvelope(envelope)} disabled={!envelope}>Download</Btn>
            </div>}>
            {!envelope && <p className="text-[12px] text-slate-500">Nothing sealed yet. Set a passphrase, choose what to include, then press Seal.</p>}
            {envelope && (
              <div className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <KV k="Version" v={envelope.version} />
                  <KV k="KDF" v={`${envelope.kdf.name}-${envelope.kdf.hash} · ${envelope.kdf.iterations.toLocaleString()} rounds`} />
                  <KV k="Cipher" v={envelope.cipher.name} />
                  <KV k="Items" v={envelope.itemCount} />
                  <KV k="Device" v={envelope.device} />
                  <KV k="Envelope size" v={`${(JSON.stringify(envelope).length / 1024).toFixed(1)} KB`} />
                </div>
                <KV k="Integrity (SHA-256 of ciphertext)" v={<span className="font-mono text-[10.5px] break-all">{envelope.integrity.slice(0, 40)}…</span>} />
                <div className="rounded-lg border border-white/10 bg-black/40 p-2">
                  <p className="text-[10.5px] uppercase tracking-wider text-slate-500">Ciphertext (first 96 chars — this is what a stolen file actually contains)</p>
                  <p className="mt-1 break-all font-mono text-[10px] text-violet-300">{envelope.payload.slice(0, 96)}…</p>
                </div>
                <Tag tone={roundTrip === 'pass' ? 'ok' : roundTrip === 'fail' ? 'bad' : 'mute'}>
                  {roundTrip === 'pass' ? 'round-trip verified byte-identical' : roundTrip === 'fail' ? 'verification failed' : roundTrip === 'running' ? 'verifying…' : 'not verified yet'}
                </Tag>
                {restored && <p className="text-[11px] text-slate-400">Decrypted {restored.count} record(s) from “{restored.device}”, sealed {new Date(restored.createdAt).toLocaleString()}.</p>}
              </div>
            )}
            {msg && <p className={cx('mt-2 rounded-lg border p-2 text-[11.5px]', roundTrip === 'fail' || /match|Refus|impossible/i.test(msg) ? 'border-rose-400/30 bg-rose-400/10 text-rose-100' : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100')}>{msg}</p>}
          </Panel>

          <Panel title="Restore" subtitle="Paste an envelope to read it back. Restore is read-only here — nothing overwrites the live vault until you confirm.">
            <Field label="Envelope JSON">
              <textarea className={cx(inputCls, 'h-20 font-mono')} placeholder="Paste a .harmvault.json file…" onChange={async (e) => {
                const raw = e.target.value.trim();
                if (!raw.startsWith('{')) return;
                try {
                  const parsed = JSON.parse(raw) as VaultEnvelope;
                  const p = window.prompt('Passphrase for this archive:');
                  if (!p) return;
                  const out = await unsealVault(parsed, p);
                  setRestored({ count: out.records.length, device: out.device, createdAt: out.createdAt });
                  setMsg(`Restored ${out.records.length} record(s) from “${out.device}”. Review them before writing anything to the live vault.`);
                  k.log('info', 'remotevault', 'restore.inspect', `${out.records.length} records from ${out.device}`);
                } catch (err) {
                  setMsg(err instanceof Error ? err.message : String(err));
                }
              }} />
            </Field>
            <p className="text-[10.5px] text-slate-500">A wrong passphrase produces an authentication failure, not partial garbage output. That is the property that makes tampering detectable.</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
