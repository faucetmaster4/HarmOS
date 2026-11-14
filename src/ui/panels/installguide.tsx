import { useEffect, useMemo, useState } from 'react';
import { Btn, Tag, cx } from '../kit';
import { installGuides, type HostOs } from '../../harmos/installGuides';
import { OVA_MANIFEST } from '../../harmos/installerAssets';

const OS_MARK: Record<HostOs, string> = { windows: 'Win', macos: 'Mac', ubuntu: 'Ubu', kali: 'Kali' };

export function InstallGuidePanel() {
  const guides = useMemo(() => installGuides(OVA_MANIFEST.sha256 || '<download the .sha256 file>'), []);
  const [os, setOs] = useState<HostOs>('windows');
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState('');
  const guide = guides.find((g) => g.id === os)!;
  const key = (i: number) => `${os}:${i}`;
  const finished = guide.steps.filter((_, i) => done[key(i)]).length;

  useEffect(() => {
    try {
      const raw = localStorage.getItem('harmos.install.guide');
      if (raw) setDone(JSON.parse(raw) as Record<string, boolean>);
    } catch { /* ignore */ }
  }, []);

  const toggle = (i: number) => {
    const next = { ...done, [key(i)]: !done[key(i)] };
    setDone(next);
    localStorage.setItem('harmos.install.guide', JSON.stringify(next));
  };

  const copy = async (text: string, id: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(''), 1200); }
    catch { setCopied('blocked'); }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5">
        <p className="text-[12.5px] font-semibold text-slate-100">Dummy-proof install — Windows, macOS, Ubuntu, Kali Linux</p>
        <p className="text-[11px] text-slate-400">
          Example names (Alex, kali, C:\Users\Alex\…) are samples. The checksum is the real release digest when the appliance was built.
          Kali Linux here is the <em>host</em>. HarmOS KaliOS is the guest&apos;s defensive panel — this guide does not turn on offensive tools.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        {guides.map((g) => (
          <button key={g.id} onClick={() => setOs(g.id)}
            className={cx('rounded-xl border p-3 text-left', os === g.id ? 'border-cyan-400/50 bg-cyan-400/10' : 'border-white/10 bg-black/20')}>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] text-cyan-300">{OS_MARK[g.id]}</span>
              <span className="text-[10px] text-slate-500">{g.minutes}</span>
            </div>
            <p className="mt-1 text-[13px] text-slate-100">{g.title}</p>
            <p className="text-[11px] text-slate-500">{g.subtitle}</p>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 text-[12px] text-slate-400">
        <span>{finished}/{guide.steps.length} steps checked on this machine (saved in this browser only)</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full bg-cyan-400" style={{ width: `${(finished / guide.steps.length) * 100}%` }} />
        </div>
        <Btn onClick={() => { const next = { ...done }; guide.steps.forEach((_, i) => delete next[key(i)]); setDone(next); localStorage.setItem('harmos.install.guide', JSON.stringify(next)); }}>Reset</Btn>
      </div>

      <ol className="space-y-2">
        {guide.steps.map((step, i) => (
          <li key={step.title} className={cx('rounded-xl border p-3', done[key(i)] ? 'border-emerald-400/30 bg-emerald-400/5' : 'border-white/10 bg-black/25')}>
            <div className="flex flex-wrap items-start gap-2">
              <span className="font-mono text-[12px] text-cyan-300">{String(i + 1).padStart(2, '0')}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-slate-100">{step.title}</p>
                <p className="mt-1 text-[12px] text-slate-300"><span className="text-slate-500">Do this. </span>{step.do}</p>
                <p className="mt-1 text-[12px] text-slate-400"><span className="text-slate-500">You should see. </span>{step.see}</p>
                <p className="mt-1 rounded-md border border-dashed border-amber-400/30 bg-amber-400/5 px-2 py-1 text-[11.5px] text-amber-100/90">
                  <span className="font-semibold">Dummy example. </span>{step.dummy}
                </p>
                {step.command && (
                  <div className="mt-2 overflow-hidden rounded-lg border border-white/10 bg-black/50">
                    <div className="flex items-center justify-between border-b border-white/10 px-2 py-1">
                      <span className="text-[10px] uppercase tracking-wider text-slate-500">Command</span>
                      <button className="text-[11px] text-cyan-300" onClick={() => copy(step.command!, key(i))}>{copied === key(i) ? 'Copied' : 'Copy'}</button>
                    </div>
                    <pre className="overflow-auto px-2 py-1.5 font-mono text-[11px] text-slate-200">{step.command}</pre>
                  </div>
                )}
                <p className="mt-1 text-[11px] text-slate-500">Check: {step.check}</p>
              </div>
              <button onClick={() => toggle(i)} className="shrink-0">
                <Tag tone={done[key(i)] ? 'ok' : 'mute'}>{done[key(i)] ? 'done' : 'mark done'}</Tag>
              </button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
