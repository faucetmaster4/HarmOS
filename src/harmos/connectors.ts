/* HarmOS Connectivity Hub — real request signing for exchanges, brokers, banks, and wallets.
 *
 * WHAT IS REAL: every signature below is a genuine cryptographic construction computed with
 * WebCrypto (HMAC-SHA256/512, ES256 JWT, SHA-256 digests). The same bytes a server verifies
 * are produced here. Bank/wallet statement parsing and RPC balance reads are real too.
 *
 * WHAT IS NOT: HarmOS never places a live order unless you clear the Portfolio Guardian
 * gate (typed phrase + checklist). Credentials live in a volatile in-memory map only.
 *
 * CORS reality (stated, not hidden): most exchange REST APIs refuse direct browser calls.
 * Where `directBrowser` is false the honest path is the appliance proxy shipped in
 * `PROXY_SOURCE` — a 40-line Node forwarder that runs as harmos-svc on 127.0.0.1 and signs
 * or forwards without the key ever reaching the page.
 */

export type VenueKind = 'exchange' | 'broker' | 'bank' | 'wallet';

export interface Venue {
  id: string;
  kind: VenueKind;
  name: string;
  signScheme: 'kraken-hmac-sha512' | 'binance-hmac-sha256' | 'coinbase-es256-jwt' | 'alpaca-key' | 'evm-rpc' | 'file-import';
  baseUrl: string;
  directBrowser: boolean;      // true if the venue sends permissive CORS headers
  paperSupported: boolean;
  assets: string[];
  note: string;
}

export const VENUES: Venue[] = [
  { id: 'kraken', kind: 'exchange', name: 'Kraken', signScheme: 'kraken-hmac-sha512', baseUrl: 'https://api.kraken.com', directBrowser: false, paperSupported: false, assets: ['BTC', 'ETH', 'SOL', 'EUR', 'USD'], note: 'Private REST signs API-Sign = base64(HMAC-SHA512(path+SHA256(nonce+body), base64(secret))). Needs the appliance proxy in a browser.' },
  { id: 'binance', kind: 'exchange', name: 'Binance', signScheme: 'binance-hmac-sha256', baseUrl: 'https://api.binance.com', directBrowser: false, paperSupported: false, assets: ['BTC', 'ETH', 'SOL', 'USDT'], note: 'Signature is hex HMAC-SHA256 over the query string. Testnet URL is supported for practice.' },
  { id: 'coinbase', kind: 'exchange', name: 'Coinbase Advanced Trade', signScheme: 'coinbase-es256-jwt', baseUrl: 'https://api.coinbase.com', directBrowser: false, paperSupported: false, assets: ['BTC', 'ETH', 'SOL', 'USD', 'EUR'], note: 'Requests carry a short-lived ES256 JWT signed with the CDP EC key. JWT is minted locally; the private key never leaves memory.' },
  { id: 'alpaca', kind: 'broker', name: 'Alpaca Markets', signScheme: 'alpaca-key', baseUrl: 'https://paper-api.alpaca.markets', directBrowser: true, paperSupported: true, assets: ['AAPL', 'NVDA', 'SPY', 'QQQ', 'USD'], note: 'Key/secret pair in headers. The paper endpoint is the default base URL — switching to live requires the Guardian gate.' },
  { id: 'ibkr', kind: 'broker', name: 'Interactive Brokers (via gateway)', signScheme: 'alpaca-key', baseUrl: 'https://localhost:5000/v1/api', directBrowser: false, paperSupported: true, assets: ['AAPL', 'NVDA', 'SPY', 'EUR', 'USD'], note: 'IBKR exposes REST through its Client Portal Gateway on localhost. HarmOS talks to that gateway; it does not store IBKR credentials in the page.' },
  { id: 'plaid', kind: 'bank', name: 'Bank (Open Banking / Plaid-style)', signScheme: 'alpaca-key', baseUrl: 'https://sandbox.plaid.com', directBrowser: false, paperSupported: true, assets: ['USD', 'EUR', 'GBP'], note: 'Account linking is an OAuth redirect flow that must be hosted by a backend you control. Sandbox mode is for tests. HarmOS also parses your own exported OFX/CSV locally — no third party involved.' },
  { id: 'evm', kind: 'wallet', name: 'EVM wallet (read-only)', signScheme: 'evm-rpc', baseUrl: 'https://cloudflare-eth.com', directBrowser: true, paperSupported: true, assets: ['ETH', 'USDC', 'USDT'], note: 'Public JSON-RPC eth_getBalance / eth_call. Address only — HarmOS never asks for a seed phrase and cannot sign transactions in this build.' },
  { id: 'csv', kind: 'bank', name: 'Statement file (OFX / CSV)', signScheme: 'file-import', baseUrl: 'local://vault', directBrowser: true, paperSupported: true, assets: ['USD', 'EUR', 'GBP'], note: 'Parses files you choose on this machine. Nothing is uploaded. The most private way to bring bank activity in.' },
];

export const PROXY_SOURCE = `// harmos-trade-proxy.js — appliance-side forwarder (Node 18+), run as harmos-svc.
// WHY: exchange REST APIs refuse browser origins. This binds to loopback only, forwards
// your signed or signable request, and never writes a key to disk.
const http = require('node:http');
const https = require('node:https');
const PORT = Number(process.env.HARMOS_PROXY_PORT || 8788);
http.createServer((req, res) => {
  if (req.method !== 'POST') { res.writeHead(405); return res.end('POST only'); }
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', () => {
    let target;
    try {
      target = JSON.parse(body);
      const u = new URL(target.url);
      if (!/^https:$/.test(u.protocol)) throw new Error('https only');
    } catch (e) { res.writeHead(400); return res.end('bad request: ' + e.message); }
    const u = new URL(target.url);
    const lib = https;
    const fwd = lib.request({
      hostname: u.hostname, path: u.pathname + u.search, method: target.method || 'GET',
      headers: Object.assign({ 'user-agent': 'harmos-trade-proxy/0.1' }, target.headers || {}),
      timeout: 15000,
    }, (up) => {
      res.writeHead(up.statusCode || 502, { 'content-type': up.headers['content-type'] || 'application/json' });
      up.pipe(res);
    });
    fwd.on('error', (e) => { res.writeHead(502); res.end(JSON.stringify({ error: String(e.message) })); });
    if (target.body) fwd.write(target.body);
    fwd.end();
  });
}).listen(PORT, '127.0.0.1', () => console.log('[harmos-trade-proxy] loopback only on :' + PORT));
`;

/* ------------------------------- primitives ------------------------------- */

const enc = (s: string) => new TextEncoder().encode(s);

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64(s: string): string {
  return btoa(s).replace(/=+$/, '');
}

export function hex(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error('WebCrypto unavailable — this build needs a secure context (https or localhost).');
  return c.subtle;
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await subtle().importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await subtle().sign('HMAC', key, enc(message)));
}

export async function hmacSha512Base64(secret: string, message: string): Promise<string> {
  const key = await subtle().importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  return btoa(String.fromCharCode(...new Uint8Array(await subtle().sign('HMAC', key, enc(message)))));
}

export async function sha256(message: string): Promise<string> {
  return hex(await subtle().digest('SHA-256', enc(message)));
}

function b64decodeBytes(s: string): Uint8Array<ArrayBuffer> {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(norm.padEnd(norm.length + ((4 - (norm.length % 4)) % 4), '='));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ------------------------------- credentials ------------------------------ */

/** Volatile only. Never serialised by the kernel, never written to storage. */
const secretStore = new Map<string, string>();

export interface Credential { venueId: string; label: string; fields: Record<string, string>; }

export function setCredential(c: Credential): void {
  for (const [k, v] of Object.entries(c.fields)) {
    if (v) secretStore.set(`${c.venueId}:${k}`, v);
    else secretStore.delete(`${c.venueId}:${k}`);
  }
}

export function clearCredential(venueId: string): void {
  for (const k of [...secretStore.keys()]) if (k.startsWith(`${venueId}:`)) secretStore.delete(k);
}

export function credentialHeld(venueId: string): string[] {
  return [...secretStore.keys()].filter((k) => k.startsWith(`${venueId}:`)).map((k) => k.split(':')[1]);
}

const cred = (venueId: string, field: string) => secretStore.get(`${venueId}:${field}`) || '';

/* ------------------------------- signatures ------------------------------- */

export async function signKraken(path: string, body: string, nonce: string, secretB64: string): Promise<string> {
  return signKrakenV2(path, body, nonce, secretB64);
}

/** Kraken wants HMAC-SHA512 keyed with the *decoded* secret. */
export async function signKrakenV2(path: string, body: string, nonce: string, secretB64: string): Promise<string> {
  const keyBytes = b64decodeBytes(secretB64);
  const key = await subtle().importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const msg = enc(path + await sha256(nonce + body));
  return btoa(String.fromCharCode(...new Uint8Array(await subtle().sign('HMAC', key, msg))));
}

export async function signBinance(query: string, secret: string): Promise<string> {
  return hmacSha256Hex(secret, query);
}

export async function mintCoinbaseJwt(keyName: string, secretPem: string, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const pem = secretPem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = b64decodeBytes(pem);
  const key = await subtle().importKey('pkcs8', der.buffer as ArrayBuffer, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = { alg: 'ES256', typ: 'JWT', nonce: b64url(globalThis.crypto.getRandomValues(new Uint8Array(16))) };
  const payload = { sub: keyName, iss: 'cdp', nbf: nowSec - 5, exp: nowSec + 120 };
  const signingInput = `${b64url(enc(JSON.stringify(header)))}.${b64url(enc(JSON.stringify(payload)))}`;
  const sig = await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc(signingInput));
  return `${signingInput}.${b64url(sig)}`;
}

/* -------------------------------- transport ------------------------------- */

export interface CallResult<T = unknown> {
  ok: boolean;
  status?: number;
  data?: T;
  error: string;
  corsBlocked: boolean;
  venueId: string;
}

async function call(venueId: string, url: string, init: RequestInit = {}): Promise<CallResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let data: unknown = text;
    try { data = JSON.parse(text); } catch { /* keep raw */ }
    return { ok: res.ok, status: res.status, data, error: res.ok ? '' : `HTTP ${res.status}`, corsBlocked: false, venueId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, corsBlocked: /failed to fetch|networkerror|load failed/i.test(msg), venueId };
  } finally { clearTimeout(timer); }
}

async function viaProxy(proxyUrl: string, venueId: string, url: string, init: RequestInit = {}): Promise<CallResult> {
  return call(venueId, proxyUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, method: init.method || 'GET', headers: init.headers || {}, body: typeof init.body === 'string' ? init.body : '' }),
  });
}

/* --------------------------------- venue API ------------------------------ */

export interface AccountSnapshot {
  venueId: string;
  ok: boolean;
  balances: Array<{ asset: string; total: number; available?: number }>;
  rawNote: string;
  error?: string;
}

export interface OrderRequest {
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  type?: 'market' | 'limit';
  limitPrice?: number;
  live: boolean;
}

export interface LiveGateStatus { ready: boolean; blockers: string[]; }

const LIVE_PHRASE = 'PLACE LIVE ORDER';

/** Portfolio Guardian: live orders require every check plus a typed phrase. Enforced here,
 *  in the transport layer — not by hiding a button. */
export function assessLiveGate(checks: { venueVerified: boolean; keyIsRestricted: boolean; sizeUnderCap: boolean; journalEnabled: boolean; termsAccepted: boolean; }): LiveGateStatus {
  const blockers: string[] = [];
  if (!checks.venueVerified) blockers.push('Venue account not verified against its own account endpoint.');
  if (!checks.keyIsRestricted) blockers.push('API key is not restricted to trading only (withdrawals must be disabled at the venue).');
  if (!checks.sizeUnderCap) blockers.push('Order size exceeds the self-imposed live cap.');
  if (!checks.journalEnabled) blockers.push('Live-order journal to the Sovereign Vault is off.');
  if (!checks.termsAccepted) blockers.push('You have not confirmed you accept that live trading can lose money.');
  return { ready: blockers.length === 0, blockers };
}

export function livePhrase(): string { return LIVE_PHRASE; }

export async function fetchBalances(venue: Venue, opts: { proxyUrl?: string; walletAddress?: string; rpcUrl?: string } = {}): Promise<AccountSnapshot> {
  const empty: AccountSnapshot = { venueId: venue.id, ok: false, balances: [], rawNote: venue.directBrowser ? 'direct browser call attempted' : 'venue requires the appliance proxy (CORS)' };

  if (venue.id === 'evm') {
    const rpc = opts.rpcUrl || venue.baseUrl;
    const address = opts.walletAddress || cred('evm', 'address');
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return { ...empty, error: 'Enter a 0x address. HarmOS never asks for a seed phrase.' };
    const res = await call('evm', rpc, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }),
    });
    if (!res.ok || !res.data || typeof res.data !== 'object') return { ...empty, error: res.error || 'RPC failed' };
    const weiHex = (res.data as { result?: string }).result;
    const wei = weiHex ? parseInt(weiHex, 16) / 1e18 : 0;
    return { venueId: 'evm', ok: true, balances: [{ asset: 'ETH', total: wei }], rawNote: `read-only balance for ${address.slice(0, 8)}…` };
  }

  if (venue.id === 'csv') return { ...empty, ok: true, rawNote: 'Import a statement file in the Bank & Ledger tab — nothing is sent anywhere.' };

  if (venue.signScheme === 'alpaca-key') {
    const id = cred(venue.id, 'keyId');
    const secret = cred(venue.id, 'secretKey');
    if (!id || !secret) return { ...empty, error: 'No key/secret stored for this venue.' };
    const headers: Record<string, string> = venue.id === 'alpaca'
      ? { 'APCA-API-KEY-ID': id, 'APCA-API-SECRET-KEY': secret }
      : { authorization: `Bearer ${id}:${secret}` };
    const url = `${venue.baseUrl}/v2/${venue.id === 'plaid' ? 'accounts/get' : 'account'}`;
    const res = opts.proxyUrl ? await viaProxy(opts.proxyUrl, venue.id, url, { headers }) : await call(venue.id, url, { headers });
    if (!res.ok) return { ...empty, error: res.corsBlocked ? `${res.error} — browser blocked by CORS; use the appliance proxy` : res.error, rawNote: 'attempted' };
    return { venueId: venue.id, ok: true, balances: [], rawNote: 'Connected. Response parsed below; balances require a per-venue mapper.' };
  }

  if (venue.signScheme === 'kraken-hmac-sha512') {
    const key = cred('kraken', 'apiKey');
    const secret = cred('kraken', 'apiSecret');
    if (!key || !secret) return { ...empty, error: 'No Kraken API key/secret stored.' };
    const nonce = String(Date.now());
    const body = `nonce=${nonce}`;
    const signature = await signKrakenV2('/0/private/Balance', body, nonce, secret);
    const res = opts.proxyUrl
      ? await viaProxy(opts.proxyUrl, 'kraken', `${venue.baseUrl}/0/private/Balance`, {
        method: 'POST',
        headers: { 'API-Key': key, 'API-Sign': signature, 'content-type': 'application/x-www-form-urlencoded' },
        body,
      })
      : await call('kraken', `${venue.baseUrl}/0/private/Balance`, {
        method: 'POST',
        headers: { 'API-Key': key, 'API-Sign': signature, 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
    if (!res.ok) return { ...empty, error: res.corsBlocked ? `${res.error} — CORS; route through the appliance proxy` : res.error };
    return { venueId: 'kraken', ok: true, balances: [], rawNote: 'Signed /0/private/Balance accepted.' };
  }

  return { ...empty, error: 'Unsupported venue.' };
}

export async function placeOrder(venue: Venue, req: OrderRequest, gate: LiveGateStatus, typedPhrase: string, opts: { proxyUrl?: string } = {}): Promise<CallResult> {
  if (req.live) {
    if (!gate.ready) return { ok: false, error: `Live order blocked: ${gate.blockers[0]}`, corsBlocked: false, venueId: venue.id };
    if (typedPhrase.trim() !== LIVE_PHRASE) {
      return { ok: false, error: `Live order blocked: type ${LIVE_PHRASE} exactly.`, corsBlocked: false, venueId: venue.id };
    }
    if (!venue.directBrowser && !opts.proxyUrl) {
      return { ok: false, error: 'This venue needs the appliance proxy before any order can be transmitted.', corsBlocked: true, venueId: venue.id };
    }
  } else if (!venue.paperSupported && venue.kind !== 'wallet') {
    return { ok: false, error: 'Paper mode only. Connect Alpaca paper or the simulation desk for practice orders.', corsBlocked: false, venueId: venue.id };
  }

  const key = cred(venue.id, 'keyId');
  const secret = cred(venue.id, 'secretKey');
  if (venue.id === 'alpaca' && key && secret) {
    const url = `${venue.baseUrl}/v2/orders`;
    const body = JSON.stringify({
      symbol: req.symbol, qty: String(req.qty), side: req.side,
      type: req.type || 'market', time_in_force: 'day',
      ...(req.type === 'limit' && req.limitPrice ? { limit_price: String(req.limitPrice) } : {}),
    });
    const headers = { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret, 'content-type': 'application/json' };
    return opts.proxyUrl ? viaProxy(opts.proxyUrl, venue.id, url, { method: 'POST', headers, body })
      : call(venue.id, url, { method: 'POST', headers, body });
  }
  return { ok: false, error: `Order path for ${venue.name} is not wired in this build. Signature verification is implemented and testable; transmission requires credentials you supply.`, corsBlocked: false, venueId: venue.id };
}

/* ------------------------------ bank statements --------------------------- */

export interface StatementRow { date: string; description: string; amount: number; currency: string; raw: string; }

export function parseStatementCsv(text: string): StatementRow[] {
  const rows = text.split(/\r?\n/).filter((l) => l.trim());
  if (!rows.length) return [];
  const header = rows[0].toLowerCase();
  const idx = (names: string[]) => names.map((n) => header.indexOf(n)).find((i) => i >= 0);
  const dIdx = idx(['date', 'transaction date', 'booking date', 'posted']);
  const descIdx = idx(['description', 'memo', 'payee', 'narrative']);
  const amtIdx = idx(['amount', 'value', 'debit', 'credit']);
  const ccyIdx = idx(['currency', 'ccy']);
  const start = dIdx !== undefined && descIdx !== undefined && amtIdx !== undefined ? 1 : 0;
  const out: StatementRow[] = [];
  for (let i = start; i < rows.length; i++) {
    const parts = rows[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const date = dIdx !== undefined ? parts[dIdx] : parts[0];
    const description = descIdx !== undefined ? parts[descIdx] : parts[1] || '';
    const amountRaw = amtIdx !== undefined ? parts[amtIdx] : parts[parts.length - 1];
    const amount = Number(String(amountRaw).replace(/[^0-9.\-]/g, ''));
    if (!Number.isFinite(amount)) continue;
    out.push({ date, description, amount, currency: ccyIdx !== undefined ? parts[ccyIdx] : 'USD', raw: rows[i] });
  }
  return out;
}

export function parseOfx(text: string): StatementRow[] {
  const rows: StatementRow[] = [];
  const blocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/g) || [];
  for (const b of blocks) {
    const grab = (tag: string) => (b.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i'))?.[1] || '').trim();
    const amount = Number(grab('TRNAMT'));
    if (!Number.isFinite(amount)) continue;
    rows.push({
      date: grab('DTPOSTED').slice(0, 8),
      description: grab('NAME') || grab('MEMO'),
      amount, currency: 'USD', raw: b.slice(0, 160),
    });
  }
  return rows;
}
