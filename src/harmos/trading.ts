/* HarmOS paper-trading desk.
 *
 * This is a simulated matching engine. It does not connect to a broker, exchange,
 * or payment rail, and it cannot move real crypto, equities, or fiat. Quotes are
 * either a labeled public snapshot (when a feed answers) or a labeled local walk.
 * Nothing here is financial advice or a promise of profit.
 */

export type AssetClass = 'crypto' | 'equity' | 'fx' | 'commodity';
export type StrategyMode = 'manual' | 'dca' | 'grid' | 'momentum' | 'mean-reversion' | 'risk-off';
export type QuoteSource = 'public-feed' | 'simulated';

export interface Instrument {
  symbol: string;
  name: string;
  klass: AssetClass;
  seed: number;
  unit: string;
  geckoId?: string;
}

export interface Quote {
  symbol: string;
  price: number;
  source: QuoteSource;
  at: number;
}

export interface Position { qty: number; avg: number; }

export interface PaperTrade {
  id: string;
  at: number;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  notional: number;
  mode: StrategyMode;
  reason: string;
  source: QuoteSource;
}

export interface PaperBook {
  cashUsd: number;
  positions: Record<string, Position>;
  trades: PaperTrade[];
  halted: boolean;
  haltReason: string;
  dayStartEquity: number;
  prices: Record<string, number>;
  sources: Record<string, QuoteSource>;
  seq: number;
}

export interface RiskLimits {
  maxOrderPct: number;     // fraction of equity
  maxDailyLossPct: number; // fraction of day-start equity
  allowShort: false;
}

export const DEFAULT_LIMITS: RiskLimits = { maxOrderPct: 0.2, maxDailyLossPct: 0.08, allowShort: false };

export const INSTRUMENTS: Instrument[] = [
  { symbol: 'BTC-USD', name: 'Bitcoin', klass: 'crypto', seed: 64250, unit: 'BTC', geckoId: 'bitcoin' },
  { symbol: 'ETH-USD', name: 'Ether', klass: 'crypto', seed: 3180, unit: 'ETH', geckoId: 'ethereum' },
  { symbol: 'SOL-USD', name: 'Solana', klass: 'crypto', seed: 148, unit: 'SOL', geckoId: 'solana' },
  { symbol: 'AAPL', name: 'Apple', klass: 'equity', seed: 228.4, unit: 'sh' },
  { symbol: 'NVDA', name: 'NVIDIA', klass: 'equity', seed: 131.2, unit: 'sh' },
  { symbol: 'SPY', name: 'S&P 500 ETF', klass: 'equity', seed: 562.1, unit: 'sh' },
  { symbol: 'EURUSD', name: 'Euro / US dollar', klass: 'fx', seed: 1.086, unit: 'EUR' },
  { symbol: 'GBPUSD', name: 'Sterling / US dollar', klass: 'fx', seed: 1.274, unit: 'GBP' },
  { symbol: 'XAUUSD', name: 'Gold', klass: 'commodity', seed: 2648, unit: 'oz' },
];

export const STRATEGY_META: Record<StrategyMode, { label: string; blurb: string }> = {
  manual: { label: 'Manual', blurb: 'You place every paper order. The desk only checks risk limits.' },
  dca: { label: 'DCA', blurb: 'Buys a fixed USD slice on each tick, ignoring short-term noise.' },
  grid: { label: 'Grid', blurb: 'Buys a step below the anchor and sells a step above it. Range assumption, not a forecast.' },
  momentum: { label: 'Momentum', blurb: 'Follows a short moving average: adds when price is above it, trims when below.' },
  'mean-reversion': { label: 'Mean reversion', blurb: 'Fades stretches away from the short average. Fails in strong trends — the halt is the safety.' },
  'risk-off': { label: 'Risk-off', blurb: 'Reduces the largest position when drawdown from the session peak exceeds the threshold.' },
};

export function createBook(cashUsd = 100_000): PaperBook {
  const prices: Record<string, number> = {};
  const sources: Record<string, QuoteSource> = {};
  for (const i of INSTRUMENTS) { prices[i.symbol] = i.seed; sources[i.symbol] = 'simulated'; }
  return {
    cashUsd, positions: {}, trades: [], halted: false, haltReason: '',
    dayStartEquity: cashUsd, prices, sources, seq: 1,
  };
}

export function equityOf(book: PaperBook): number {
  let v = book.cashUsd;
  for (const [sym, pos] of Object.entries(book.positions)) v += pos.qty * (book.prices[sym] || 0);
  return v;
}

export function unrealized(book: PaperBook, symbol: string): number {
  const pos = book.positions[symbol];
  if (!pos || !pos.qty) return 0;
  return (book.prices[symbol] - pos.avg) * pos.qty;
}

/** Local quote walk. Deterministic given (symbol, tick) so tests and the chart agree. */
export function simulatedPrice(symbol: string, tick: number, seed?: number): number {
  const inst = INSTRUMENTS.find((i) => i.symbol === symbol);
  const base = seed ?? inst?.seed ?? 100;
  const phase = symbol.split('').reduce((n, c) => n + c.charCodeAt(0), 0);
  const wave = Math.sin(tick / 7 + phase) * 0.006 + Math.sin(tick / 19 + phase * 0.3) * 0.0035;
  const drift = Math.cos(tick / 41 + phase) * 0.0008;
  return Math.max(0.0001, base * (1 + wave + drift * (tick % 80)));
}

export function applyQuotes(book: PaperBook, quotes: Quote[]): PaperBook {
  const prices = { ...book.prices };
  const sources = { ...book.sources };
  for (const q of quotes) {
    if (!Number.isFinite(q.price) || q.price <= 0) continue;
    prices[q.symbol] = q.price;
    sources[q.symbol] = q.source;
  }
  return { ...book, prices, sources };
}

export interface FillResult { book: PaperBook; trade?: PaperTrade; error?: string; }

export function paperFill(
  book: PaperBook,
  req: { symbol: string; side: 'buy' | 'sell'; qty: number; mode: StrategyMode; reason: string },
  limits: RiskLimits = DEFAULT_LIMITS,
): FillResult {
  if (book.halted) return { book, error: `halted: ${book.haltReason}` };
  const px = book.prices[req.symbol];
  if (!px) return { book, error: `no quote for ${req.symbol}` };
  if (!(req.qty > 0) || !Number.isFinite(req.qty)) return { book, error: 'quantity must be positive' };
  const notional = req.qty * px;
  const eq = equityOf(book);
  if (notional > eq * limits.maxOrderPct + 1e-6) {
    return { book, error: `order ${notional.toFixed(2)} exceeds ${(limits.maxOrderPct * 100).toFixed(0)}% equity cap` };
  }
  const pos = book.positions[req.symbol] || { qty: 0, avg: 0 };
  let cash = book.cashUsd;
  let nextPos = { ...pos };
  if (req.side === 'buy') {
    if (notional > cash + 1e-6) return { book, error: 'insufficient paper cash' };
    const qty = pos.qty + req.qty;
    nextPos = { qty, avg: qty === 0 ? 0 : (pos.avg * pos.qty + notional) / qty };
    cash -= notional;
  } else {
    if (!limits.allowShort && req.qty > pos.qty + 1e-9) return { book, error: 'shorting is disabled in this build' };
    nextPos = { qty: pos.qty - req.qty, avg: pos.qty - req.qty <= 1e-9 ? 0 : pos.avg };
    cash += notional;
  }
  const trade: PaperTrade = {
    id: `p${book.seq}`, at: Date.now(), symbol: req.symbol, side: req.side, qty: req.qty, price: px,
    notional, mode: req.mode, reason: req.reason, source: book.sources[req.symbol] || 'simulated',
  };
  const positions = { ...book.positions, [req.symbol]: nextPos };
  if (nextPos.qty <= 1e-9) delete positions[req.symbol];
  let next: PaperBook = { ...book, cashUsd: cash, positions, trades: [trade, ...book.trades].slice(0, 200), seq: book.seq + 1 };
  const dd = book.dayStartEquity > 0 ? (book.dayStartEquity - equityOf(next)) / book.dayStartEquity : 0;
  if (dd >= limits.maxDailyLossPct) {
    next = { ...next, halted: true, haltReason: `daily loss ${(dd * 100).toFixed(1)}% hit the ${(limits.maxDailyLossPct * 100).toFixed(0)}% halt` };
  }
  return { book: next, trade };
}

export interface Decision { side: 'buy' | 'sell'; qty: number; reason: string; }

export function decide(
  mode: StrategyMode,
  symbol: string,
  history: number[],
  book: PaperBook,
  opts: { dcaUsd?: number; gridStep?: number; riskOffDd?: number; peakEquity?: number },
): Decision | null {
  const px = history[history.length - 1] ?? book.prices[symbol];
  if (!px) return null;
  const avg = history.length ? history.reduce((a, b) => a + b, 0) / history.length : px;
  const pos = book.positions[symbol];
  const eq = Math.max(1, equityOf(book));

  if (mode === 'dca') {
    const usd = opts.dcaUsd ?? 250;
    return { side: 'buy', qty: roundQty(usd / px, symbol), reason: `DCA slice $${usd} at ${px.toFixed(4)} (paper)` };
  }
  if (mode === 'grid') {
    const step = opts.gridStep ?? 0.006;
    const anchor = history[0] || px;
    if (px < anchor * (1 - step)) return { side: 'buy', qty: roundQty((eq * 0.02) / px, symbol), reason: `grid buy: ${((px / anchor - 1) * 100).toFixed(2)}% under anchor` };
    if (px > anchor * (1 + step) && pos && pos.qty > 0) return { side: 'sell', qty: roundQty(Math.min(pos.qty, (eq * 0.02) / px), symbol), reason: `grid sell: ${((px / anchor - 1) * 100).toFixed(2)}% over anchor` };
    return null;
  }
  if (mode === 'momentum') {
    if (history.length < 4) return null;
    if (px > avg * 1.002 && book.cashUsd > eq * 0.05) return { side: 'buy', qty: roundQty((eq * 0.03) / px, symbol), reason: `momentum: price above ${history.length}-tick average` };
    if (px < avg * 0.998 && pos && pos.qty > 0) return { side: 'sell', qty: roundQty(pos.qty * 0.25, symbol), reason: 'momentum: price fell through the short average — trimming' };
    return null;
  }
  if (mode === 'mean-reversion') {
    if (history.length < 4) return null;
    if (px < avg * 0.992) return { side: 'buy', qty: roundQty((eq * 0.025) / px, symbol), reason: `mean-reversion buy: ${((px / avg - 1) * 100).toFixed(2)}% vs average` };
    if (px > avg * 1.008 && pos && pos.qty > 0) return { side: 'sell', qty: roundQty(Math.min(pos.qty, (eq * 0.025) / px), symbol), reason: 'mean-reversion sell: stretched above average' };
    return null;
  }
  if (mode === 'risk-off') {
    const peak = opts.peakEquity ?? eq;
    const dd = peak > 0 ? (peak - eq) / peak : 0;
    if (dd >= (opts.riskOffDd ?? 0.03) && pos && pos.qty > 0) {
      return { side: 'sell', qty: roundQty(pos.qty * 0.2, symbol), reason: `risk-off: session drawdown ${(dd * 100).toFixed(1)}% — cutting 20%` };
    }
    return null;
  }
  return null;
}

function roundQty(q: number, symbol: string): number {
  const inst = INSTRUMENTS.find((i) => i.symbol === symbol);
  const dp = inst?.klass === 'fx' ? 2 : inst?.klass === 'crypto' ? 6 : 4;
  const f = 10 ** dp;
  return Math.max(0, Math.round(q * f) / f);
}

export function blotterMarkdown(book: PaperBook): string {
  const lines = [
    '# HarmOS paper blotter',
    '',
    'This is a simulation. No broker, exchange, or bank was contacted. Fills are internal paper fills.',
    '',
    `Cash: $${book.cashUsd.toFixed(2)}`,
    `Equity: $${equityOf(book).toFixed(2)}`,
    `Halted: ${book.halted ? book.haltReason : 'no'}`,
    '',
    '## Trades',
    '',
    '| id | side | symbol | qty | price | mode | source | reason |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...book.trades.slice(0, 40).map((t) => `| ${t.id} | ${t.side} | ${t.symbol} | ${t.qty} | ${t.price.toFixed(4)} | ${t.mode} | ${t.source} | ${t.reason.replace(/\|/g, '/')} |`),
  ];
  return lines.join('\n');
}

/** Best-effort public crypto snapshot. Returns [] on any failure — callers must keep the simulated book. */
export async function fetchPublicCrypto(): Promise<Quote[]> {
  const ids = INSTRUMENTS.filter((i) => i.geckoId).map((i) => i.geckoId).join(',');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`, { signal: ctrl.signal });
    if (!res.ok) return [];
    const data = await res.json() as Record<string, { usd?: number }>;
    const now = Date.now();
    const out: Quote[] = [];
    for (const inst of INSTRUMENTS) {
      const px = inst.geckoId ? data[inst.geckoId]?.usd : undefined;
      if (px && px > 0) out.push({ symbol: inst.symbol, price: px, source: 'public-feed', at: now });
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
