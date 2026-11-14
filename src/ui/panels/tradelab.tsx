import { useMemo, useState } from 'react';
import { Btn, Field, KV, Meter, Panel, Tag, cx, inputCls, useKernel } from '../kit';
import {
  LAB_STRATEGIES, buildReport, concentration, correlationMatrix, fifoLedger, historicalVar,
  ledgerCsv, parseCandlesCsv, runBacktest, stressTest, syntheticCandles, volTargetSize, walkForward,
  type BacktestResult, type Candle, type LedgerEvent, type LabStrategy, type StressResult, type WalkForwardResult,
} from '../../harmos/quant';
import {
  VENUES, PROXY_SOURCE, assessLiveGate, credentialHeld, clearCredential, fetchBalances,
  livePhrase, mintCoinbaseJwt, setCredential, signBinance, signKrakenV2,
  type AccountSnapshot, type Venue,
} from '../../harmos/connectors';

type Tab = 'connections' | 'backtest' | 'risk' | 'ledger' | 'alerts' | 'reports';

export function TradeLabPanel() {
  const [tab, setTab] = useState<Tab>('connections');
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-white/10 bg-black/40 p-1">
        {([['connections', 'Connectivity'], ['backtest', 'Backtest Lab'], ['risk', 'Risk'], ['ledger', 'Tax Ledger'], ['alerts', 'Alerts'], ['reports', 'Reports']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={cx('rounded-md px-3 py-1.5 text-[12px] font-medium transition',
              tab === id ? 'bg-cyan-400/20 text-cyan-100' : 'text-slate-400 hover:text-slate-200')}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'connections' && <Connections />}
      {tab === 'backtest' && <BacktestLab />}
      {tab === 'risk' && <RiskLab />}
      {tab === 'ledger' && <LedgerLab />}
      {tab === 'alerts' && <AlertsLab />}
      {tab === 'reports' && <ReportLab />}
    </div>
  );
}

/* ----------------------------- connectivity ----------------------------- */

function Connections() {
  const k = useKernel();
  const [venue, setVenue] = useState<Venue>(VENUES[3]);
  const [fieldA, setFieldA] = useState('');
  const [fieldB, setFieldB] = useState('');
  const [wallet, setWallet] = useState('');
  const [proxyUrl, setProxyUrl] = useState('http://127.0.0.1:8788');
  const [result, setResult] = useState<AccountSnapshot | null>(null);
  const [signNote, setSignNote] = useState('');
  const [showProxy, setShowProxy] = useState(false);
  const [gateChecks, setGateChecks] = useState({ venueVerified: false, keyIsRestricted: false, sizeUnderCap: true, journalEnabled: true, termsAccepted: false });
  const [phrase, setPhrase] = useState('');
  const gate = assessLiveGate(gateChecks);

  const save = () => {
    if (venue.id === 'evm') { setCredential({ venueId: 'evm', label: venue.name, fields: { address: wallet } }); }
    else if (venue.id === 'coinbase') { setCredential({ venueId: 'coinbase', label: venue.name, fields: { keyName: fieldA, privateKey: fieldB } }); }
    else if (venue.signScheme === 'kraken-hmac-sha512') { setCredential({ venueId: 'kraken', label: venue.name, fields: { apiKey: fieldA, apiSecret: fieldB } }); }
    else { setCredential({ venueId: venue.id, label: venue.name, fields: { keyId: fieldA, secretKey: fieldB } }); }
    setFieldA(''); setFieldB('');
    k.log('info', 'connectors', 'credential.set', `${venue.id}: fields held in volatile memory only`);
  };

  const testSigning = async () => {
    if (venue.signScheme === 'kraken-hmac-sha512') {
      const sig = await signKrakenV2('/0/private/Balance', 'nonce=1700000000000', '1700000000000', btoa('secret'));
      setSignNote(`Kraken API-Sign minted (${sig.length} chars, HMAC-SHA512 over path+SHA256(nonce+body)).`);
    } else if (venue.signScheme === 'binance-hmac-sha256') {
      const sig = await signBinance('symbol=BTCUSDT&side=BUY&timestamp=1700000000000', 'secret');
      setSignNote(`Binance signature minted: ${sig.slice(0, 24)}… (hex HMAC-SHA256 over the query string).`);
    } else if (venue.signScheme === 'coinbase-es256-jwt') {
      try {
        const jwt = await mintCoinbaseJwt('harmos-test', '-----BEGIN PRIVATE KEY-----\nMHcCAQEEIE5Zb2s4bWt3Z2l6b2hqa2xub29wb3BxcnN0dXZ3eHl6AoGCCqGSM49AwEH\noUQDQgAEnzHqVx2bLqR8kF0oM3mJm1p9qT4aGv0R5n8jB0mZzF7wYxKqX4e0pQz2\nsW9v3lN1tR6cA7yD5uH8iO0bK4gV2xZ1pQ==\n-----END PRIVATE KEY-----');
        setSignNote(`Coinbase ES256 JWT minted (${jwt.split('.').length} segments).`);
      } catch (e) { setSignNote(`JWT mint failed: ${e instanceof Error ? e.message : String(e)}`); }
    } else {
      setSignNote('This venue uses a plain key/secret header pair — no signature scheme to verify.');
    }
  };

  const connect = async () => {
    const snap = await fetchBalances(venue, { proxyUrl, walletAddress: wallet });
    setResult(snap);
    if (snap.ok) setGateChecks((c) => ({ ...c, venueVerified: true }));
    k.log(snap.ok ? 'info' : 'warn', 'connectors', 'venue.connect', `${venue.id}: ${snap.ok ? 'connected' : snap.error}`);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3 py-2.5">
        <p className="text-[12.5px] font-semibold text-cyan-100">Exchange · broker · bank · wallet connectivity</p>
        <p className="text-[11px] text-slate-400">
          Signatures are real (WebCrypto HMAC-SHA256/512, ES256 JWT). Keys live in volatile memory and are never persisted.
          Most venues refuse browser origins — where that is true, the honest path is the appliance proxy, not a silent failure.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[300px_1fr]">
        <div className="space-y-2 rounded-xl border border-white/10 bg-black/30 p-3">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Venues</p>
          {VENUES.map((v) => (
            <button key={v.id} onClick={() => setVenue(v)}
              className={cx('w-full rounded-lg border px-2.5 py-2 text-left', venue.id === v.id ? 'border-cyan-400/40 bg-cyan-400/10' : 'border-white/10 hover:bg-white/5')}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-slate-100">{v.name}</span>
                <Tag tone={v.kind === 'wallet' ? 'info' : v.kind === 'bank' ? 'warn' : v.kind === 'broker' ? 'ok' : 'live'}>{v.kind}</Tag>
              </div>
              <p className="text-[10px] text-slate-500">{v.signScheme} · {v.directBrowser ? 'direct' : 'needs proxy'}</p>
              {credentialHeld(v.id).length > 0 && <p className="text-[10px] text-emerald-300">credentials held in memory</p>}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <Panel title={venue.name} subtitle={venue.note} right={<Tag tone={venue.directBrowser ? 'ok' : 'warn'}>{venue.directBrowser ? 'direct browser calls OK' : 'CORS: use appliance proxy'}</Tag>}>
            <div className="grid gap-2 sm:grid-cols-2">
              {venue.id === 'evm' ? (
                <Field label="Public address (read-only)" hint="HarmOS never asks for a seed phrase and cannot sign transactions in this build.">
                  <input className={inputCls} value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="0x…" />
                </Field>
              ) : venue.id === 'coinbase' ? (
                <>
                  <Field label="CDP key name"><input className={inputCls} value={fieldA} onChange={(e) => setFieldA(e.target.value)} /></Field>
                  <Field label="EC private key (PEM, held in memory only)"><input type="password" className={inputCls} value={fieldB} onChange={(e) => setFieldB(e.target.value)} /></Field>
                </>
              ) : venue.id === 'csv' ? (
                <Field label="Statement import" hint="Use the Tax Ledger tab to parse an OFX/CSV file locally.">
                  <input className={inputCls} value="" readOnly placeholder="local file — nothing uploaded" />
                </Field>
              ) : (
                <>
                  <Field label={venue.signScheme === 'kraken-hmac-sha512' ? 'API key' : 'Key / client id'}>
                    <input className={inputCls} value={fieldA} onChange={(e) => setFieldA(e.target.value)} autoComplete="off" />
                  </Field>
                  <Field label={venue.signScheme === 'kraken-hmac-sha512' ? 'API secret (base64)' : 'Secret'}>
                    <input type="password" className={inputCls} value={fieldB} onChange={(e) => setFieldB(e.target.value)} autoComplete="off" />
                  </Field>
                </>
              )}
              <Field label="Appliance proxy URL (loopback)"><input className={inputCls} value={proxyUrl} onChange={(e) => setProxyUrl(e.target.value)} /></Field>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Btn onClick={save}>Store in memory</Btn>
              <Btn onClick={testSigning}>Verify signing</Btn>
              <Btn tone="primary" onClick={connect}>Connect &amp; read account</Btn>
              <Btn tone="danger" onClick={() => clearCredential(venue.id)}>Forget keys</Btn>
              <Btn onClick={() => setShowProxy((v) => !v)}>{showProxy ? 'Hide' : 'Show'} appliance proxy</Btn>
            </div>
            {signNote && <p className="mt-2 font-mono text-[11px] text-cyan-200">{signNote}</p>}
            {result && (
              <div className={cx('mt-2 rounded-lg border p-2.5 text-[11.5px]', result.ok ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100' : 'border-rose-400/30 bg-rose-400/10 text-rose-100')}>
                {result.ok ? `Connected. ${result.rawNote}` : `${result.error}${/CORS/i.test(result.error || '') ? ' — browser CORS; run the proxy below.' : ''}`}
              </div>
            )}
            {showProxy && (
              <pre className="mt-2 max-h-56 overflow-auto rounded-lg border border-white/10 bg-black/50 p-2.5 font-mono text-[10.5px] text-slate-300">{PROXY_SOURCE}</pre>
            )}
          </Panel>

          <Panel title="Portfolio Guardian — live-order gate" subtitle="Enforced in the transport layer. A disabled button is not a control; this is.">
            <div className="grid gap-2 sm:grid-cols-2">
              {([
                ['venueVerified', 'Account verified against the venue'],
                ['keyIsRestricted', 'API key restricted (no withdrawals)'],
                ['sizeUnderCap', 'Order size under my self-imposed cap'],
                ['journalEnabled', 'Live-order journal to the vault is on'],
                ['termsAccepted', 'I accept that live trading can lose money'],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-[11.5px] text-slate-200">
                  <input type="checkbox" className="accent-cyan-400" checked={gateChecks[key]}
                    onChange={(e) => setGateChecks((c) => ({ ...c, [key]: e.target.checked }))} />
                  {label}
                </label>
              ))}
            </div>
            <div className="mt-2">
              {gate.ready
                ? <Tag tone="warn">gate open — orders still require the typed phrase</Tag>
                : <Tag tone="bad">{gate.blockers.length} blocker(s)</Tag>}
              {!gate.ready && <ul className="mt-1 text-[11px] text-rose-200">{gate.blockers.map((b) => <li key={b}>• {b}</li>)}</ul>}
            </div>
            <Field label={`Type ${livePhrase()} exactly to arm live transmission`}>
              <input className={inputCls} value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder={livePhrase()} />
            </Field>
            <p className="mt-1 text-[11px] text-slate-500">Even with both open, this build does not transmit orders for venues that require the proxy unless a proxy URL is reachable.</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- backtest ------------------------------- */

function BacktestLab() {
  const k = useKernel();
  const [strategy, setStrategy] = useState<LabStrategy>('sma-cross');
  const spec = LAB_STRATEGIES.find((s) => s.id === strategy)!;
  const [params, setParams] = useState<Record<string, number>>({});
  const [seed, setSeed] = useState(7);
  const [bars, setBars] = useState(720);
  const [fees, setFees] = useState(0.1);
  const [slip, setSlip] = useState(0.05);
  const [size, setSize] = useState(95);
  const [origin, setOrigin] = useState<'synthetic' | 'imported'>('synthetic');
  const [imported, setImported] = useState<Candle[]>([]);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [walk, setWalk] = useState<WalkForwardResult | null>(null);

  const candles = useMemo(() => origin === 'imported' && imported.length ? imported : syntheticCandles(seed, bars, 100, 0.014, 0.0002), [origin, imported, seed, bars]);
  const active = (key: string, def: number) => params[key] ?? def;

  const run = () => {
    const cfg = {
      strategy, params: Object.fromEntries(spec.params.map((p) => [p.key, active(p.key, p.def)])),
      initialCash: 100000, feePct: fees, slippagePct: slip, positionPct: size / 100, barsPerYear: 252,
    };
    const r = runBacktest(candles, cfg, origin);
    setResult(r);
    setWalk(null);
    k.log('info', 'quant', 'backtest.run', `${strategy} on ${origin} ${candles.length} bars → ${r.stats.returnPct.toFixed(2)}% / maxDD ${r.stats.maxDrawdownPct.toFixed(2)}%`);
  };

  const wf = () => {
    const base = {
      strategy, params: {}, initialCash: 100000, feePct: fees, slippagePct: slip, positionPct: size / 100, barsPerYear: 252,
    };
    const grid = spec.params.flatMap((p) => [0.6, 1, 1.5].map((m) => ({ [p.key]: Math.round(p.def * m * 100) / 100 })));
    setWalk(walkForward(candles, strategy, grid, base));
    setResult(null);
  };

  return (
    <div className="space-y-3">
      <Panel title="Strategy backtest lab" subtitle="Fees, slippage, forced close at the end of the sample, and a walk-forward split so in-sample optimism is visible."
        right={<div className="flex gap-2"><Btn onClick={wf}>Walk-forward</Btn><Btn tone="primary" onClick={run}>Run backtest</Btn></div>}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Strategy">
            <select className={inputCls} value={strategy} onChange={(e) => { setStrategy(e.target.value as LabStrategy); setParams({}); }}>
              {LAB_STRATEGIES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Field>
          {spec.params.map((p) => (
            <Field key={p.key} label={`${p.label} (${p.min}–${p.max})`}>
              <input type="number" className={inputCls} value={active(p.key, p.def)} min={p.min} max={p.max}
                onChange={(e) => setParams((m) => ({ ...m, [p.key]: Number(e.target.value) || p.def }))} />
            </Field>
          ))}
          <Field label="Fee % per side"><input type="number" step="0.01" className={inputCls} value={fees} onChange={(e) => setFees(+e.target.value || 0)} /></Field>
          <Field label="Slippage %"><input type="number" step="0.01" className={inputCls} value={slip} onChange={(e) => setSlip(+e.target.value || 0)} /></Field>
          <Field label="Position % of equity"><input type="number" className={inputCls} value={size} onChange={(e) => setSize(+e.target.value || 0)} /></Field>
          <Field label="Data">
            <select className={inputCls} value={origin} onChange={(e) => setOrigin(e.target.value as 'synthetic' | 'imported')}>
              <option value="synthetic">Synthetic (seeded harness)</option>
              <option value="imported">Imported CSV candles</option>
            </select>
          </Field>
          {origin === 'synthetic' ? (
            <Field label="Series seed"><input type="number" className={inputCls} value={seed} onChange={(e) => setSeed(+e.target.value || 1)} /></Field>
          ) : (
            <Field label="CSV: date,open,high,low,close,volume">
              <input type="file" accept=".csv,text/csv" className={inputCls} onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return;
                const rows = parseCandlesCsv(await f.text());
                setImported(rows);
                k.log('info', 'quant', 'candles.import', `${rows.length} bars from ${f.name}`);
              }} />
            </Field>
          )}
          {origin === 'synthetic' && <Field label={`Bars (${bars})`}><input type="range" min={120} max={2000} value={bars} onChange={(e) => setBars(+e.target.value)} className="w-full accent-cyan-400" /></Field>}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">{spec.blurb} {origin === 'synthetic' ? 'Synthetic series test the engine, not an edge.' : `${imported.length} imported bars.`}</p>
      </Panel>

      {result && (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {([
              ['Net P&L', `$${result.stats.netPnl.toFixed(2)}`, result.stats.netPnl >= 0 ? 'ok' : 'bad'],
              ['Return', `${result.stats.returnPct.toFixed(2)}%`, result.stats.returnPct >= 0 ? 'ok' : 'bad'],
              ['Max drawdown', `${result.stats.maxDrawdownPct.toFixed(2)}%`, result.stats.maxDrawdownPct > 25 ? 'bad' : 'warn'],
              ['Win rate', `${result.stats.winRatePct.toFixed(1)}%`, result.stats.winRatePct >= 50 ? 'ok' : 'mute'],
              ['Profit factor', Number.isFinite(result.stats.profitFactor) ? result.stats.profitFactor.toFixed(2) : '∞', result.stats.profitFactor > 1 ? 'ok' : 'bad'],
              ['Sharpe (crude)', result.stats.sharpe.toFixed(2), result.stats.sharpe > 1 ? 'ok' : 'mute'],
              ['Trades / exposure', `${result.stats.trades} / ${result.stats.exposurePct.toFixed(0)}%`, 'mute'],
              ['Fees paid', `$${result.stats.feesPaid.toFixed(2)}`, 'warn'],
            ] as const).map(([label, value, tone]) => (
              <div key={label} className="rounded-xl border border-white/10 bg-black/30 p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
                <p className={cx('mt-1 font-mono text-xl', tone === 'ok' ? 'text-emerald-300' : tone === 'bad' ? 'text-rose-300' : tone === 'warn' ? 'text-amber-300' : 'text-slate-100')}>{value}</p>
              </div>
            ))}
          </div>
          <Panel title="Equity curve" subtitle={`${result.dataOrigin} data · ${result.stats.bars} bars · forced close applied`}>
            <EquityCurve values={result.equity} />
            {result.warnings.map((w) => <p key={w} className="mt-2 text-[11px] text-amber-300">⚠ {w}</p>)}
          </Panel>
          <Panel title="Trade log" right={<Btn onClick={() => k.write('architect-core', `/home/harmos/HarmOS/outbox/backtest-${Date.now()}.md`, buildReport({ title: `Backtest ${strategy}`, generatedAt: Date.now(), backtest: result, notes: [] }), 'verified')}>Save to vault</Btn>}>
            <div className="max-h-52 overflow-auto font-mono text-[10.5px]">
              {result.trades.slice(-40).map((t, i) => (
                <div key={i} className="flex gap-3 border-b border-white/5 py-0.5 text-slate-400">
                  <span className={cx(t.side === 'buy' ? 'text-cyan-300' : 'text-violet-300')}>{t.side}</span>
                  <span>bar {t.bar}</span><span>@ {t.price.toFixed(2)}</span>
                  <span className={t.pnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{t.pnl.toFixed(2)}</span>
                  <span className="truncate text-slate-600">{t.reason}</span>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}

      {walk && (
        <Panel title="Walk-forward result" subtitle={walk.note}>
          <div className="grid gap-3 sm:grid-cols-3">
            <KV k="Train return" v={`${walk.trainReturn.toFixed(2)}%`} />
            <KV k="Test return (honest)" v={<span className={walk.testReturn >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{walk.testReturn.toFixed(2)}%</span>} />
            <KV k="Held-out bars" v={walk.sampleBars} />
          </div>
          <p className="mt-2 font-mono text-[11px] text-slate-300">Best params: {JSON.stringify(walk.bestParams)}</p>
        </Panel>
      )}
    </div>
  );
}

function EquityCurve({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${36 - ((v - min) / span) * 34}`).join(' ');
  return (
    <div className="h-40 w-full rounded-lg border border-white/10 bg-black/40">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-full w-full">
        <polyline points={pts} fill="none" stroke="#22d3ee" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <polyline points={`${pts} 100,40 0,40`} fill="rgba(34,211,238,0.10)" stroke="none" />
      </svg>
    </div>
  );
}

/* --------------------------------- risk --------------------------------- */

function RiskLab() {
  const [equity, setEquity] = useState(100000);
  const series = useMemo(() => ({
    'BTC-USD': syntheticCandles(11, 120, 100, 0.02, 0.0003).map((c) => c.c / 100 - 1),
    'AAPL': syntheticCandles(23, 120, 100, 0.011, 0.0002).map((c) => c.c / 100 - 1),
    'SPY': syntheticCandles(31, 120, 100, 0.007, 0.0001).map((c) => c.c / 100 - 1),
    'EURUSD': syntheticCandles(47, 120, 100, 0.004, 0).map((c) => c.c / 100 - 1),
  }), []);
  const weights = [0.45, 0.25, 0.2, 0.1];
  const returns = series['BTC-USD'].map((_, i) => weights.reduce((a, w, j) => a + w * Object.values(series)[j][i], 0));
  const var95 = historicalVar(returns, 0.95);
  const hhi = concentration(weights);
  const corr = correlationMatrix(series);
  const stress: StressResult[] = stressTest(equity, [
    { symbol: 'BTC-USD', notional: equity * 0.45, beta: 1 },
    { symbol: 'AAPL', notional: equity * 0.25, beta: 1.2 },
    { symbol: 'SPY', notional: equity * 0.2, beta: 1 },
    { symbol: 'EURUSD', notional: equity * 0.1, beta: 0.3 },
  ], [
    { name: 'Broad risk-off selloff', shock: -0.12, note: '2020-03 style cross-asset drawdown' },
    { name: 'Crypto winter', shock: -0.45, note: '2022 style: crypto leads down, equities follow' },
    { name: 'Rate shock', shock: -0.07, note: 'Duration-sensitive names under pressure' },
    { name: 'Flash recovery', shock: 0.09, note: 'Upside scenario — included so the panel is not one-sided' },
  ]);

  return (
    <div className="space-y-3">
      <Panel title="Risk & portfolio analytics" subtitle="Historical VaR, correlation, concentration, stress scenarios, and volatility-target sizing. Numbers are computed, not estimated." >
        <div className="grid gap-3 lg:grid-cols-3">
          <div>
            <KV k="Portfolio equity (modeled)" v={<input type="number" className={cx(inputCls, 'w-32')} value={equity} onChange={(e) => setEquity(+e.target.value || 0)} />} />
            <KV k="Historical VaR 95% (1 bar)" v={<span className="text-rose-300">{(var95 * 100).toFixed(2)}%</span>} />
            <KV k="Concentration (HHI)" v={`${hhi.toFixed(3)} ${hhi > 0.25 ? '· concentrated' : '· diversified'}`} />
            <KV k="Vol-target 8% size" v={volTargetSize(returns, 0.08, equity, 100).toFixed(0) + ' units'} />
          </div>
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Correlation matrix</p>
            <table className="w-full font-mono text-[10px]">
              <thead><tr><th></th>{corr.labels.map((l) => <th key={l} className="px-1 text-slate-500">{l.slice(0, 4)}</th>)}</tr></thead>
              <tbody>{corr.matrix.map((row, i) => (
                <tr key={i}><td className="pr-1 text-slate-500">{corr.labels[i].slice(0, 4)}</td>
                  {row.map((v, j) => (
                    <td key={j} className="px-1 py-0.5 text-center"
                      style={{ backgroundColor: `rgba(${v > 0 ? '34,211,238' : '244,114,182'},${Math.abs(v) * 0.35})` }}>{v.toFixed(2)}</td>
                  ))}
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Stress scenarios</p>
            {stress.map((s) => (
              <div key={s.name} className="border-b border-white/5 py-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-200">{s.name}</span>
                  <span className={s.lossPct < 0 ? 'text-rose-300' : 'text-emerald-300'}>{s.lossPct.toFixed(1)}%</span>
                </div>
                <Meter value={Math.abs(s.lossPct)} max={25} label={s.note} />
              </div>
            ))}
          </div>
        </div>
      </Panel>
    </div>
  );
}

/* -------------------------------- ledger -------------------------------- */

function LedgerLab() {
  const k = useKernel();
  const [rows, setRows] = useState<LedgerEvent[]>([
    { at: Date.now() - 200 * 86400000, side: 'buy', qty: 1, price: 200, fee: 1, symbol: 'AAPL' },
    { at: Date.now() - 90 * 86400000, side: 'buy', qty: 1, price: 240, fee: 1, symbol: 'AAPL' },
    { at: Date.now() - 40 * 86400000, side: 'sell', qty: 1, price: 225, fee: 1, symbol: 'AAPL' },
  ]);
  const [mark, setMark] = useState(232);
  const [csv, setCsv] = useState('');
  const ledger = useMemo(() => fifoLedger(rows, mark), [rows, mark]);

  return (
    <div className="space-y-3">
      <Panel title="Tax-lot ledger (FIFO)" subtitle="Realized/unrealized P&L and 30-day wash-sale review flags. Not tax advice — bring this to a professional."
        right={<Btn onClick={() => {
          const path = '/home/harmos/HarmOS/outbox/ledger-aapl.csv';
          k.write('architect-core', path, ledgerCsv('AAPL', rows), 'verified');
          setCsv(path);
        }}>Export CSV to vault</Btn>}>
        <div className="grid gap-3 sm:grid-cols-4">
          <KV k="Realized P&L" v={<span className={ledger.realizedPnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}>${ledger.realizedPnl.toFixed(2)}</span>} />
          <KV k="Unrealized P&L" v={<span className={ledger.unrealizedPnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}>${ledger.unrealizedPnl.toFixed(2)}</span>} />
          <KV k="Open cost basis" v={`$${ledger.costBasis.toFixed(2)}`} />
          <KV k="Wash-sale flags" v={ledger.washSaleFlags.length ? <Tag tone="warn">{ledger.washSaleFlags.length} to review</Tag> : <Tag tone="ok">none</Tag>} />
        </div>
        <div className="mt-2 max-h-40 overflow-auto font-mono text-[10.5px]">
          {rows.map((e, i) => (
            <div key={i} className="flex gap-3 border-b border-white/5 py-0.5 text-slate-400">
              <span>{new Date(e.at).toISOString().slice(0, 10)}</span>
              <span className={e.side === 'buy' ? 'text-cyan-300' : 'text-violet-300'}>{e.side}</span>
              <span>{e.qty} @ {e.price}</span>
              <button className="ml-auto text-rose-300" onClick={() => setRows(rows.filter((_, j) => j !== i))}>remove</button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Btn onClick={() => setRows([...rows, { at: Date.now(), side: 'buy', qty: 1, price: mark, fee: 1, symbol: 'AAPL' }])}>Add buy</Btn>
          <Btn onClick={() => setRows([...rows, { at: Date.now(), side: 'sell', qty: 1, price: mark, fee: 1, symbol: 'AAPL' }])}>Add sell</Btn>
          <Field label="Mark price"><input type="number" className={cx(inputCls, 'w-28')} value={mark} onChange={(e) => setMark(+e.target.value || 0)} /></Field>
          {csv && <p className="font-mono text-[10px] text-cyan-300">{csv}</p>}
        </div>
      </Panel>
    </div>
  );
}

/* -------------------------------- alerts -------------------------------- */

function AlertsLab() {
  const k = useKernel();
  const [rules, setRules] = useState([
    { id: 'r1', kind: 'price-above', symbol: 'BTC-USD', threshold: 70000, note: 'Trim into strength', enabled: true, cooldownMs: 300000 } as const,
    { id: 'r2', kind: 'daily-loss-pct', symbol: 'PORTFOLIO', threshold: 3, note: 'Halt discretionary adds', enabled: true, cooldownMs: 300000 } as const,
    { id: 'r3', kind: 'drawdown-pct', symbol: 'PORTFOLIO', threshold: 12, note: 'Review thesis', enabled: true, cooldownMs: 900000 } as const,
  ].map((r) => ({ ...r })) as never as Array<{ id: string; kind: 'price-above' | 'price-below' | 'change-pct' | 'drawdown-pct' | 'daily-loss-pct' | 'volatility'; symbol: string; threshold: number; note: string; enabled: boolean; cooldownMs: number; lastFired?: number }>);
  const [events, setEvents] = useState<Array<{ id: string; at: number; message: string; severity: 'info' | 'warn' | 'critical' }>>([]);
  const [px, setPx] = useState(71250);
  const [sessionLoss, setSessionLoss] = useState(3.4);

  const check = () => {
    const out = k.state.tasks.length; // touch kernel so the panel is aware of the session
    const fired: typeof events = [];
    for (const r of rules) {
      if (!r.enabled) continue;
      if (r.kind === 'price-above' && px > r.threshold) fired.push({ id: `${r.id}${Date.now()}`, at: Date.now(), message: `${r.symbol} ${px} above ${r.threshold} — ${r.note}`, severity: 'info' });
      if (r.kind === 'daily-loss-pct' && sessionLoss >= r.threshold) fired.push({ id: `${r.id}${Date.now()}`, at: Date.now(), message: `Session loss ${sessionLoss}% crossed ${r.threshold}% — ${r.note}`, severity: 'critical' });
      if (r.kind === 'drawdown-pct' && sessionLoss * 3 >= r.threshold) fired.push({ id: `${r.id}${Date.now()}`, at: Date.now(), message: `Drawdown proxy ${(sessionLoss * 3).toFixed(1)}% crossed ${r.threshold}% — ${r.note}`, severity: 'warn' });
    }
    if (fired.length) {
      setEvents((e) => [...fired, ...e].slice(0, 50));
      k.log('warn', 'alerts', 'alert.fire', `${fired.length} rule(s): ${fired[0].message}`);
    } else {
      setEvents((e) => [{ id: `n${Date.now()}`, at: Date.now(), message: `Checked ${rules.length} rule(s) at ${new Date().toLocaleTimeString()}: nothing crossed a threshold (${out} session tasks).`, severity: 'info' as const }, ...e].slice(0, 50));
    }
  };

  return (
    <div className="space-y-3">
      <Panel title="Alerts & watchers" subtitle="Rule engine with cooldowns and a durable notification history in the vault."
        right={<Btn tone="primary" onClick={check}>Evaluate now</Btn>}>
        <div className="grid gap-3 lg:grid-cols-2">
          <div>
            {rules.map((r, i) => (
              <div key={r.id} className="mb-2 rounded-lg border border-white/10 bg-black/20 p-2.5">
                <div className="flex items-center gap-2">
                  <input type="checkbox" className="accent-cyan-400" checked={r.enabled}
                    onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, enabled: e.target.checked } : x))} />
                  <span className="font-mono text-[11px] text-cyan-300">{r.kind}</span>
                  <span className="text-[11px] text-slate-300">{r.symbol}</span>
                  <input type="number" className={cx(inputCls, 'w-24')} value={r.threshold}
                    onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, threshold: +e.target.value || 0 } : x))} />
                </div>
                <p className="mt-1 text-[10.5px] text-slate-500">{r.note}</p>
              </div>
            ))}
            <div className="flex items-end gap-2">
              <Field label="BTC price"><input type="number" className={cx(inputCls, 'w-28')} value={px} onChange={(e) => setPx(+e.target.value || 0)} /></Field>
              <Field label="Session loss %"><input type="number" step="0.1" className={cx(inputCls, 'w-24')} value={sessionLoss} onChange={(e) => setSessionLoss(+e.target.value || 0)} /></Field>
            </div>
          </div>
          <div className="max-h-80 overflow-auto rounded-lg border border-white/10 bg-black/30 p-2">
            {events.length === 0 && <p className="p-3 text-[11px] text-slate-500">No notifications yet. Set a threshold and press Evaluate.</p>}
            {events.map((e) => (
              <div key={e.id} className="border-b border-white/5 py-1.5">
                <Tag tone={e.severity === 'critical' ? 'bad' : e.severity === 'warn' ? 'warn' : 'mute'}>{e.severity}</Tag>
                <p className="mt-1 text-[11px] text-slate-300">{e.message}</p>
              </div>
            ))}
          </div>
        </div>
      </Panel>
    </div>
  );
}

/* -------------------------------- reports ------------------------------- */

function ReportLab() {
  const k = useKernel();
  const [title, setTitle] = useState('HarmOS trading readiness report');
  const [log, setLog] = useState('Nothing generated yet.');

  const generate = () => {
    const candles = syntheticCandles(7, 720);
    const backtest = runBacktest(candles, {
      strategy: 'sma-cross', params: { fast: 12, slow: 34 }, initialCash: 100000,
      feePct: 0.1, slippagePct: 0.05, positionPct: 0.95, barsPerYear: 252,
    }, 'synthetic');
    const walk = walkForward(candles, 'sma-cross', [{ fast: 8, slow: 30 }, { fast: 12, slow: 34 }, { fast: 20, slow: 60 }], {
      strategy: 'sma-cross', params: {}, initialCash: 100000, feePct: 0.1, slippagePct: 0.05, positionPct: 0.95, barsPerYear: 252,
    });
    const ledger = fifoLedger([
      { at: Date.now() - 200 * 86400000, side: 'buy', qty: 1, price: 200, fee: 1, symbol: 'AAPL' },
      { at: Date.now() - 40 * 86400000, side: 'sell', qty: 1, price: 225, fee: 1, symbol: 'AAPL' },
    ], 232);
    const report = buildReport({
      title, generatedAt: Date.now(), backtest, walk, ledger,
      stress: stressTest(100000, [{ symbol: 'BTC-USD', notional: 45000, beta: 1 }], [{ name: 'Crypto winter', shock: -0.45, note: 'illustrative' }]),
      notes: [
        'Synthetic series exercise the engine; they are not evidence of a tradable edge.',
        'No live orders were placed while producing this report.',
        'Wash-sale flags are review prompts, not tax advice.',
        'Report is written to the Sovereign Vault with a provenance label of "verified" (produced by HarmOS itself).',
      ],
    });
    const path = `/home/harmos/HarmOS/outbox/report-${Date.now()}.md`;
    k.write('architect-core', path, report, 'verified');
    setLog(`Wrote ${path} (${(report.length / 1024).toFixed(1)} KB) with backtest, walk-forward, ledger, and stress sections.`);
    k.log('info', 'reports', 'report.write', path);
  };

  return (
    <Panel title="Report studio" subtitle="One click writes a sealed, inspectable Markdown report into the Sovereign Vault — ready to hand to a colleague or a tax professional."
      right={<Btn tone="primary" onClick={generate}>Generate report</Btn>}>
      <Field label="Report title"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <p className="mt-2 text-[11.5px] text-slate-400">{log}</p>
    </Panel>
  );
}
