import React, { createContext, useContext, useSyncExternalStore } from 'react';
import { Kernel, type KernelState } from '../harmos/kernel';

export const KernelCtx = createContext<Kernel | null>(null);
export function useKernel(): Kernel {
  const k = useContext(KernelCtx);
  if (!k) throw new Error('KernelCtx missing');
  return k;
}
export function useKernelState(): KernelState {
  const k = useKernel();
  // The third argument is the server snapshot. Without it React 18+ refuses to
  // server-render any consumer, which is why the panel smoke test caught this.
  return useSyncExternalStore(k.subscribe, k.getSnapshot, k.getSnapshot);
}

export const cx = (...c: Array<string | false | undefined | null>) => c.filter(Boolean).join(' ');

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}
export function ago(ts: number) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}
export const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour12: false });

/* ---------- primitives ---------- */

export function Panel({ title, subtitle, right, children, className }: {
  title?: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={cx('rounded-xl border border-white/10 bg-white/[0.025] backdrop-blur-sm', className)}>
      {(title || right) && (
        <header className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-2.5">
          <div>
            {title && <h3 className="text-[13px] font-semibold tracking-wide text-slate-100">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{subtitle}</p>}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const TONES: Record<string, string> = {
  ok: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  live: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-300',
  warn: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  bad: 'border-rose-400/30 bg-rose-400/10 text-rose-300',
  info: 'border-violet-400/30 bg-violet-400/10 text-violet-300',
  mute: 'border-white/10 bg-white/5 text-slate-400',
};

export function Tag({ tone = 'mute', children, title }: { tone?: keyof typeof TONES | string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider', TONES[tone] || TONES.mute)}>
      {children}
    </span>
  );
}

/** Honest implementation-status badge. Used anywhere a capability is partial or absent. */
export function Impl({ status }: { status: 'implemented' | 'partial' | 'script-only' | 'proposed' | 'unavailable' }) {
  const map = {
    implemented: ['ok', 'implemented'],
    partial: ['warn', 'partial'],
    'script-only': ['info', 'script only · not executed here'],
    proposed: ['mute', 'proposed · no behaviour'],
    unavailable: ['bad', 'unavailable in this build'],
  } as const;
  const [tone, label] = map[status];
  return <Tag tone={tone}>{label}</Tag>;
}

export function Btn({ children, onClick, tone = 'default', disabled, title, type = 'button', className }: {
  children: React.ReactNode; onClick?: () => void; tone?: 'default' | 'primary' | 'danger' | 'ghost';
  disabled?: boolean; title?: string; type?: 'button' | 'submit'; className?: string;
}) {
  const tones = {
    default: 'border-white/15 bg-white/5 text-slate-200 hover:bg-white/10',
    primary: 'border-cyan-400/40 bg-cyan-400/15 text-cyan-200 hover:bg-cyan-400/25',
    danger: 'border-rose-400/40 bg-rose-400/10 text-rose-200 hover:bg-rose-400/20',
    ghost: 'border-transparent bg-transparent text-slate-400 hover:text-slate-100 hover:bg-white/5',
  };
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick}
      className={cx('rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40', tones[tone], className)}>
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputCls = 'w-full rounded-md border border-white/10 bg-black/40 px-2.5 py-1.5 text-[12px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-400/50';

export function Meter({ value, max = 100, tone = 'cyan', label }: { value: number; max?: number; tone?: string; label?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const colour = pct > 85 ? 'bg-rose-400' : pct > 60 ? 'bg-amber-400' : tone === 'violet' ? 'bg-violet-400' : 'bg-cyan-400';
  return (
    <div>
      {label && <div className="mb-1 flex justify-between text-[11px] text-slate-400"><span>{label}</span><span className="tabular-nums text-slate-300">{pct.toFixed(0)}%</span></div>}
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className={cx('h-full rounded-full transition-all duration-500', colour)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center text-[12px] text-slate-500">{children}</p>;
}

export function KV({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/5 py-1.5 last:border-0">
      <span className="text-[11px] text-slate-400">{k}</span>
      <span className={cx('text-right text-[12px] text-slate-200', mono && 'font-mono text-[11px]')}>{v}</span>
    </div>
  );
}

export const STATE_TONE: Record<string, string> = {
  PENDING: 'mute', QUEUED: 'info', RUNNING: 'live', COMPLETED: 'ok', FAILED: 'bad', CANCELLED: 'warn',
};
