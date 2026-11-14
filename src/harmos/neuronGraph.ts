/* HarmOS NeuronBrain Connectome Engine
 *
 * Transforms the live Sovereign Vault (VFS files, directories, agent memories,
 * specialist agents, and task artifacts) into an inspectable 3D neural graph.
 * Every soma (node) and axon (edge) corresponds to a real record in Kernel state.
 */

import type { Kernel, Provenance } from './kernel';

export type NeuronKind = 'core' | 'lobe' | 'file' | 'agent' | 'memory' | 'task';
export type SynapseKind = 'hierarchy' | 'authorship' | 'grant' | 'engram' | 'reference' | 'artifact';

export interface NeuronNode {
  id: string;
  label: string;
  sublabel: string;
  kind: NeuronKind;
  provenance?: Provenance;
  path?: string;
  bytes?: number;
  sha?: string;
  updatedAt?: number;
  color: string;
  radius: number;
  matched: boolean;
  /* 3D spherical default coordinates in [-1..1] */
  sx: number;
  sy: number;
  sz: number;
}

export interface SynapseEdge {
  id: string;
  from: string;
  to: string;
  kind: SynapseKind;
  strength: number;
  active: boolean;
}

export interface VaultConnectome {
  nodes: NeuronNode[];
  edges: SynapseEdge[];
  stats: {
    files: number;
    memories: number;
    agents: number;
    synapses: number;
    activeMatches: number;
  };
}

export const PROVENANCE_COLOR: Record<Provenance, string> = {
  verified: '#22d3ee', // electric cyan
  user: '#60a5fa',     // sapphire blue
  model: '#a78bfa',    // luminous violet
  inferred: '#fbbf24', // synaptic amber
};

const CORTICAL_LOBES: Array<{ prefix: string; name: string; color: string; lat: number; lon: number }> = [
  { prefix: '/home/harmos/HarmOS/workspace', name: 'Workspace Cortex', color: '#22d3ee', lat: 0.25, lon: 0.0 },
  { prefix: '/home/harmos/HarmOS/outbox', name: 'Outbox Motor Lobe', color: '#a78bfa', lat: 0.25, lon: 1.57 },
  { prefix: '/home/harmos/HarmOS/notes', name: 'Hippocampal Notes', color: '#60a5fa', lat: 0.25, lon: 3.14 },
  { prefix: '/var/lib/harmos', name: 'Vault Basal Nuclei', color: '#34d399', lat: -0.35, lon: 4.4 },
  { prefix: '/var/log/harmos', name: 'Sentinel Brainstem', color: '#f472b6', lat: -0.45, lon: 2.1 },
];

function detAngle(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 10000) / 10000;
}

function extractKeywords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z][a-z0-9_-]{4,22}/g) || [];
  const stop = new Set(['harmos', 'about', 'short', 'write', 'create', 'files', 'local', 'first', 'agent', 'state', 'these', 'there', 'which', 'where', 'their']);
  const out = new Set<string>();
  for (const w of words) {
    if (!stop.has(w)) out.add(w);
    if (out.size >= 18) break;
  }
  return out;
}

export function buildVaultConnectome(
  k: Kernel,
  opts: { query?: string; includeAgents?: boolean; includeMemories?: boolean } = {},
): VaultConnectome {
  const s = k.state;
  const q = (opts.query || '').trim().toLowerCase();
  const showAgents = opts.includeAgents !== false;
  const showMemories = opts.includeMemories !== false;

  const nodes: NeuronNode[] = [];
  const edges: SynapseEdge[] = [];
  const nodeIds = new Set<string>();
  const addNode = (n: NeuronNode) => {
    if (!nodeIds.has(n.id)) {
      nodeIds.add(n.id);
      nodes.push(n);
    }
  };
  const addEdge = (from: string, to: string, kind: SynapseKind, strength = 0.6, active = false) => {
    if (from === to || !nodeIds.has(from) || !nodeIds.has(to)) return;
    const id = `${from}->${to}:${kind}`;
    if (!edges.some((e) => e.id === id)) edges.push({ id, from, to, kind, strength, active });
  };

  // 1. Thalamic Core
  addNode({
    id: 'core:thalamus',
    label: 'Thalamic Vault Core',
    sublabel: `${Object.values(s.vfs).filter((v) => v.kind === 'file').length} engrams · Sovereign Root`,
    kind: 'core',
    color: '#38bdf8',
    radius: 13,
    matched: false,
    sx: 0, sy: 0, sz: 0,
  });

  // 2. Cortical Lobes
  for (const lobe of CORTICAL_LOBES) {
    const r = 0.42;
    const sx = r * Math.cos(lobe.lat) * Math.cos(lobe.lon);
    const sy = r * Math.sin(lobe.lat);
    const sz = r * Math.cos(lobe.lat) * Math.sin(lobe.lon);
    const id = `lobe:${lobe.prefix}`;
    const matched = !!q && (lobe.name.toLowerCase().includes(q) || lobe.prefix.toLowerCase().includes(q));
    addNode({
      id,
      label: lobe.name,
      sublabel: lobe.prefix,
      kind: 'lobe',
      path: lobe.prefix,
      color: lobe.color,
      radius: 8.5,
      matched,
      sx, sy, sz,
    });
    addEdge('core:thalamus', id, 'hierarchy', 0.9, matched);
  }

  // 3. Specialist Agent Ganglia (outer equatorial halo)
  const agentByName = new Map<string, string>();
  if (showAgents) {
    s.agents.forEach((a, idx) => {
      const ang = (idx / Math.max(1, s.agents.length)) * Math.PI * 2;
      const matched = !!q && (a.name.toLowerCase().includes(q) || a.role.toLowerCase().includes(q));
      const id = `agent:${a.id}`;
      agentByName.set(a.name.toLowerCase(), id);
      agentByName.set(a.id.toLowerCase(), id);
      addNode({
        id,
        label: a.name,
        sublabel: `${a.role}${a.revoked ? ' · REVOKED' : ''}`,
        kind: 'agent',
        color: a.revoked ? '#fb7185' : '#e879f9',
        radius: 7.5,
        matched,
        sx: 0.92 * Math.cos(ang),
        sy: 0.18 * Math.sin(ang * 2),
        sz: 0.92 * Math.sin(ang),
      });
      for (const root of a.permissions.roots) {
        const lobe = CORTICAL_LOBES.find((l) => root.startsWith(l.prefix) || l.prefix.startsWith(root));
        if (lobe) addEdge(id, `lobe:${lobe.prefix}`, 'grant', 0.35, matched);
      }
    });
  }

  // 4. Vault File Neurons
  const files = Object.values(s.vfs)
    .filter((v) => v.kind === 'file')
    .sort((a, b) => a.path.localeCompare(b.path));

  const fileKeywordMap = new Map<string, Set<string>>();

  files.forEach((f, idx) => {
    const lobe = CORTICAL_LOBES.find((l) => f.path.startsWith(l.prefix)) || CORTICAL_LOBES[0];
    const lobeNode = nodes.find((n) => n.id === `lobe:${lobe.prefix}`)!;
    const u = detAngle(f.path);
    const v = detAngle(f.path + ':v');
    const theta = u * Math.PI * 2 + idx * 0.618;
    const phi = (v - 0.5) * Math.PI * 0.85;
    const spread = 0.28 + (idx % 4) * 0.045;

    const sx = lobeNode.sx * 1.35 + spread * Math.cos(phi) * Math.cos(theta);
    const sy = lobeNode.sy * 1.35 + spread * Math.sin(phi);
    const sz = lobeNode.sz * 1.35 + spread * Math.cos(phi) * Math.sin(theta);

    const base = f.path.split('/').pop() || f.path;
    const matched = !!q && (f.path.toLowerCase().includes(q) || f.content.toLowerCase().includes(q) || f.provenance.includes(q));
    const fid = `file:${f.path}`;

    addNode({
      id: fid,
      label: base,
      sublabel: `${f.provenance} · ${f.content.length} B · ${f.author}`,
      kind: 'file',
      provenance: f.provenance,
      path: f.path,
      bytes: f.content.length,
      sha: f.sha,
      updatedAt: f.updatedAt,
      color: PROVENANCE_COLOR[f.provenance] || '#22d3ee',
      radius: Math.min(9.5, Math.max(4.5, 3.6 + Math.log2(f.content.length + 8) * 0.52)),
      matched,
      sx, sy, sz,
    });

    addEdge(`lobe:${lobe.prefix}`, fid, 'hierarchy', 0.75, matched);
    const authorAgent = agentByName.get(f.author.toLowerCase());
    if (authorAgent) addEdge(authorAgent, fid, 'authorship', 0.65, matched);

    fileKeywordMap.set(fid, extractKeywords(f.content + ' ' + base));
  });

  // 5. Cross-file Associative Synapses (basename mention or shared rare keywords)
  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const a = files[i], b = files[j];
      const idA = `file:${a.path}`, idB = `file:${b.path}`;
      const baseA = (a.path.split('/').pop() || '').toLowerCase();
      const baseB = (b.path.split('/').pop() || '').toLowerCase();
      const directMention =
        (baseB.length > 4 && a.content.toLowerCase().includes(baseB)) ||
        (baseA.length > 4 && b.content.toLowerCase().includes(baseA));

      let shared = 0;
      const kwA = fileKeywordMap.get(idA)!;
      const kwB = fileKeywordMap.get(idB)!;
      for (const w of kwA) if (kwB.has(w)) shared++;

      if (directMention || shared >= 3) {
        const active = !!(q && (nodes.find((n) => n.id === idA)?.matched || nodes.find((n) => n.id === idB)?.matched));
        addEdge(idA, idB, 'reference', directMention ? 0.85 : 0.45, active);
      }
    }
  }

  // 6. Agent Memory Engrams
  if (showMemories) {
    s.memory.slice(0, 40).forEach((m, idx) => {
      const mid = `mem:${m.id}`;
      const ang = idx * 2.39996 + 0.5;
      const matched = !!q && (m.text.toLowerCase().includes(q) || m.source.toLowerCase().includes(q));
      addNode({
        id: mid,
        label: m.text.slice(0, 28) + (m.text.length > 28 ? '…' : ''),
        sublabel: `memory · ${m.provenance} · ${m.source}`,
        kind: 'memory',
        provenance: m.provenance,
        updatedAt: m.at,
        color: '#34d399',
        radius: 4.6,
        matched,
        sx: 0.68 * Math.cos(ang),
        sy: -0.52 + (idx % 5) * 0.14,
        sz: 0.68 * Math.sin(ang),
      });
      const aid = `agent:${m.agentId}`;
      if (nodeIds.has(aid)) addEdge(aid, mid, 'engram', 0.7, matched);
      else addEdge('core:thalamus', mid, 'engram', 0.5, matched);
    });
  }

  // 7. Recent Task Synapses (connect tasks that wrote vault files)
  s.tasks.slice(0, 12).forEach((t, idx) => {
    if (!t.outputs.length) return;
    const tid = `task:${t.id}`;
    const ang = idx * 1.1 + 0.3;
    const matched = !!q && t.title.toLowerCase().includes(q);
    addNode({
      id: tid,
      label: t.title.slice(0, 26),
      sublabel: `task · ${t.state}`,
      kind: 'task',
      updatedAt: t.createdAt,
      color: t.state === 'COMPLETED' ? '#2dd4bf' : '#fbbf24',
      radius: 5.2,
      matched,
      sx: 0.36 * Math.cos(ang),
      sy: 0.58,
      sz: 0.36 * Math.sin(ang),
    });
    const aid = `agent:${t.agentId}`;
    if (nodeIds.has(aid)) addEdge(aid, tid, 'artifact', 0.6, matched);
    for (const outPath of t.outputs) {
      addEdge(tid, `file:${outPath}`, 'artifact', 0.85, true);
    }
  });

  return {
    nodes,
    edges,
    stats: {
      files: files.length,
      memories: showMemories ? Math.min(40, s.memory.length) : 0,
      agents: showAgents ? s.agents.length : 0,
      synapses: edges.length,
      activeMatches: nodes.filter((n) => n.matched).length,
    },
  };
}
