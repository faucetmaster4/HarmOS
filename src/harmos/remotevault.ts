/* HarmOS Remote Vault — client-side encryption for off-machine backup.
 *
 * Design: the vault is sealed with AES-256-GCM under a key derived from your passphrase
 * (PBKDF2-SHA256, 310k iterations, random 16-byte salt per archive). The archive is a
 * single portable JSON envelope. Anything that leaves the machine leaves encrypted, and
 * the passphrase is never stored, sent, or derivable from the envelope.
 *
 * This module does not upload. It produces the envelope and verifies it round-trips.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

const ENVELOPE_VERSION = 'harmos-vault-1';
const PBKDF2_ITERATIONS = 310_000;

export interface VaultRecord {
  path: string;
  content: string;
  provenance: string;
  updatedAt: number;
}

export interface VaultEnvelope {
  version: typeof ENVELOPE_VERSION;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string };
  createdAt: number;
  device: string;
  itemCount: number;
  payload: string;   // base64 ciphertext
  integrity: string; // sha-256 of the ciphertext, so corruption is detectable pre-decrypt
}

function b64(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function subtleAvailable(): boolean {
  return !!globalThis.crypto?.subtle?.deriveKey;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const b = data instanceof Uint8Array ? data : new Uint8Array(data);
  const d = await crypto.subtle.digest('SHA-256', b as unknown as BufferSource);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export interface SealResult { envelope: VaultEnvelope; bytes: number; }

export async function sealVault(records: VaultRecord[], passphrase: string, device = 'this-device'): Promise<SealResult> {
  if (!subtleAvailable()) throw new Error('WebCrypto unavailable. Vault sealing needs a secure context (https or localhost).');
  if (passphrase.length < 10) throw new Error('Passphrase must be at least 10 characters. This key protects everything you are about to store off-machine.');
  if (!records.length) throw new Error('Nothing to seal — the selection is empty.');

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const plaintext = enc.encode(JSON.stringify({ sealedAt: Date.now(), records }));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as unknown as BufferSource }, key, plaintext);

  const envelope: VaultEnvelope = {
    version: ENVELOPE_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: b64(salt) },
    cipher: { name: 'AES-GCM', iv: b64(iv) },
    createdAt: Date.now(),
    device,
    itemCount: records.length,
    payload: b64(ct),
    integrity: await sha256Hex(ct),
  };
  return { envelope, bytes: JSON.stringify(envelope).length };
}

export interface UnsealResult { records: VaultRecord[]; verified: boolean; createdAt: number; device: string; }

export async function unsealVault(envelope: VaultEnvelope, passphrase: string): Promise<UnsealResult> {
  if (!subtleAvailable()) throw new Error('WebCrypto unavailable in this context.');
  if (envelope.version !== ENVELOPE_VERSION) throw new Error(`Unknown envelope version "${envelope.version}". Refusing to guess.`);
  if (envelope.kdf.iterations < 100_000) throw new Error('Envelope declares a weak KDF iteration count. Refusing.');

  const ct = unb64(envelope.payload);
  const actual = await sha256Hex(ct);
  if (actual !== envelope.integrity) {
    throw new Error('Integrity check failed before decryption — this archive is corrupt or was altered. Nothing was decrypted.');
  }

  const key = await deriveKey(passphrase, unb64(envelope.kdf.salt));
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(envelope.cipher.iv) as unknown as BufferSource }, key, ct as unknown as BufferSource);
  } catch {
    throw new Error('Wrong passphrase (or tampered archive). AES-GCM authenticated decryption failed.');
  }
  const parsed = JSON.parse(dec.decode(plain)) as { sealedAt: number; records: VaultRecord[] };
  return { records: parsed.records, verified: true, createdAt: envelope.createdAt, device: envelope.device };
}

/* --------------------------- passphrase strength --------------------------- */

export interface Strength { score: 0 | 1 | 2 | 3 | 4; label: string; notes: string[]; entropyBits: number; }

export function passphraseStrength(p: string): Strength {
  const notes: string[] = [];
  if (!p) return { score: 0, label: 'empty', notes: ['Enter a passphrase.'], entropyBits: 0 };
  let pool = 0;
  if (/[a-z]/.test(p)) pool += 26;
  if (/[A-Z]/.test(p)) pool += 26;
  if (/[0-9]/.test(p)) pool += 10;
  if (/[^A-Za-z0-9]/.test(p)) pool += 33;
  const entropyBits = Math.round(p.length * Math.log2(Math.max(2, pool)));

  const words = p.split(/[^A-Za-z]+/).filter((w) => w.length > 2);
  const looksLikePhrase = words.length >= 4;
  if (looksLikePhrase) notes.push(`${words.length}-word phrase: good shape for memorability.`);
  if (p.length < 12 && !looksLikePhrase) notes.push('Under 12 characters and not a multi-word phrase — too short.');
  if (/^[0-9]+$/.test(p)) notes.push('Digits only: trivially brute-forced.');
  if (/(.)\1{2,}/.test(p)) notes.push('Contains a repeated character run.');
  if (/pass|word|harm|1234|qwerty|admin|letmein/i.test(p)) notes.push('Contains a very common word.');
  if (entropyBits >= 80) notes.push('Estimated entropy is strong for an offline attack.');

  const score: Strength['score'] = entropyBits >= 100 ? 4 : entropyBits >= 75 ? 3 : entropyBits >= 50 ? 2 : 1;
  const label = ['very weak', 'weak', 'fair', 'strong', 'very strong'][score];
  return { score, label, notes, entropyBits };
}

/* ------------------------------ backup planner ----------------------------- */

export interface BackupPlan {
  include: string[];
  exclude: string[];
  totalBytes: number;
  fileCount: number;
  warnings: string[];
}

export function planBackup(files: VaultRecord[], opts: { includeSealed: boolean; includeWorkspace: boolean; includeOutbox: boolean; maxBytes: number }): BackupPlan {
  const include: string[] = [];
  const exclude: string[] = [];
  const warnings: string[] = [];
  let totalBytes = 0;

  for (const f of files) {
    const isSealed = f.path.includes('/vault/');
    const isOutbox = f.path.includes('/outbox/');
    const isWorkspace = !isSealed && !isOutbox;
    const wanted = (isSealed && opts.includeSealed) || (isWorkspace && opts.includeWorkspace) || (isOutbox && opts.includeOutbox);
    if (!wanted) { exclude.push(f.path); continue; }
    if (totalBytes + f.content.length > opts.maxBytes) {
      exclude.push(f.path);
      warnings.push(`${f.path} skipped: archive would exceed the ${(opts.maxBytes / 1048576).toFixed(0)} MB single-archive cap. Split the backup.`);
      continue;
    }
    totalBytes += f.content.length;
    include.push(f.path);
  }

  if (opts.includeSealed) warnings.push('Sealed notes are double-encrypted: your vault passphrase plus this backup passphrase. Losing both means losing the notes.');
  if (!opts.includeOutbox) warnings.push('Generated reports and ledgers are excluded from this archive.');
  if (!include.length) warnings.push('Nothing matched the selection.');

  return { include, exclude, totalBytes, fileCount: include.length, warnings };
}

export function downloadEnvelope(envelope: VaultEnvelope): void {
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `harmos-vault-${new Date(envelope.createdAt).toISOString().slice(0, 10)}.harmvault.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
