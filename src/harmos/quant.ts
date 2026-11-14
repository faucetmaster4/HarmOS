/* HarmOS Quant Lab — backtesting, risk, tax-lot ledger, alerts, and reporting.
 * All math is real and deterministic. Synthetic series are labeled synthetic; imported
 * candles are labeled imported. Nothing here is a prediction and nothing is financial advice.
 */

export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number; }

/* ------------------------------ market data ------------------------------ */

/** Deterministic geometric-brownian-style series with slow regime shifts. Labeled synthetic. */
export function syntheticCandles(seed: number, count: number, start = 100, vol = 0.012, drift = 0.0002): Candle[] {
  let state = (seed >>> 0) || 1;
  const rnd = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0xffffffff; };
  const out: Candle[] = [];
  let price = start;
  const t0 = Date.UTC(2024, 0, 1);
  for (let i = 0; i < count; i++) {
    const regime = Math.sin(i / 90 + seed % 7) * 0.0006;
    const shock = (rnd() + rnd() + rnd() - 1.5) * 2 * vol;
    const o = price;
    const c = Math.max(0.01, o * (1 + shock + drift + regime));
    const h = Math.max(o, c) * (1 + rnd() * vol * 0.6);
    const l = Math.min(o, c) * (1 - rnd() * vol * 0.6);
    out.push({ t: t0 + i * 86400000, o, h, l, c, v: 1000 + rnd() * 9000 });
    price = c;
  }
  return out;
}

export function parseCandlesCsv(text: string): Candle[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const out: Candle[] = [];
  const start = /date|time|t[,;]/i.test(lines[0] || '') ? 1 : 0;
  for (let i = start; i < lines.length; i++) {
    const p = lines[i].split(/[,;\t]/).map((x) => x.trim());
    if (p.length < 5) continue;
    const [d, o, h, l, c, v] = p;
    const nums = [o, h, l, c].map(Number);
    if (nums.some((n) => !Number.isFinite(n))) continue;
    out.push({ t: Date.parse(d) || i * 86400000, o: nums[0], h: nums[1], l: nums[2], c: nums[3], v: Number(v) || 0 });
  }
  return out;
}

/* ------------------------------- strategies ------------------------------ */

export interface Signal { side: 'buy' | 'sell' | 'flat'; sizePct: number; reason: string; }

export type LabStrategy = 'sma-cross' | 'momentum' | 'mean-reversion' | 'breakout' | 'grid' | 'dca' | 'rsi-reversion';

export const LAB_STRATEGIES: Array<{ id: LabStrategy; label: string; blurb: string; params: Array<{ key: string; label: string; def: number; min: number; max: number }> }> = [
  { id: 'sma-cross', label: 'SMA cross', blurb: 'Fast average over slow average: long when above, flat when below.', params: [{ key: 'fast', label: 'Fast window', def: 12, min: 2, max: 80 }, { key: 'slow', label: 'Slow window', def: 34, min: 5, max: 200 }] },
  { id: 'momentum', label: 'Momentum', blurb: 'Long when the close is above its N-bar average, trimmed below it.', params: [{ key: 'lookback', label: 'Lookback', def: 20, min: 3, max: 120 }, { key: 'thresh', label: 'Threshold %', def: 0.2, min: 0, max: 5 }] },
  { id: 'mean-reversion', label: 'Mean reversion', blurb: 'Fades stretch away from the average. Fails in trends — that is what drawdown reporting is for.', params: [{ key: 'lookback', label: 'Lookback', def: 20, min: 3, max: 120 }, { key: 'entry', label: 'Entry dev %', def: 1.5, min: 0.2, max: 10 }] },
  { id: 'breakout', label: 'Breakout', blurb: 'Enters on an N-bar high, exits on an N-bar low.', params: [{ key: 'entry', label: 'Entry bars', def: 20, min: 3, max: 120 }, { key: 'exit', label: 'Exit bars', def: 10, min: 2, max: 120 }] },
  { id: 'grid', label: 'Grid', blurb: 'Buys a step down, sells a step up around an anchor.', params: [{ key: 'step', label: 'Step %', def: 1.2, min: 0.2, max: 8 }, { key: 'slices', label: 'Slices', def: 6, min: 2, max: 20 }] },
  { id: 'dca', label: 'DCA', blurb: 'Fixed notional every K bars regardless of price.', params: [{ key: 'every', label: 'Every K bars', def: 5, min: 1, max: 60 }, { key: 'notional', label: 'Notional %', def: 4, min: 1, max: 25 }] },
  { id: 'rsi-reversion', label: 'RSI reversion', blurb: 'Buys oversold RSI, sells overbought RSI. A real oscillator, not a black box.', params: [{ key: 'period', label: 'RSI period', def: 14, min: 2, max: 40 }, { key: 'low', label: 'Oversold', def: 30, min: 5, max: 45 }, { key: 'high', label: 'Overbought', def: 70, min: 55, max: 95 }] },
];

function sma(vals: number[], end: number, n: number): number {
  const s = Math.max(0, end - n + 1);
  const slice = vals.slice(s, end + 1);
  return slice.reduce((a, b) => a + b, 0) / Math.max(1, slice.length);
}

function rsi(vals: number[], end: number, n: number): number {
  if (end < n) return 50;
  let up = 0, down = 0;
  for (let i = end - n + 1; i <= end; i++) {
    const d = vals[i] - vals[i - 1];
    if (d > 0) up += d; else down -= d;
  }
  if (down === 0) return 100;
  const rs = up / n / (down / n);
  return 100 - 100 / (1 + rs);
}

export function signalFor(strategy: LabStrategy, closes: number[], i: number, params: Record<string, number>, positionPct: number): Signal {
  const c = closes[i];
  switch (strategy) {
    case 'sma-cross': {
      const fast = sma(closes, i, params.fast);
      const slow = sma(closes, i, params.slow);
      if (i < params.slow) return { side: 'flat', sizePct: 0, reason: 'warming up' };
      return fast > slow
        ? { side: positionPct > 0.02 ? 'flat' : 'buy', sizePct: 1, reason: `fast ${fast.toFixed(2)} > slow ${slow.toFixed(2)}` }
        : { side: positionPct > 0.02 ? 'sell' : 'flat', sizePct: 1, reason: `fast ${fast.toFixed(2)} <= slow ${slow.toFixed(2)}` };
    }
    case 'momentum': {
      const avg = sma(closes, i, params.lookback);
      const dev = ((c / avg) - 1) * 100;
      if (dev > params.thresh) return { side: positionPct > 0.02 ? 'flat' : 'buy', sizePct: 1, reason: `+${dev.toFixed(2)}% vs ${params.lookback}-bar mean` };
      if (dev < -params.thresh) return { side: positionPct > 0.02 ? 'sell' : 'flat', sizePct: 1, reason: `${dev.toFixed(2)}% vs mean` };
      return { side: 'flat', sizePct: 0, reason: 'inside threshold' };
    }
    case 'mean-reversion': {
      const avg = sma(closes, i, params.lookback);
      const dev = ((c / avg) - 1) * 100;
      if (dev < -params.entry) return { side: positionPct > 0.02 ? 'flat' : 'buy', sizePct: 1, reason: `stretched ${dev.toFixed(2)}% below mean` };
      if (dev > params.entry) return { side: positionPct > 0.02 ? 'sell' : 'flat', sizePct: 1, reason: `stretched +${dev.toFixed(2)}% above mean` };
      return { side: 'flat', sizePct: 0, reason: 'not stretched enough' };
    }
    case 'breakout': {
      const hi = Math.max(...closes.slice(Math.max(0, i - params.entry), i));
      const lo = Math.min(...closes.slice(Math.max(0, i - params.exit), i));
      if (c > hi) return { side: positionPct > 0.02 ? 'flat' : 'buy', sizePct: 1, reason: `close above ${params.entry}-bar high` };
      if (c < lo) return { side: positionPct > 0.02 ? 'sell' : 'flat', sizePct: 1, reason: `close below ${params.exit}-bar low` };
      return { side: 'flat', sizePct: 0, reason: 'inside range' };
    }
    case 'grid': {
      const anchor = closes[0];
      const step = params.step / 100;
      const level = Math.floor((c / anchor - 1) / step);
      if (level < 0 && positionPct < 1) return { side: 'buy', sizePct: 1 / params.slices, reason: `grid level ${level}` };
      if (level > 0 && positionPct > 0) return { side: 'sell', sizePct: 1 / params.slices, reason: `grid level ${level}` };
      return { side: 'flat', sizePct: 0, reason: 'between grid levels' };
    }
    case 'dca': {
      if (i % params.every === 0) return { side: 'buy', sizePct: params.notional / 100, reason: `DCA bar ${i}` };
      return { side: 'flat', sizePct: 0, reason: 'waiting for next DCA bar' };
    }
    case 'rsi-reversion': {
      const r = rsi(closes, i, params.period);
      if (r < params.low) return { side: positionPct > 0.02 ? 'flat' : 'buy', sizePct: 1, reason: `RSI ${r.toFixed(1)} oversold` };
      if (r > params.high) return { side: positionPct > 0.02 ? 'sell' : 'flat', sizePct: 1, reason: `RSI ${r.toFixed(1)} overbought` };
      return { side: 'flat', sizePct: 0, reason: `RSI ${r.toFixed(1)} neutral` };
    }
  }
}

/* -------------------------------- backtest ------------------------------- */

export interface BacktestTrade { bar: number; at: number; side: 'buy' | 'sell'; price: number; qty: number; pnl: number; reason: string; }

export interface BacktestStats {
  bars: number;
  startEquity: number;
  endEquity: number;
  netPnl: number;
  returnPct: number;
  cagrPct: number;
  maxDrawdownPct: number;
  maxDrawdownBars: number;
  winRatePct: number;
  profitFactor: number;
  sharpe: number;
  trades: number;
  exposurePct: number;
  avgHoldBars: number;
  feesPaid: number;
  bestTrade: number;
  worstTrade: number;
}

export interface BacktestResult {
  stats: BacktestStats;
  equity: number[];
  trades: BacktestTrade[];
  dataOrigin: 'synthetic' | 'imported';
  warnings: string[];
}

export interface BacktestConfig {
  strategy: LabStrategy;
  params: Record<string, number>;
  initialCash: number;
  feePct: number;
  slippagePct: number;
  positionPct: number;
  barsPerYear: number;
}

export function runBacktest(candles: Candle[], cfg: BacktestConfig, dataOrigin: 'synthetic' | 'imported' = 'synthetic'): BacktestResult {
  const warnings: string[] = [];
  if (candles.length < 30) warnings.push('Fewer than 30 bars — statistics here will be noise.');
  const closes = candles.map((c) => c.c);
  let cash = cfg.initialCash;
  let qty = 0;
  let entryPrice = 0;
  let entryBar = 0;
  let feesPaid = 0;
  let exposureBars = 0;
  const trades: BacktestTrade[] = [];
  const equity: number[] = [];
  const holdBars: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    const px = candles[i].c;
    const posPct = (qty * px) / Math.max(1, cash + qty * px);
    const sig = signalFor(cfg.strategy, closes, i, cfg.params, posPct);
    const slip = 1 + cfg.slippagePct / 100 * (sig.side === 'buy' ? 1 : -1);
    const fill = px * slip;

    if (sig.side === 'buy' && sig.sizePct > 0) {
      const equityNow = cash + qty * px;
      const notional = equityNow * cfg.positionPct * sig.sizePct;
      const fee = notional * (cfg.feePct / 100);
      const bought = (notional - fee) / fill;
      if (bought > 0 && notional <= cash + 1e-6) {
        cash -= notional;
        feesPaid += fee;
        if (qty === 0) { entryPrice = fill; entryBar = i; }
        qty += bought;
        trades.push({ bar: i, at: candles[i].t, side: 'buy', price: fill, qty: bought, pnl: -fee, reason: sig.reason });
      }
    } else if (sig.side === 'sell' && qty > 0) {
      const sellQty = Math.min(qty, qty * (sig.sizePct >= 1 ? 1 : sig.sizePct));
      const proceeds = sellQty * fill;
      const fee = proceeds * (cfg.feePct / 100);
      const pnl = (fill - entryPrice) * sellQty - fee;
      cash += proceeds - fee;
      feesPaid += fee;
      qty -= sellQty;
      holdBars.push(i - entryBar);
      trades.push({ bar: i, at: candles[i].t, side: 'sell', price: fill, qty: sellQty, pnl, reason: sig.reason });
      if (qty <= 1e-9) { qty = 0; entryPrice = 0; }
    }

    if (qty > 0) exposureBars++;
    equity.push(cash + qty * px);
  }

  // Close any open position at the last bar so the report is not flattering itself.
  if (qty > 0) {
    const last = candles[candles.length - 1];
    const fee = qty * last.c * (cfg.feePct / 100);
    cash += qty * last.c - fee;
    feesPaid += fee;
    trades.push({ bar: candles.length - 1, at: last.t, side: 'sell', price: last.c, qty, pnl: (last.c - entryPrice) * qty - fee, reason: 'forced close at end of sample' });
    holdBars.push(candles.length - 1 - entryBar);
    qty = 0;
    equity[equity.length - 1] = cash;
  }

  let peak = equity[0] ?? cfg.initialCash;
  let maxDd = 0;
  let ddBars = 0;
  let runDd = 0;
  for (const e of equity) {
    if (e > peak) { peak = e; runDd = 0; }
    const dd = (peak - e) / peak;
    if (dd > maxDd) maxDd = dd;
    if (dd > 0) { runDd++; ddBars = Math.max(ddBars, runDd); }
  }

  const returns: number[] = [];
  for (let i = 1; i < equity.length; i++) returns.push((equity[i] - equity[i - 1]) / Math.max(1, equity[i - 1]));
  const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const sd = returns.length > 1 ? Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1)) : 0;
  const closesOnly = trades.filter((t) => t.side === 'sell');
  const wins = closesOnly.filter((t) => t.pnl > 0);
  const gross = wins.reduce((a, t) => a + t.pnl, 0);
  const losses = Math.abs(closesOnly.filter((t) => t.pnl <= 0).reduce((a, t) => a + t.pnl, 0));
  const endEquity = equity[equity.length - 1] ?? cfg.initialCash;
  const years = Math.max(0.05, candles.length / Math.max(1, cfg.barsPerYear));

  return {
    equity, trades, dataOrigin,
    stats: {
      bars: candles.length,
      startEquity: cfg.initialCash,
      endEquity,
      netPnl: endEquity - cfg.initialCash,
      returnPct: ((endEquity / cfg.initialCash) - 1) * 100,
      cagrPct: ((endEquity / cfg.initialCash) ** (1 / years) - 1) * 100,
      maxDrawdownPct: maxDd * 100,
      maxDrawdownBars: ddBars,
      winRatePct: closesOnly.length ? (wins.length / closesOnly.length) * 100 : 0,
      profitFactor: losses > 0 ? gross / losses : gross > 0 ? Infinity : 0,
      sharpe: sd > 0 ? (mean / sd) * Math.sqrt(Math.max(1, cfg.barsPerYear)) : 0,
      trades: trades.length,
      exposurePct: candles.length ? (exposureBars / candles.length) * 100 : 0,
      avgHoldBars: holdBars.length ? holdBars.reduce((a, b) => a + b, 0) / holdBars.length : 0,
      feesPaid,
      bestTrade: closesOnly.length ? Math.max(...closesOnly.map((t) => t.pnl)) : 0,
      worstTrade: closesOnly.length ? Math.min(...closesOnly.map((t) => t.pnl)) : 0,
    },
    warnings,
  };
}

/* ------------------------------ walk-forward ----------------------------- */

export interface WalkForwardResult {
  bestParams: Record<string, number>;
  trainReturn: number;
  testReturn: number;
  sampleBars: number;
  note: string;
}

/** Honest research: pick parameters on the training window only, then report the
 *  untouched test window. The test number is the one you should believe. */
export function walkForward(
  candles: Candle[],
  strategy: LabStrategy,
  paramGrid: Array<Record<string, number>>,
  base: BacktestConfig,
  trainRatio = 0.6,
): WalkForwardResult {
  const split = Math.floor(candles.length * trainRatio);
  const train = candles.slice(0, split);
  const test = candles.slice(split);
  let best: Record<string, number> = paramGrid[0] || {};
  let bestTrain = -Infinity;
  for (const p of paramGrid) {
    const r = runBacktest(train, { ...base, strategy, params: p });
    if (r.stats.netPnl > bestTrain) { bestTrain = r.stats.netPnl; best = p; }
  }
  const trainRun = runBacktest(train, { ...base, strategy, params: best });
  const testRun = runBacktest(test, { ...base, strategy, params: best });
  return {
    bestParams: best,
    trainReturn: trainRun.stats.returnPct,
    testReturn: testRun.stats.returnPct,
    sampleBars: test.length,
    note: 'Parameters chosen on the train window only. In-sample results are optimism; the test window is the honest number.',
  };
}

/* ---------------------------------- risk --------------------------------- */

export function historicalVar(returns: number[], confidence = 0.95): number {
  if (!returns.length) return 0;
  const sorted = [...returns].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((1 - confidence) * sorted.length));
  return sorted[idx];
}

export function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const ma = a.slice(0, n).reduce((x, y) => x + y, 0) / n;
  const mb = b.slice(0, n).reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

export function correlationMatrix(series: Record<string, number[]>): { labels: string[]; matrix: number[][] } {
  const labels = Object.keys(series);
  const matrix = labels.map((l1) => labels.map((l2) => correlation(series[l1] || [], series[l2] || [])));
  return { labels, matrix };
}

export function concentration(weights: number[]): number {
  return weights.reduce((a, w) => a + w * w, 0);
}

export interface StressResult { name: string; shock: number; equityAfter: number; lossPct: number; note: string; }

export function stressTest(equity: number, positions: Array<{ symbol: string; notional: number; beta: number }>, scenarios: Array<{ name: string; shock: number; note: string }>): StressResult[] {
  return scenarios.map((s) => {
    const impact = positions.reduce((sum, p) => sum + p.notional * s.shock * p.beta, 0);
    const after = equity + impact;
    return { name: s.name, shock: s.shock, equityAfter: after, lossPct: ((after - equity) / Math.max(1, equity)) * 100, note: s.note };
  });
}

export function volTargetSize(returns: number[], targetVol: number, equity: number, price: number): number {
  const mean = returns.reduce((a, b) => a + b, 0) / Math.max(1, returns.length);
  const sd = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, returns.length - 1));
  if (sd <= 0 || price <= 0) return 0;
  const scaled = (targetVol / sd) * equity;
  return Math.max(0, scaled / price);
}

/* --------------------------------- ledger -------------------------------- */

export interface LedgerEvent { at: number; side: 'buy' | 'sell'; qty: number; price: number; fee: number; symbol: string; }

export interface Lot { at: number; qty: number; price: number; fee: number; }

export interface LedgerResult {
  lots: Lot[];
  realizedPnl: number;
  unrealizedPnl: number;
  costBasis: number;
  marketValue: number;
  washSaleFlags: Array<{ sellAt: number; rebuyAt: number; note: string }>;
}

/** FIFO cost basis — the method most tax authorities default to. Simplified wash-sale
 *  detection (repurchase within 30 days of a loss) is reported as a *flag to review*, not
 *  as tax advice. */
export function fifoLedger(events: LedgerEvent[], markPrice: number): LedgerResult {
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const lots: Lot[] = [];
  let realized = 0;
  const washSaleFlags: LedgerResult['washSaleFlags'] = [];
  const lossSales: Array<{ at: number; qty: number }> = [];

  for (const e of sorted) {
    if (e.side === 'buy') {
      lots.push({ at: e.at, qty: e.qty, price: e.price, fee: e.fee });
      for (const ls of lossSales) {
        if (e.at - ls.at <= 30 * 86400000 && e.at >= ls.at) {
          washSaleFlags.push({ sellAt: ls.at, rebuyAt: e.at, note: 'Repurchase within 30 days of a loss sale — review with a tax adviser.' });
        }
      }
    } else {
      let remaining = e.qty;
      while (remaining > 1e-9 && lots.length) {
        const lot = lots[0];
        const take = Math.min(lot.qty, remaining);
        const pnl = (e.price - lot.price) * take - lot.fee * (take / e.qty);
        realized += pnl;
        if (pnl < 0) lossSales.push({ at: e.at, qty: take });
        lot.qty -= take;
        remaining -= take;
        if (lot.qty <= 1e-9) lots.shift();
      }
    }
  }

  const costBasis = lots.reduce((a, l) => a + l.qty * l.price + l.fee, 0);
  const qty = lots.reduce((a, l) => a + l.qty, 0);
  return {
    lots, realizedPnl: realized, costBasis, marketValue: qty * markPrice,
    unrealizedPnl: qty * markPrice - costBasis, washSaleFlags,
  };
}

export function ledgerCsv(symbol: string, events: LedgerEvent[]): string {
  return ['date,symbol,side,qty,price,fee,notional',
    ...events.map((e) => `${new Date(e.at).toISOString().slice(0, 10)},${symbol},${e.side},${e.qty},${e.price.toFixed(4)},${e.fee.toFixed(4)},${(e.qty * e.price).toFixed(4)}`),
  ].join('\n');
}

/* --------------------------------- alerts -------------------------------- */

export type AlertKind = 'price-above' | 'price-below' | 'change-pct' | 'drawdown-pct' | 'daily-loss-pct' | 'volatility';

export interface AlertRule {
  id: string;
  kind: AlertKind;
  symbol: string;
  threshold: number;
  note: string;
  enabled: boolean;
  cooldownMs: number;
  lastFired?: number;
}

export interface AlertEvent { id: string; at: number; ruleId: string; symbol: string; message: string; severity: 'info' | 'warn' | 'critical'; }

export function evaluateAlerts(rules: AlertRule[], quotes: Record<string, number>, ctx: { equity: number; dayStartEquity: number; maxDrawdownPct: number; volatility: number }, now = Date.now()): { events: AlertEvent[]; rules: AlertRule[] } {
  const events: AlertEvent[] = [];
  const next = rules.map((r) => {
    if (!r.enabled) return r;
    if (r.lastFired && now - r.lastFired < r.cooldownMs) return r;
    const px = quotes[r.symbol];
    let fire = false;
    let message = '';
    let severity: AlertEvent['severity'] = 'info';

    if (r.kind === 'price-above' && px !== undefined && px > r.threshold) { fire = true; message = `${r.symbol} at ${px.toFixed(2)} is above ${r.threshold}`; }
    if (r.kind === 'price-below' && px !== undefined && px < r.threshold) { fire = true; message = `${r.symbol} at ${px.toFixed(2)} is below ${r.threshold}`; severity = 'warn'; }
    if (r.kind === 'change-pct' && px !== undefined) {
      const change = ((px / r.threshold) - 1) * 100;
      if (Math.abs(change) >= 1) { fire = true; message = `${r.symbol} moved ${change.toFixed(2)}% from ${r.threshold}`; severity = 'warn'; }
    }
    if (r.kind === 'drawdown-pct' && ctx.maxDrawdownPct >= r.threshold) { fire = true; message = `Drawdown ${ctx.maxDrawdownPct.toFixed(2)}% crossed ${r.threshold}%`; severity = 'critical'; }
    if (r.kind === 'daily-loss-pct') {
      const loss = ctx.dayStartEquity > 0 ? ((ctx.dayStartEquity - ctx.equity) / ctx.dayStartEquity) * 100 : 0;
      if (loss >= r.threshold) { fire = true; message = `Session loss ${loss.toFixed(2)}% crossed ${r.threshold}%`; severity = 'critical'; }
    }
    if (r.kind === 'volatility' && ctx.volatility >= r.threshold) { fire = true; message = `Volatility ${ctx.volatility.toFixed(3)} above ${r.threshold}`; severity = 'warn'; }

    if (!fire) return r;
    events.push({ id: `a${now}${r.id}`, at: now, ruleId: r.id, symbol: r.symbol, message: `${message}${r.note ? ` — ${r.note}` : ''}`, severity });
    return { ...r, lastFired: now };
  });
  return { events, rules: next };
}

/* -------------------------------- reporting ------------------------------ */

export function buildReport(input: {
  title: string;
  generatedAt: number;
  backtest?: BacktestResult;
  walk?: WalkForwardResult;
  ledger?: LedgerResult;
  statements?: number;
  stress?: StressResult[];
  notes: string[];
}): string {
  const lines: string[] = [
    `# ${input.title}`,
    '',
    `Generated by HarmOS at ${new Date(input.generatedAt).toISOString()}.`,
    '',
    '> Not financial advice. Past results on synthetic or historical data do not describe future returns.',
  ];
  if (input.backtest) {
    const s = input.backtest.stats;
    lines.push('', '## Backtest', '',
      `Data origin: **${input.backtest.dataOrigin}** (synthetic series are a test harness, not evidence of an edge).`,
      '', '| metric | value |', '| --- | --- |',
      `| bars | ${s.bars} |`,
      `| net P&L | $${s.netPnl.toFixed(2)} (${s.returnPct.toFixed(2)}%) |`,
      `| CAGR | ${s.cagrPct.toFixed(2)}% |`,
      `| max drawdown | ${s.maxDrawdownPct.toFixed(2)}% over ${s.maxDrawdownBars} bars |`,
      `| win rate | ${s.winRatePct.toFixed(1)}% |`,
      `| profit factor | ${Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'} |`,
      `| Sharpe (annualised, crude) | ${s.sharpe.toFixed(2)} |`,
      `| trades | ${s.trades} |`,
      `| exposure | ${s.exposurePct.toFixed(1)}% |`,
      `| fees paid | $${s.feesPaid.toFixed(2)} |`,
    );
    if (input.backtest.warnings.length) lines.push('', ...input.backtest.warnings.map((w) => `- Warning: ${w}`));
  }
  if (input.walk) {
    lines.push('', '## Walk-forward', '',
      `- Train return: ${input.walk.trainReturn.toFixed(2)}%`,
      `- Test return (honest): **${input.walk.testReturn.toFixed(2)}%**`,
      `- Bars held out: ${input.walk.sampleBars}`,
      `- ${input.walk.note}`);
  }
  if (input.ledger) {
    lines.push('', '## Tax-lot ledger (FIFO)', '',
      `- Realized P&L: $${input.ledger.realizedPnl.toFixed(2)}`,
      `- Unrealized P&L: $${input.ledger.unrealizedPnl.toFixed(2)}`,
      `- Cost basis open: $${input.ledger.costBasis.toFixed(2)}`,
      `- Open lots: ${input.ledger.lots.length}`,
      `- Wash-sale review flags: ${input.ledger.washSaleFlags.length}`);
  }
  if (input.stress?.length) {
    lines.push('', '## Stress scenarios', '', '| scenario | shock | equity after | loss % |', '| --- | --- | --- | --- |',
      ...input.stress.map((s) => `| ${s.name} | ${(s.shock * 100).toFixed(0)}% | $${s.equityAfter.toFixed(0)} | ${s.lossPct.toFixed(2)}% |`));
  }
  if (input.notes.length) lines.push('', '## Notes', '', ...input.notes.map((n) => `- ${n}`));
  return lines.join('\n');
}
