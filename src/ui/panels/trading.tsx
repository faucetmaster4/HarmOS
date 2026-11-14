import { useEffect, useMemo, useRef, useState } from 'react';
import { Btn, Field, KV, Meter, Tag, cx, inputCls, useKernel } from '../kit';
import {
  DEFAULT_LIMITS, INSTRUMENTS, STRATEGY_META,
  applyQuotes, blotterMarkdown, createBook, decide, equityOf, fetchPublicCrypto,
  paperFill, simulatedPrice, unrealized,
  type PaperBook, type QuoteSource, type StrategyMode,
} from '../../harmos/trading';

const CLASS_TONE: Record<string, string> = { crypto: 'live', equity: 'info', fx: 'warn', commodity: 'ok' };

export function TradingDesk() {
  const k = useKernel();
  const [book, setBook] = useState<PaperBook>(() => createBook());
  const [symbol, setSymbol] = useState('BTC-USD');
  const [mode, setMode] = useState<StrategyMode>('manual');
  const [qty, setQty] = useState('0.01');
  const [armed, setArmed] = useState(false);
  const [dcaUsd, setDcaUsd] = useState(250);
  const [note, setNote] = useState('Paper desk ready. No broker is connected.');
  const [feedNote, setFeedNote] = useState('Quotes are simulated until a public crypto feed answers.');
  const hist = useRef<Record<string, number[]>>({});
  const peak = useRef(100000);
  const tick = useRef(0);
  const bookRef = useRef(book);
  bookRef.current = book;

  useEffect(() => {
    let stop = false;
    const pull = async () => {
      const quotes = await fetchPublicCrypto();
      if (stop || !quotes.length) return;
      setBook((b) => applyQuotes(b, quotes));
      setFeedNote(`Public crypto snapshot applied (${quotes.length} symbols). Equities, FX, and gold remain simulated — this build has no brokerage feed.`);
    };
    void pull();
    const id = window.setInterval(() => void pull(), 60000);
    return () => { stop = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      tick.current += 1;
      const t = tick.current;
      setBook((prev) => {
        const quotes = INSTRUMENTS.map((inst) => ({
          symbol: inst.symbol,
          price: prev.sources[inst.symbol] === 'public-feed' ? prev.prices[inst.symbol] : simulatedPrice(inst.symbol, t),
          source: (prev.sources[inst.symbol] || 'simulated') as QuoteSource,
          at: Date.now(),
        }));
        // Keep a little motion on public-feed symbols so the chart is not a flat line between polls.
        for (const q of quotes) {
          if (q.source === 'public-feed') q.price = q.price * (1 + Math.sin(t / 9 + q.symbol.length) * 0.0004);
        }
        const next = applyQuotes(prev, quotes);
        for (const inst of INSTRUMENTS) {
          const arr = hist.current[inst.symbol] || [];
          arr.push(next.prices[inst.symbol]);
          hist.current[inst.symbol] = arr.slice(-80);
        }
        const eq = equityOf(next);
        if (eq > peak.current) peak.current = eq;
        return next;
      });
    }, 1200);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!armed || mode === 'manual') return;
    const id = window.setInterval(() => {
      const b = bookRef.current;
      if (b.halted) { setArmed(false); setNote(b.haltReason); return; }
      const history = hist.current[symbol] || [];
      const decision = decide(mode, symbol, history, b, { dcaUsd, peakEquity: peak.current });
      if (!decision) return;
      const res = paperFill(b, { ...decision, symbol, mode });
      setBook(res.book);
      setNote(res.error || res.trade?.reason || 'no fill');
      if (res.trade) k.log('info', 'paper-desk', 'paper.fill', `${res.trade.side} ${res.trade.qty} ${res.trade.symbol} @ ${res.trade.price.toFixed(4)} (${res.trade.mode})`);
    }, 2400);
    return () => clearInterval(id);
  }, [armed, mode, symbol, dcaUsd, k]);

  const series = hist.current[symbol] || [book.prices[symbol]];
  const eq = equityOf(book);
  const dayPnl = eq - book.dayStartEquity;
  const inst = INSTRUMENTS.find((i) => i.symbol === symbol)!;

  const manual = (side: 'buy' | 'sell') => {
    const q = Number(qty);
    const res = paperFill(book, { symbol, side, qty: q, mode: 'manual', reason: 'operator ticket' });
    setBook(res.book);
    setNote(res.error || `${side} filled on paper at ${res.trade?.price.toFixed(4)} (${res.trade?.source})`);
    if (res.trade) k.log('info', 'paper-desk', 'paper.fill', `${side} ${q} ${symbol}`);
  };

  const positions = Object.entries(book.positions);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5">
        <div>
          <p className="text-[12.5px] font-semibold text-amber-100">Paper trading only — crypto, equities, FX, and gold</p>
          <p className="text-[11px] text-amber-100/70">No exchange, broker, or bank is connected. Fills never leave this desk. Not financial advice. {feedNote}</p>
        </div>
        <Tag tone={book.halted ? 'bad' : 'warn'}>{book.halted ? 'HALTED' : 'PAPER'}</Tag>
      </div>

      <div className="grid gap-3 xl:grid-cols-[220px_1fr_280px]">
        <div className="rounded-xl border border-white/10 bg-black/30 p-2">
          <p className="px-1 pb-1 text-[10px] uppercase tracking-wider text-slate-500">Markets</p>
          <div className="max-h-[520px] space-y-1 overflow-auto">
            {INSTRUMENTS.map((i) => {
              const px = book.prices[i.symbol];
              const ch = ((px / i.seed) - 1) * 100;
              return (
                <button key={i.symbol} onClick={() => setSymbol(i.symbol)}
                  className={cx('flex w-full items-center justify-between rounded-lg border px-2 py-1.5 text-left',
                    symbol === i.symbol ? 'border-cyan-400/40 bg-cyan-400/10' : 'border-transparent hover:bg-white/5')}>
                  <span>
                    <span className="block text-[12px] text-slate-100">{i.symbol}</span>
                    <span className="block text-[10px] text-slate-500">{i.name}</span>
                  </span>
                  <span className="text-right">
                    <span className="block font-mono text-[11px] text-slate-200">{px.toFixed(i.klass === 'fx' ? 4 : 2)}</span>
                    <span className={cx('block font-mono text-[10px]', ch >= 0 ? 'text-emerald-300' : 'text-rose-300')}>{ch >= 0 ? '+' : ''}{ch.toFixed(2)}%</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-semibold text-slate-100">{inst.name}</span>
              <Tag tone={CLASS_TONE[inst.klass]}>{inst.klass}</Tag>
              <Tag tone={book.sources[symbol] === 'public-feed' ? 'ok' : 'mute'}>{book.sources[symbol] || 'simulated'}</Tag>
              <span className="ml-auto font-mono text-lg text-cyan-200">{book.prices[symbol].toFixed(inst.klass === 'fx' ? 4 : 2)}</span>
            </div>
            <Spark series={series} />
          </div>

          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
            <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">Advanced mode</p>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(STRATEGY_META) as StrategyMode[]).map((m) => (
                <button key={m} onClick={() => { setMode(m); if (m === 'manual') setArmed(false); }}
                  className={cx('rounded-md border px-2 py-1 text-[11px]', mode === m ? 'border-cyan-400/50 bg-cyan-400/15 text-cyan-100' : 'border-white/10 text-slate-400')}>
                  {STRATEGY_META[m].label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11.5px] text-slate-400">{STRATEGY_META[mode].blurb}</p>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              {mode === 'manual' ? (
                <>
                  <Field label={`Quantity (${inst.unit})`}><input className={cx(inputCls, 'w-28')} value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
                  <Btn tone="primary" onClick={() => manual('buy')}>Buy paper</Btn>
                  <Btn tone="danger" onClick={() => manual('sell')}>Sell paper</Btn>
                </>
              ) : (
                <>
                  {mode === 'dca' && <Field label="DCA slice (USD)"><input type="number" className={cx(inputCls, 'w-28')} value={dcaUsd} onChange={(e) => setDcaUsd(+e.target.value || 0)} /></Field>}
                  <Btn tone={armed ? 'danger' : 'primary'} onClick={() => setArmed((v) => !v)} disabled={book.halted}>{armed ? 'Disarm auto' : 'Arm paper auto'}</Btn>
                  {armed && <Tag tone="live">running on paper</Tag>}
                </>
              )}
              {book.halted && <Btn onClick={() => { setBook({ ...book, halted: false, haltReason: '', dayStartEquity: equityOf(book) }); setNote('Halt cleared. Day-start equity reset to now.'); }}>Clear halt</Btn>}
            </div>
            <p className="mt-2 font-mono text-[11px] text-slate-300">{note}</p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Paper account</p>
            <p className="mt-1 font-mono text-2xl text-slate-50">${eq.toFixed(2)}</p>
            <p className={cx('font-mono text-[12px]', dayPnl >= 0 ? 'text-emerald-300' : 'text-rose-300')}>{dayPnl >= 0 ? '+' : ''}{dayPnl.toFixed(2)} session</p>
            <div className="mt-2"><Meter label="Daily loss vs halt" value={Math.max(0, book.dayStartEquity - eq)} max={book.dayStartEquity * DEFAULT_LIMITS.maxDailyLossPct} /></div>
            <KV k="Cash" v={`$${book.cashUsd.toFixed(2)}`} />
            <KV k="Order cap" v={`${DEFAULT_LIMITS.maxOrderPct * 100}% of equity`} />
            <KV k="Shorting" v="disabled" />
            <Btn className="mt-2" onClick={() => {
              const path = '/home/harmos/HarmOS/outbox/paper-blotter.md';
              k.write('architect-core', path, blotterMarkdown(book), 'verified');
              setNote(`Blotter written to ${path}`);
            }}>Save blotter to vault</Btn>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Positions</p>
            {positions.length === 0 && <p className="text-[11px] text-slate-500">Flat.</p>}
            {positions.map(([sym, pos]) => (
              <div key={sym} className="flex items-center justify-between border-b border-white/5 py-1 text-[11px]">
                <span className="text-slate-200">{sym}</span>
                <span className="font-mono text-slate-400">{pos.qty} @ {pos.avg.toFixed(2)}</span>
                <span className={cx('font-mono', unrealized(book, sym) >= 0 ? 'text-emerald-300' : 'text-rose-300')}>{unrealized(book, sym).toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="max-h-40 overflow-auto rounded-xl border border-white/10 bg-black/30 p-3">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Blotter</p>
            {book.trades.slice(0, 8).map((t) => (
              <p key={t.id} className="font-mono text-[10px] text-slate-400">{t.side} {t.qty} {t.symbol} @ {t.price.toFixed(2)} · {t.mode}</p>
            ))}
            {!book.trades.length && <p className="text-[11px] text-slate-500">No paper fills yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Spark({ series }: { series: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const data = useMemo(() => series.slice(-80), [series]);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr; ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    if (data.length < 2) return;
    const min = Math.min(...data), max = Math.max(...data);
    const span = max - min || 1;
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * (w - 8) + 4;
      const y = h - 8 - ((v - min) / span) * (h - 16);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }, [data]);
  return <canvas ref={ref} className="h-36 w-full rounded-lg bg-black/40" />;
}
