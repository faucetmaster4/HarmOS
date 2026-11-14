/* HarmOS IT Security & Anti-Hacking Engine (KaliOS Blue-Team Suite)
 *
 * Strictly defensive cybersecurity utilities:
 *   1. Multi-signature Intrusion & Payload Analyzer (SQLi, XSS, RCE/Reverse-Shell,
 *      Path Traversal, SSRF, Prompt Injection, Brute-Force, Privilege Escalation)
 *   2. Cryptographic SHA-256 File Integrity Monitoring (FIM) baseline & tamper detector
 *   3. Secret / Passphrase Shannon & keyspace entropy auditor + Vault leak scanner
 *   4. Linux Kernel, UFW Firewall, Fail2Ban & SSH Zero-Trust config generator
 *
 * Honesty boundary: signature scanning, SHA-256 FIM over the Sovereign Vault, and
 * config generation execute 100% live here. Host-level Linux daemons (ufw, fail2ban,
 * auditd, rkhunter) run inside the HarmOS Linux guest appliance, not in the browser.
 */

import { type Kernel, type Provenance, redact } from './kernel';

/* ---------------- 1. Pure-TS FIPS 180-4 SHA-256 (works in Browser + Node) ---------------- */

const K256 = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);

const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0;

export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const padLen = (((bytes.length + 8) >>> 6) + 1) << 6;
  const buf = new Uint8Array(padLen);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(padLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((v) => v.toString(16).padStart(8, '0')).join('');
}

/* ---------------- 2. Intrusion & Attack Payload Analyzer (IDS) ---------------- */

export type ThreatSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface ThreatAlert {
  id: string;
  ruleId: string;
  category: string;
  mitre: string;
  severity: ThreatSeverity;
  line: number;
  snippet: string;
  explanation: string;
  remediation: string;
}

interface IdsRule {
  id: string;
  category: string;
  mitre: string;
  severity: ThreatSeverity;
  pattern: RegExp;
  explanation: string;
  remediation: string;
}

const IDS_RULES: IdsRule[] = [
  {
    id: 'KALI-RCE-001',
    category: 'Reverse Shell / Stager',
    mitre: 'T1059.004 · Unix Shell',
    severity: 'critical',
    pattern: /(\/dev\/tcp\/[0-9a-z.-]+\/\d+|nc\s+-[a-z]*e\s+\/bin\/(ba)?sh|bash\s+-i\s+>&|mkfifo\s+\/tmp\/|socat\s+.*EXEC:|python3?\s+-c\s+['"].*socket.*pty\.spawn)/i,
    explanation: 'Interactive reverse-shell payload attempting to spawn a remote shell back to an external listener.',
    remediation: 'Block outbound raw sockets via systemd IPAddressDeny=any, egress firewall rules, and kill offending process group.',
  },
  {
    id: 'KALI-RCE-002',
    category: 'Command Injection / Pipe-to-Shell',
    mitre: 'T1105 · Ingress Tool Transfer',
    severity: 'critical',
    pattern: /(curl|wget)\s+[^\n|]*\|\s*(sudo\s+)?(ba)?sh\b|;\s*rm\s+-rf\s+\/|\$\(\s*(curl|wget|nc)\b|`\s*(curl|wget|cat\s+\/etc\/shadow)/i,
    explanation: 'Remote script execution or destructive shell chaining detected.',
    remediation: 'Never pipe untrusted network streams into a shell; download, verify SHA-256 digest, inspect, and execute inside an unprivileged sandbox.',
  },
  {
    id: 'KALI-SQLI-001',
    category: 'SQL Injection',
    mitre: 'T1190 · Exploit Public-Facing Application (OWASP A03)',
    severity: 'high',
    pattern: /(\bUNION\s+(ALL\s+)?SELECT\b|'\s*OR\s+['"]?1['"]?\s*=\s*['"]?1|--\s*$|;\s*DROP\s+TABLE\b|\bSLEEP\s*\(\s*\d+\s*\)|\bINFORMATION_SCHEMA\b)/i,
    explanation: 'SQL tautology, UNION extraction, stacked DROP query, or blind timing probe.',
    remediation: 'Use strictly parameterized prepared statements (SQLite bound parameters) and least-privilege DB accounts.',
  },
  {
    id: 'KALI-XSS-001',
    category: 'Cross-Site Scripting (XSS)',
    mitre: 'T1189 · Content Injection (OWASP A03)',
    severity: 'high',
    pattern: /(<script\b[^>]*>|javascript\s*:|on(error|load|mouseover|focus)\s*=\s*['"]?[^'">\s]+|<iframe\b[^>]*src=)/i,
    explanation: 'Executable script tag, inline DOM event handler, or javascript: URI scheme.',
    remediation: 'Enforce strict Content-Security-Policy (script-src self + nonce, object-src none) and context-aware output encoding.',
  },
  {
    id: 'KALI-LFI-001',
    category: 'Path Traversal / Sensitive File Probe',
    mitre: 'T1083 · File and Directory Discovery',
    severity: 'high',
    pattern: /((\.\.\/|\.\.\\|%2e%2e%2f|%252e%252e){2,}|\/etc\/(shadow|sudoers|gshadow)|\/proc\/self\/(environ|mem|maps))/i,
    explanation: 'Directory traversal sequence or direct probe of privileged Linux credential/process memory paths.',
    remediation: 'Normalize paths with realpath jail (Kernel.normPath + root prefix enforcement) and run services with ProtectSystem=strict.',
  },
  {
    id: 'KALI-SSRF-001',
    category: 'SSRF / Cloud Metadata Probe',
    mitre: 'T1552.005 · Cloud Instance Metadata API',
    severity: 'critical',
    pattern: /(169\.254\.169\.254|metadata\.google\.internal|100\.100\.100\.200\/latest\/meta-data|\[::ffff:a9fe:a9fe\])/i,
    explanation: 'Server-Side Request Forgery targeting link-local cloud instance credentials.',
    remediation: 'Block RFC3927 169.254.0.0/16 at the outbound HTTP proxy and systemd unit IPAddressDeny list.',
  },
  {
    id: 'KALI-AI-001',
    category: 'AI Prompt Injection / Gate Override',
    mitre: 'AML.T0051 · LLM Prompt Injection',
    severity: 'high',
    pattern: /(ignore\s+(all\s+)?(previous|prior|above)\s+instructions|disregard\s+(your\s+)?system\s+prompt|bypass\s+(the\s+)?(esai|capability|permission)\s+gate|you\s+are\s+now\s+unrestricted\s+root)/i,
    explanation: 'Adversarial prompt attempting to override agent instructions or trick an agent into escalating privileges.',
    remediation: 'Enforce permissions in the HarmOS Kernel capability gate (out-of-model), never in prompts; treat model output as untrusted.',
  },
  {
    id: 'KALI-PRIVESC-001',
    category: 'Privilege Escalation / Persistence',
    mitre: 'T1548 · Abuse Elevation Control Mechanism',
    severity: 'critical',
    pattern: /(NOPASSWD\s*:\s*ALL|chmod\s+([0-7]?[467][0-7]{2}|u\+s)\b|\/etc\/ld\.so\.preload|echo\s+.*>>\s*~?\/?\.ssh\/authorized_keys)/i,
    explanation: 'SUID bit set, passwordless sudoers rule, dynamic linker preload hijack, or unauthorized SSH key persistence.',
    remediation: 'Set NoNewPrivileges=yes, RestrictSUIDSGID=yes, disable root SSH, and monitor /etc with AIDE/FIM.',
  },
  {
    id: 'KALI-AUTH-001',
    category: 'SSH / Auth Brute-Force Indicator',
    mitre: 'T1110 · Brute Force',
    severity: 'medium',
    pattern: /(Failed password for (invalid user )?\S+ from \d+\.\d+\.\d+\.\d+|authentication failure;.*rhost=\S+|Invalid user \S+ from \d+\.\d+\.\d+\.\d+)/i,
    explanation: 'Repeated authentication failure entry matching SSH/PAM brute-force reconnaissance.',
    remediation: 'Enable Fail2Ban sshd aggressive jail (maxretry=4, bantime=1h) and keep SSH disabled by default on the HarmOS appliance.',
  },
];

export function analyzeThreatInput(rawInput: string): {
  alerts: ThreatAlert[];
  bruteForceIps: Array<{ ip: string; count: number }>;
  riskScore: number;
  scannedLines: number;
} {
  const lines = String(rawInput || '').split('\n');
  const alerts: ThreatAlert[] = [];
  const ipFailures = new Map<string, number>();

  lines.forEach((line, idx) => {
    if (!line.trim()) return;
    for (const rule of IDS_RULES) {
      const m = line.match(rule.pattern);
      if (m) {
        alerts.push({
          id: `${rule.id}-L${idx + 1}`,
          ruleId: rule.id,
          category: rule.category,
          mitre: rule.mitre,
          severity: rule.severity,
          line: idx + 1,
          snippet: redact(line.trim()).slice(0, 180),
          explanation: rule.explanation,
          remediation: rule.remediation,
        });
      }
    }
    if (/Failed password|Invalid user|authentication failure/i.test(line)) {
      const ip = line.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/)?.[1];
      if (ip) ipFailures.set(ip, (ipFailures.get(ip) || 0) + 1);
    }
  });

  const bruteForceIps = [...ipFailures.entries()]
    .filter(([, count]) => count >= 3)
    .map(([ip, count]) => ({ ip, count }))
    .sort((a, b) => b.count - a.count);

  const weights: Record<ThreatSeverity, number> = { critical: 35, high: 22, medium: 10, low: 4 };
  const rawScore = alerts.reduce((sum, a) => sum + weights[a.severity], 0) + bruteForceIps.length * 20;
  return {
    alerts,
    bruteForceIps,
    riskScore: Math.min(100, rawScore),
    scannedLines: lines.length,
  };
}

/* ---------------- 3. Cryptographic File Integrity Monitor (FIM) ---------------- */

export interface FimEntry {
  path: string;
  sha256: string;
  bytes: number;
  provenance: Provenance;
  author: string;
}

export interface FimBaseline {
  createdAt: number;
  digestHash: string;
  entries: Record<string, FimEntry>;
}

export interface FimDelta {
  path: string;
  status: 'MODIFIED' | 'ADDED' | 'DELETED' | 'PROVENANCE_CHANGED';
  before?: FimEntry;
  after?: FimEntry;
}

export function createFimBaseline(k: Kernel): FimBaseline {
  const entries: Record<string, FimEntry> = {};
  const files = Object.values(k.state.vfs)
    .filter((n) => n.kind === 'file')
    .sort((a, b) => a.path.localeCompare(b.path));
  for (const f of files) {
    entries[f.path] = {
      path: f.path,
      sha256: sha256Hex(f.content),
      bytes: f.content.length,
      provenance: f.provenance,
      author: f.author,
    };
  }
  const manifest = Object.values(entries)
    .map((e) => `${e.sha256}  ${e.provenance}  ${e.path}`)
    .join('\n');
  return {
    createdAt: Date.now(),
    digestHash: sha256Hex(manifest),
    entries,
  };
}

export function verifyFimBaseline(k: Kernel, baseline: FimBaseline): {
  clean: boolean;
  checkedFiles: number;
  deltas: FimDelta[];
} {
  const current = createFimBaseline(k);
  const deltas: FimDelta[] = [];
  const allPaths = new Set([...Object.keys(baseline.entries), ...Object.keys(current.entries)]);

  for (const p of [...allPaths].sort()) {
    const b = baseline.entries[p];
    const c = current.entries[p];
    if (b && !c) deltas.push({ path: p, status: 'DELETED', before: b });
    else if (!b && c) deltas.push({ path: p, status: 'ADDED', after: c });
    else if (b && c) {
      if (b.sha256 !== c.sha256) deltas.push({ path: p, status: 'MODIFIED', before: b, after: c });
      else if (b.provenance !== c.provenance) deltas.push({ path: p, status: 'PROVENANCE_CHANGED', before: b, after: c });
    }
  }
  return {
    clean: deltas.length === 0,
    checkedFiles: allPaths.size,
    deltas,
  };
}

/* ---------------- 4. Secret & Passphrase Entropy Auditor ---------------- */

export interface EntropyReport {
  length: number;
  shannonBitsPerChar: number;
  keyspaceBits: number;
  tier: 'critical-weak' | 'weak' | 'moderate' | 'strong' | 'cryptographic';
  warnings: string[];
}

export function auditSecretStrength(secret: string): EntropyReport {
  const s = String(secret || '');
  if (!s.length) {
    return { length: 0, shannonBitsPerChar: 0, keyspaceBits: 0, tier: 'critical-weak', warnings: ['Empty secret'] };
  }
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) || 0) + 1);
  let H = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    H -= p * Math.log2(p);
  }
  let pool = 0;
  if (/[a-z]/.test(s)) pool += 26;
  if (/[A-Z]/.test(s)) pool += 26;
  if (/[0-9]/.test(s)) pool += 10;
  if (/[^A-Za-z0-9]/.test(s)) pool += 33;
  const keyspaceBits = Math.round(s.length * Math.log2(Math.max(2, pool)) * Math.min(1, H / 3.2));

  const warnings: string[] = [];
  if (s.length < 14) warnings.push('Shorter than 14 characters — vulnerable to GPU dictionary/mask attacks.');
  if (/(password|admin|qwerty|123456|harmos|letmein|welcome)/i.test(s)) warnings.push('Contains a high-frequency dictionary word.');
  if (/(.)\1{2,}/.test(s)) warnings.push('Contains 3+ repeated consecutive characters.');
  if (freq.size <= Math.max(3, Math.floor(s.length / 4))) warnings.push('Low unique character diversity.');

  const tier: EntropyReport['tier'] =
    keyspaceBits < 40 || warnings.length >= 2 ? 'critical-weak'
      : keyspaceBits < 60 ? 'weak'
        : keyspaceBits < 85 ? 'moderate'
          : keyspaceBits < 120 ? 'strong' : 'cryptographic';

  return {
    length: s.length,
    shannonBitsPerChar: Number(H.toFixed(2)),
    keyspaceBits,
    tier,
    warnings,
  };
}

/* ---------------- 5. Linux Hardening Config Generator ---------------- */

export interface HardeningProfileOpts {
  sshPort: number;
  allowSshInbound: boolean;
  loopbackNexusPort: number;
  banMinutes: number;
  maxAuthRetries: number;
  strictPtrace: boolean;
  lockUnprivBpf: boolean;
}

export function generateLinuxHardeningBundle(o: HardeningProfileOpts): string {
  return [
    '#!/usr/bin/env bash',
    '# Generated by HarmOS KaliOS Anti-Hacking Policy Builder',
    'set -euo pipefail',
    '',
    '# 1. Zero-Trust Host Firewall (UFW)',
    'ufw --force reset',
    'ufw default deny incoming',
    'ufw default allow outgoing',
    'ufw allow in on lo',
    `ufw deny in proto tcp to any port ${o.loopbackNexusPort} comment "Block external Nexus access"`,
    o.allowSshInbound
      ? `ufw limit in proto tcp to any port ${o.sshPort} comment "Rate-limited SSH"`
      : `# SSH inbound disabled (zero-listener default)`,
    'ufw --force enable',
    '',
    '# 2. Kernel Anti-Spoofing, ASLR & Exploit Mitigation (/etc/sysctl.d/99-harmos-hardening.conf)',
    'cat >/etc/sysctl.d/99-harmos-hardening.conf <<\'EOF\'',
    'net.ipv4.tcp_syncookies = 1',
    'net.ipv4.conf.all.rp_filter = 1',
    'net.ipv4.conf.default.rp_filter = 1',
    'net.ipv4.conf.all.accept_redirects = 0',
    'net.ipv6.conf.all.accept_redirects = 0',
    'net.ipv4.conf.all.send_redirects = 0',
    'net.ipv4.conf.all.accept_source_route = 0',
    'kernel.randomize_va_space = 2',
    'kernel.kptr_restrict = 2',
    'kernel.dmesg_restrict = 1',
    `kernel.yama.ptrace_scope = ${o.strictPtrace ? 2 : 1}`,
    `kernel.unprivileged_bpf_disabled = ${o.lockUnprivBpf ? 1 : 0}`,
    'fs.protected_hardlinks = 1',
    'fs.protected_symlinks = 1',
    'fs.suid_dumpable = 0',
    'EOF',
    'sysctl --system',
    '',
    '# 3. Fail2Ban Intrusion & Brute-Force Prevention (/etc/fail2ban/jail.d/harmos.local)',
    'cat >/etc/fail2ban/jail.d/harmos.local <<\'EOF\'',
    '[DEFAULT]',
    `bantime  = ${o.banMinutes}m`,
    'findtime = 10m',
    `maxretry = ${o.maxAuthRetries}`,
    'banaction = ufw',
    '[sshd]',
    `enabled = ${o.allowSshInbound ? 'true' : 'false'}`,
    `port    = ${o.sshPort}`,
    'mode    = aggressive',
    'EOF',
    'systemctl restart fail2ban || true',
  ].join('\n');
}

/* ---------------- 6. Best-in-Class Anti-Hacking Tool Arsenal ---------------- */

export interface DefensiveTool {
  id: string;
  name: string;
  domain: 'Firewall & Network' | 'Intrusion Detection' | 'File Integrity' | 'Kernel & Sandbox' | 'Secret Hygiene';
  runtime: 'live-in-ui' | 'installed-in-ova' | 'optional-linux-pkg';
  summary: string;
  verifyCmd: string;
}

export const DEFENSIVE_ARSENAL: DefensiveTool[] = [
  {
    id: 'kalios-ids',
    name: 'KaliOS Payload & Log IDS',
    domain: 'Intrusion Detection',
    runtime: 'live-in-ui',
    summary: 'Multi-signature detector for reverse shells, SQLi, XSS, LFI, SSRF, prompt injection, and SSH brute-force.',
    verifyCmd: 'In-app: IT Security -> Threat & Payload IDS',
  },
  {
    id: 'kalios-fim',
    name: 'Vault SHA-256 FIM',
    domain: 'File Integrity',
    runtime: 'live-in-ui',
    summary: 'Cryptographic FIPS 180-4 SHA-256 baseline and real-time tamper/provenance drift verification over Sovereign Vault.',
    verifyCmd: 'In-app: IT Security -> Cryptographic FIM',
  },
  {
    id: 'kalios-redactor',
    name: 'Secret Sentinel & Entropy Auditor',
    domain: 'Secret Hygiene',
    runtime: 'live-in-ui',
    summary: 'Scrubs API keys from logs/exports, keeps credentials in volatile memory, and scores passphrase bit-entropy.',
    verifyCmd: 'selftest: secret.redaction',
  },
  {
    id: 'ufw-nft',
    name: 'UFW / nftables Host Firewall',
    domain: 'Firewall & Network',
    runtime: 'installed-in-ova',
    summary: 'Default-deny inbound packet filtering inside the Ubuntu 24.04 HarmOS appliance; blocks external port 8787.',
    verifyCmd: 'sudo ufw status verbose',
  },
  {
    id: 'fail2ban',
    name: 'Fail2Ban Ban Engine',
    domain: 'Intrusion Detection',
    runtime: 'installed-in-ova',
    summary: 'Monitors systemd journald auth streams and automatically firewall-bans brute-force scanner IPs.',
    verifyCmd: 'sudo fail2ban-client status',
  },
  {
    id: 'sysctl-hardening',
    name: 'Kernel Anti-Exploit sysctl',
    domain: 'Kernel & Sandbox',
    runtime: 'installed-in-ova',
    summary: 'Enforces ASLR=2, SYN cookies, rp_filter, kptr_restrict=2, dmesg_restrict=1, yama.ptrace_scope=2, no BPF.',
    verifyCmd: 'sysctl kernel.kptr_restrict kernel.yama.ptrace_scope net.ipv4.tcp_syncookies',
  },
  {
    id: 'systemd-sandbox',
    name: 'systemd Service Jail + AppArmor',
    domain: 'Kernel & Sandbox',
    runtime: 'installed-in-ova',
    summary: 'Confines harmos-nexus with ProtectSystem=strict, NoNewPrivileges=yes, PrivateDevices=yes, IPAddressDeny=any.',
    verifyCmd: 'systemd-analyze security harmos-nexus.service',
  },
  {
    id: 'rkhunter-lynis',
    name: 'Lynis & Rootkit Hunter Profile',
    domain: 'File Integrity',
    runtime: 'optional-linux-pkg',
    summary: 'On-demand CIS benchmark system auditing and SUID/rootkit anomaly sweeps inside the Linux guest.',
    verifyCmd: 'sudo apt install lynis rkhunter && sudo lynis audit system --quick',
  },
];
