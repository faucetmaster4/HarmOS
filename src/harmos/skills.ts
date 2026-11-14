/* HarmOS Agent Skills — a library of reviewable prompt templates with versioning.
 *
 * A skill is a versioned, inspectable template, not a hidden system prompt. Variables are
 * declared and substituted deterministically; nothing is silently injected into a model
 * call. Each skill declares which capability it needs, and the router refuses to run a
 * skill the selected agent is not allowed to use.
 */

export type SkillCategory = 'analysis' | 'writing' | 'security' | 'commerce' | 'trading' | 'systems';

export interface SkillParam {
  key: string;
  label: string;
  type: 'text' | 'longtext' | 'number' | 'select';
  required: boolean;
  default?: string;
  options?: string[];
  help?: string;
}

export interface Skill {
  id: string;
  name: string;
  version: string;             // semver
  category: SkillCategory;
  blurb: string;
  capability: string;          // capability the agent must hold
  params: SkillParam[];
  template: string;            // supports {{key}} and {{#if key}}...{{/if}}
  changelog: string[];
}

export const SKILLS: Skill[] = [
  {
    id: 'core.postmortem',
    name: 'Incident post-mortem',
    version: '1.2.0',
    category: 'systems',
    blurb: 'Blameless timeline, contributing factors, and concrete follow-ups with owners.',
    capability: 'fs:read',
    params: [
      { key: 'incident', label: 'What happened', type: 'longtext', required: true, help: 'Facts only. Screenshots and logs belong in the vault, linked by path.' },
      { key: 'duration', label: 'How long did it last', type: 'text', required: false, default: 'unknown' },
      { key: 'customers', label: 'Who was affected', type: 'text', required: false, default: 'internal only' },
    ],
    template: `You are writing a blameless incident post-mortem.

INCIDENT: {{incident}}
DURATION: {{duration}}
AFFECTED: {{customers}}

Produce, in this order:
1. A one-paragraph summary a non-specialist could read.
2. A timeline as a table (time | event | source). Mark any gap "unknown" — do not invent a timestamp.
3. Contributing factors. Separate "what made it possible" from "what made it worse".
4. What went well. Every incident has something; do not skip this section.
5. Follow-ups as a table (action | owner-role | effort | blocks-recurrence). At least one must be structural, not "be more careful".
6. What this analysis cannot determine from the information given.

Rules: no individual blame, no invented timestamps, no unexplained jargon. If a section needs a fact you were not given, say so explicitly.`,
    changelog: ['1.2.0 — added "what this cannot determine" so the model stops guessing', '1.1.0 — made follow-up owners roles, not names', '1.0.0 — initial'],
  },
  {
    id: 'sec.threat-model',
    name: 'Threat model (STRIDE-lite)',
    version: '1.1.0',
    category: 'security',
    blurb: 'Enumerates spoofing, tampering, repudiation, information disclosure, denial of service, elevation of privilege for one component.',
    capability: 'fs:read',
    params: [
      { key: 'component', label: 'Component to model', type: 'text', required: true },
      { key: 'trust', label: 'Trust boundary description', type: 'longtext', required: true },
      { key: 'assets', label: 'Assets that matter', type: 'longtext', required: true },
    ],
    template: `Threat-model this component. Be concrete and cite the boundary.

COMPONENT: {{component}}
TRUST BOUNDARY: {{trust}}
ASSETS: {{assets}}

For each of STRIDE (Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege) give:
- A specific plausible threat against THIS component, not a textbook definition.
- Likelihood (low/med/high) with a one-line justification.
- A mitigation that is actually implementable, plus what it costs.
- Whether the mitigation is already present in what was described.

Finish with: the single highest-value fix, and two things you were not told that would change the analysis. Do not recommend a product by name. Do not claim anything is secure — say what is and is not covered.`,
    changelog: ['1.1.0 — requires "already present?" per mitigation so the report cannot be all future work', '1.0.0 — initial'],
  },
  {
    id: 'trade.trade-review',
    name: 'Trade thesis review',
    version: '1.0.1',
    category: 'trading',
    blurb: 'Steelman then attack a trade idea, and state what would falsify it.',
    capability: 'net:cloud',
    params: [
      { key: 'thesis', label: 'The thesis', type: 'longtext', required: true },
      { key: 'horizon', label: 'Time horizon', type: 'select', required: true, options: ['intraday', 'weeks', 'months', 'years'], default: 'weeks' },
      { key: 'size', label: 'Intended size (% of equity)', type: 'number', required: false, default: '5' },
    ],
    template: `Review this trading thesis. You are not a cheerleader and not a fortune teller.

THESIS: {{thesis}}
HORIZON: {{horizon}}
INTENDED SIZE: {{size}}% of equity

Sections:
1. Steelman — the strongest honest case for it.
2. Attack — the strongest case against, including the regime where this thesis has historically failed.
3. Falsifiers — specific, observable conditions that would prove it wrong, with the price or data level where you would concede.
4. Sizing — at {{size}}%, what drawdown would this position produce if the attack case happens? Show the arithmetic.
5. Costs — realistic fees, slippage, and financing for the horizon chosen.
6. What you cannot know.

Hard rules: no price targets presented as predictions. No "should". Every number is either given, derived with shown arithmetic, or labelled unknown. End with one sentence: is the size appropriate given the falsifiers?`,
    changelog: ['1.0.1 — sizing section must show arithmetic, not a verdict', '1.0.0 — initial'],
  },
  {
    id: 'com.product-copy',
    name: 'Honest product copy',
    version: '1.3.0',
    category: 'commerce',
    blurb: 'Product description that sells without inventing reviews, scarcity, or specifications.',
    capability: 'fs:write',
    params: [
      { key: 'product', label: 'Product', type: 'text', required: true },
      { key: 'facts', label: 'Verified facts from the supplier', type: 'longtext', required: true },
      { key: 'audience', label: 'Who it is for', type: 'text', required: true },
      { key: 'price', label: 'Price (USD)', type: 'number', required: false },
    ],
    template: `Write product copy for {{product}} aimed at {{audience}}.

VERIFIED FACTS (the only claims you may make):
{{facts}}
{{#if price}}PRICE: \${{price}}{{/if}}

Deliver:
1. A headline under 60 characters. No superlatives you cannot support.
2. A 90-word description using only the verified facts above.
3. Five bullet specs, each traceable to a supplied fact.
4. One honest objection a buyer would raise, and a straight answer to it.
5. A "not included" list — things a buyer might assume come with it but do not.

Forbidden: fake review counts, "limited time", "only N left", invented certifications, superlatives such as "best" or "perfect", and any claim not present in the facts list. If the facts are too thin to write honestly, say exactly what is missing instead of filling the gap.`,
    changelog: ['1.3.0 — added the "not included" section', '1.2.0 — forbids invented certifications', '1.0.0 — initial'],
  },
  {
    id: 'code.refactor-plan',
    name: 'Refactor plan',
    version: '1.1.0',
    category: 'analysis',
    blurb: 'A stepwise refactor where every step leaves the tree green and is individually revertible.',
    capability: 'shell:exec',
    params: [
      { key: 'code', label: 'Code or path to refactor', type: 'longtext', required: true },
      { key: 'goal', label: 'What the refactor must achieve', type: 'longtext', required: true },
      { key: 'constraints', label: 'Constraints (must not break)', type: 'text', required: false },
    ],
    template: `Plan a refactor. Assume nothing is safer than it looks.

CODE:
{{code}}

GOAL: {{goal}}
{{#if constraints}}CONSTRAINTS: {{constraints}}{{/if}}

Produce:
1. Current shape — what the code does now, in three sentences.
2. Target shape — what it should do, and how you will know it is equivalent.
3. A characterisation-test list BEFORE any change: what test would catch a behaviour change?
4. Numbered steps. Each step must (a) be independently revertible, (b) leave the suite green, (c) be describable in one sentence a reviewer can verify.
5. For each step, the specific thing most likely to go wrong.
6. What you would delete, and why it is safe to delete.
7. Rollback plan if step 3 fails.

Do not write the refactored code. Do not propose a "big rewrite" step. If the goal needs one, say the refactor is not the right tool.`,
    changelog: ['1.1.0 — bans the "big rewrite" step', '1.0.0 — initial'],
  },
  {
    id: 'write.explainer',
    name: 'Explain like an operator',
    version: '1.0.0',
    category: 'writing',
    blurb: 'Explains a technical topic to someone who will actually operate the thing.',
    capability: 'fs:read',
    params: [
      { key: 'topic', label: 'Topic', type: 'text', required: true },
      { key: 'level', label: 'Reader level', type: 'select', required: true, options: ['complete beginner', 'comfortable user', 'practitioner', 'expert in a neighbouring field'], default: 'comfortable user' },
      { key: 'why', label: 'What they need to do with it', type: 'text', required: false },
    ],
    template: `Explain {{topic}} to someone at the "{{level}}" level.
{{#if why}}They need this in order to: {{why}}{{/if}}

Structure:
1. The one-sentence version.
2. The mental model — one analogy that maps cleanly, then where the analogy breaks.
3. How it works, in the order things actually happen. Number the steps.
4. Three mistakes people at this level actually make, and how to notice each one happening.
5. What to check first when it misbehaves.
6. Two terms worth knowing, defined without jargon.

Rules: no "simply", no "obviously", no "just". Every analogy must be followed by where it stops working. Prefer a concrete number over "usually". If the honest answer depends on configuration, give the most common default and name the variable.`,
    changelog: ['1.0.0 — initial'],
  },
];

export const SKILL_CATEGORIES: SkillCategory[] = ['analysis', 'writing', 'security', 'commerce', 'trading', 'systems'];

/* --------------------------- template rendering --------------------------- */

export interface RenderResult { text: string; missing: string[]; unused: string[]; }

export function renderSkill(skill: Skill, values: Record<string, string>): RenderResult {
  const missing: string[] = [];
  const used = new Set<string>();

  let text = skill.template.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key: string, body: string) => {
    used.add(key);
    const v = values[key];
    if (v === undefined || v === '') { if (skill.params.find((p) => p.key === key)?.required) missing.push(key); return ''; }
    return body;
  });

  text = text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    used.add(key);
    const v = values[key];
    if (v === undefined || v === '') {
      if (skill.params.find((p) => p.key === key)?.required) missing.push(key);
      return `«missing: ${key}»`;
    }
    return v;
  });

  const declared = skill.params.map((p) => p.key);
  const unused = declared.filter((k) => !used.has(k));
  return { text, missing: [...new Set(missing)], unused };
}

export function validateSkill(s: Skill): string[] {
  const errors: string[] = [];
  if (!SEMVER_RE.test(s.version)) errors.push(`${s.id}: version "${s.version}" is not semver`);
  if (!s.template.includes('{{')) errors.push(`${s.id}: template has no variables — that is a hardcoded prompt, not a skill`);
  const declared = new Set(s.params.map((p) => p.key));
  const referenced = [...s.template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
  for (const r of referenced) if (!declared.has(r)) errors.push(`${s.id}: template uses {{${r}}} but it is not declared as a param`);
  for (const p of s.params) {
    if (p.type === 'select' && !p.options?.length) errors.push(`${s.id}: select param "${p.key}" has no options`);
    if (p.default && p.type === 'select' && !p.options?.includes(p.default)) errors.push(`${s.id}: default for "${p.key}" is not one of its options`);
  }
  if (s.template.length < 200) errors.push(`${s.id}: template under 200 chars — too thin to be reviewable`);
  return errors;
}

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

/* ------------------------------- routing ---------------------------------- */

export interface RouteDecision { allowed: boolean; reason: string; }

export function routeSkill(skill: Skill, agentCapabilities: string[]): RouteDecision {
  if (agentCapabilities.includes(skill.capability)) {
    return { allowed: true, reason: `${skill.name} needs ${skill.capability}, which the agent holds` };
  }
  return {
    allowed: false,
    reason: `Refused: ${skill.name} requires ${skill.capability} and the agent holds [${agentCapabilities.join(', ') || 'none'}]. Grant it in the Agent Matrix, or pick another agent.`,
  };
}

export function skillCardMarkdown(s: Skill): string {
  return [
    `# ${s.name} — v${s.version}`,
    '',
    `**Category:** ${s.category}  `,
    `**Capability required:** \`${s.capability}\`  `,
    `**Author:** HarmOS built-in`,
    '',
    s.blurb,
    '',
    '## Parameters',
    '',
    '| key | type | required | default |',
    '| --- | --- | --- | --- |',
    ...s.params.map((p) => `| \`${p.key}\` | ${p.type} | ${p.required ? 'yes' : 'no'} | ${p.default ? `\`${p.default}\`` : '—'} |`),
    '',
    '## Template (what the model actually receives)',
    '',
    '```',
    s.template,
    '```',
    '',
    '## Changelog',
    '',
    ...s.changelog.map((c) => `- ${c}`),
  ].join('\n');
}
