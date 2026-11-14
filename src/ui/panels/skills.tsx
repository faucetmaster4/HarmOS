import { useMemo, useState } from 'react';
import { Btn, Field, KV, Panel, Tag, cx, inputCls, useKernel } from '../kit';
import {
  SKILLS, SKILL_CATEGORIES, renderSkill, routeSkill, skillCardMarkdown, validateSkill,
  type Skill,
} from '../../harmos/skills';

export function SkillsPanel() {
  const k = useKernel();
  const [cat, setCat] = useState<string>('all');
  const [selected, setSelected] = useState<Skill>(SKILLS[0]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [agentId, setAgentId] = useState('');
  const [output, setOutput] = useState('');
  const [msg, setMsg] = useState('');

  const agents = k.state.agents;
  const agent = agents.find((a) => a.id === agentId) || agents[0];

  const list = useMemo(() => SKILLS.filter((s) => cat === 'all' || s.category === cat), [cat]);
  const rendered = useMemo(() => renderSkill(selected, values), [selected, values]);
  const route = useMemo(() => routeSkill(selected, agent?.permissions.caps || []), [selected, agent]);
  const problems = useMemo(() => SKILLS.flatMap(validateSkill), []);

  const run = () => {
    if (rendered.missing.length) { setMsg(`Missing required fields: ${rendered.missing.join(', ')}`); return; }
    if (!route.allowed) { setMsg(route.reason); k.log('warn', 'skills', 'route.refused', `${selected.id}: ${route.reason}`); return; }
    const path = `/home/harmos/HarmOS/outbox/skill-${selected.id}-${Date.now()}.md`;
    k.write(agent?.id || 'nexus', path, [
      `# ${selected.name} v${selected.version}`,
      '',
      `Agent: ${agent?.name || agentId} (${agent?.id})`,
      `Capability used: \`${selected.capability}\``,
      `Rendered at: ${new Date().toISOString()}`,
      '',
      '---',
      '',
      rendered.text,
    ].join('\n'), 'model');
    setOutput(rendered.text);
    setMsg(`Rendered and routed to ${agent?.name}. Prompt written to ${path}. A response requires a connected model runtime; the prompt itself is real and inspectable.`);
    k.log('info', 'skills', 'skill.run', `${selected.id} → ${agent?.id}`);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[12.5px] font-semibold text-cyan-100">Agent skills library</p>
          <Tag tone="mute">{SKILLS.length} skills</Tag>
          {problems.length === 0 ? <Tag tone="ok">all templates validate</Tag> : <Tag tone="bad">{problems.length} template problem(s)</Tag>}
        </div>
        <p className="mt-1 text-[11px] text-slate-400">
          A skill is a versioned, reviewable prompt template with declared parameters and a required capability. The full template
          text is always visible — there is no hidden system prompt, and nothing is injected into a model call that you cannot read here.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[230px_1fr_1fr]">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {['all', ...SKILL_CATEGORIES].map((c) => (
              <button key={c} onClick={() => setCat(c)}
                className={cx('rounded border px-1.5 py-0.5 text-[10px]', cat === c ? 'border-cyan-400/50 text-cyan-200' : 'border-white/10 text-slate-500')}>{c}</button>
            ))}
          </div>
          <div className="space-y-1.5">
            {list.map((s) => (
              <button key={s.id} onClick={() => { setSelected(s); setValues({}); setOutput(''); setMsg(''); }}
                className={cx('w-full rounded-lg border p-2 text-left', selected.id === s.id ? 'border-cyan-400/40 bg-cyan-400/10' : 'border-white/10 hover:bg-white/5')}>
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11.5px] text-slate-100">{s.name}</span>
                  <code className="font-mono text-[9px] text-slate-500">v{s.version}</code>
                </div>
                <p className="text-[10px] text-slate-500">{s.category}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Panel title={selected.name} subtitle={selected.blurb}>
            <div className="flex flex-wrap items-center gap-1.5">
              <Tag tone="info">{selected.category}</Tag>
              <Tag tone="mute">v{selected.version}</Tag>
              <code className="font-mono text-[10px] text-slate-400">needs {selected.capability}</code>
            </div>
            <div className="mt-2 space-y-2">
              {selected.params.map((p) => (
                <Field key={p.key} label={`${p.label}${p.required ? ' *' : ''}`} hint={p.help}>
                  {p.type === 'longtext' ? (
                    <textarea className={cx(inputCls, 'h-20')} value={values[p.key] || p.default || ''} onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))} />
                  ) : p.type === 'select' ? (
                    <select className={inputCls} value={values[p.key] || p.default || ''} onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))}>
                      <option value="">— choose —</option>
                      {p.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input type={p.type === 'number' ? 'number' : 'text'} className={inputCls} value={values[p.key] || p.default || ''} onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))} />
                  )}
                </Field>
              ))}
            </div>
            <Field label="Route to agent">
              <select className={inputCls} value={agent?.id} onChange={(e) => setAgentId(e.target.value)}>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name} — [{a.permissions.caps.join(', ') || 'no capabilities'}]</option>)}
              </select>
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Btn tone="primary" onClick={run}>Render &amp; route</Btn>
              <Btn onClick={() => {
                const p = '/home/harmos/HarmOS/outbox/skill-card.md';
                k.write('architect-core', p, skillCardMarkdown(selected), 'verified');
                setMsg(`Skill card written to ${p} — includes the full template text and changelog.`);
              }}>Export skill card</Btn>
              <Tag tone={route.allowed ? 'ok' : 'bad'}>{route.allowed ? 'agent authorised' : 'routing refused'}</Tag>
            </div>
            {!route.allowed && <p className="mt-1 text-[11px] text-amber-300">{route.reason}</p>}
            {rendered.missing.length > 0 && <p className="mt-1 text-[11px] text-rose-300">Required fields empty: {rendered.missing.join(', ')}</p>}
            {rendered.unused.length > 0 && <p className="mt-1 text-[11px] text-slate-500">Declared but unused: {rendered.unused.join(', ')}</p>}
            {msg && <p className="mt-2 rounded-lg border border-white/10 bg-black/40 p-2 text-[11.5px] text-slate-200">{msg}</p>}
          </Panel>

          <Panel title="Changelog" subtitle="Every template change is versioned and described.">
            {selected.changelog.map((c, i) => (
              <div key={i} className="flex gap-2 border-b border-white/5 py-1 text-[11px] last:border-0">
                <code className="font-mono text-cyan-300">{c.split(' — ')[0]}</code>
                <span className="text-slate-400">{c.split(' — ')[1]}</span>
              </div>
            ))}
          </Panel>
        </div>

        <div className="space-y-2">
          <Panel title="Rendered prompt" subtitle="Exactly what the model receives. Nothing else is sent.">
            <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/50 p-2.5 font-mono text-[10.5px] leading-relaxed text-slate-200">
              {rendered.text || 'Fill the fields to render.'}
            </pre>
          </Panel>
          {output && (
            <Panel title="Model response" subtitle="Populated only when a runtime answers. HarmOS does not simulate a completion.">
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/50 p-2.5 font-mono text-[10.5px] text-slate-300">{output}</pre>
            </Panel>
          )}
          <Panel title="Library integrity">
            <KV k="Skills" v={SKILLS.length} />
            <KV k="Validation problems" v={problems.length} />
            <KV k="Categories" v={SKILL_CATEGORIES.length} />
            <p className="mt-2 text-[10.5px] text-slate-500">
              Validators reject hardcoded prompts, undeclared variables, select params without options, and templates too thin to review.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
