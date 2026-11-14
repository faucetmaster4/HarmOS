import { useMemo, useState } from 'react';
import { Btn, Field, Tag, cx, inputCls, useKernel } from '../kit';
import { generateStore, type StoreSpec } from '../../harmos/commerce';

export function CommerceStudio() {
  const k = useKernel();
  const [brand, setBrand] = useState('Northline');
  const [niche, setNiche] = useState('field coffee');
  const [tone, setTone] = useState<StoreSpec['tone']>('plain');
  const [theme, setTheme] = useState<StoreSpec['theme']>('sand');
  const [products, setProducts] = useState(4);
  const [margin, setMargin] = useState(45);
  const [dir, setDir] = useState('');
  const [preview, setPreview] = useState('');
  const [page, setPage] = useState('index.html');
  const [log, setLog] = useState('Nothing generated yet. This writes draft files into the vault. It does not open a live shop.');

  const spec: StoreSpec = { brand, niche, tone, theme, products, marginPct: margin };
  const draft = useMemo(() => generateStore(spec), [brand, niche, tone, theme, products, margin]);

  const write = () => {
    for (const f of draft.files) k.write('architect-core', f.path, f.content, 'model');
    setDir(draft.dir);
    setPreview(draft.files.find((f) => f.path.endsWith(page))?.content || draft.files[0].content);
    setLog(`Wrote ${draft.files.length} draft files to ${draft.dir}. No payment provider, domain, or supplier was contacted.`);
    k.log('info', 'commerce', 'store.draft', `${draft.slug} · ${draft.products.length} SKUs · margin ${margin}%`);
  };

  const show = (name: string) => {
    setPage(name);
    const hit = draft.files.find((f) => f.path.endsWith(name));
    if (hit) setPreview(hit.content);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3 py-2.5">
        <p className="text-[12.5px] font-semibold text-cyan-100">Store & dropshipping studio</p>
        <p className="text-[11px] text-slate-400">Generates a draft storefront, SKU map, unit-economics sheet, and a fulfillment SOP. It will not invent reviews, scrape photos, charge cards, or claim a supplier you have not named.</p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[300px_1fr]">
        <div className="space-y-3 rounded-xl border border-white/10 bg-black/30 p-3">
          <Field label="Brand"><input className={inputCls} value={brand} onChange={(e) => setBrand(e.target.value)} /></Field>
          <Field label="Niche"><input className={inputCls} value={niche} onChange={(e) => setNiche(e.target.value)} /></Field>
          <Field label="Voice">
            <select className={inputCls} value={tone} onChange={(e) => setTone(e.target.value as StoreSpec['tone'])}>
              <option value="plain">Plain</option>
              <option value="warm">Warm</option>
              <option value="technical">Technical</option>
            </select>
          </Field>
          <Field label="Theme">
            <select className={inputCls} value={theme} onChange={(e) => setTheme(e.target.value as StoreSpec['theme'])}>
              <option value="sand">Sand</option>
              <option value="obsidian">Obsidian</option>
              <option value="grove">Grove</option>
            </select>
          </Field>
          <Field label="Products (1–8)"><input type="number" min={1} max={8} className={inputCls} value={products} onChange={(e) => setProducts(+e.target.value || 1)} /></Field>
          <Field label="Draft margin %"><input type="number" min={5} max={80} className={inputCls} value={margin} onChange={(e) => setMargin(+e.target.value || 0)} /></Field>
          <Btn tone="primary" onClick={write}>Generate into vault</Btn>
          <p className="text-[11px] text-slate-400">{log}</p>
          {dir && <p className="font-mono text-[10px] text-cyan-300">{dir}</p>}
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {['index.html', 'product.html', 'policies.html', 'dropship.html', 'FULFILLMENT.md', 'PRICING.md', 'LAUNCH.md', 'sku-map.csv'].map((n) => (
              <button key={n} onClick={() => show(n)} className={cx('rounded border px-2 py-1 text-[11px]', page === n ? 'border-cyan-400/40 text-cyan-100' : 'border-white/10 text-slate-400')}>{n}</button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {draft.products.slice(0, 3).map((p) => (
              <div key={p.sku} className="rounded-lg border border-white/10 bg-black/20 p-2">
                <p className="text-[12px] text-slate-100">{p.name}</p>
                <p className="font-mono text-[11px] text-slate-400">{p.sku} · ${p.price.toFixed(2)}</p>
                <Tag tone="mute">supplier unassigned</Tag>
              </div>
            ))}
          </div>
          <div className="overflow-hidden rounded-xl border border-white/10 bg-white">
            {preview.startsWith('<!doctype') ? (
              <iframe title="Store draft preview" sandbox="" srcDoc={preview} className="h-[420px] w-full bg-white" />
            ) : (
              <pre className="h-[420px] overflow-auto bg-[#0c0f14] p-3 font-mono text-[11px] text-slate-300">{preview || 'Generate to preview. The kit also includes a CSV, a pricing sheet, and a launch checklist that refuses fake reviews.'}</pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
