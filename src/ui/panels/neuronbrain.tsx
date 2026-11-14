import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Btn, Empty, KV, Tag, cx, fmtBytes, inputCls, useKernel, useKernelState, ago } from '../kit';
import {
  PROVENANCE_COLOR,
  buildVaultConnectome,
  type NeuronKind,
  type NeuronNode,
} from '../../harmos/neuronGraph';
import { sha256Hex } from '../../harmos/securityTools';

type TopologyMode = 'connectome' | 'force' | 'rings';

interface PulseParticle {
  edgeIdx: number;
  t: number;
  speed: number;
  color: string;
  size: number;
}

interface SimPos {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
}

export function NeuronBrainPanel({ compact = false }: { compact?: boolean }) {
  const k = useKernel();
  const s = useKernelState();

  const [query, setQuery] = useState('');
  const [topology, setTopology] = useState<TopologyMode>('connectome');
  const [showAgents, setShowAgents] = useState(true);
  const [showMemories, setShowMemories] = useState(true);
  const [provFilter, setProvFilter] = useState<'all' | 'verified' | 'user' | 'model' | 'inferred'>('all');
  const [autoRotate, setAutoRotate] = useState(true);
  const [zoom, setZoom] = useState(1.05);
  const [selectedId, setSelectedId] = useState<string>('core:thalamus');
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);

  const rawGraph = useMemo(
    () => buildVaultConnectome(k, { query, includeAgents: showAgents, includeMemories: showMemories }),
    [k, s.vfs, s.memory, s.agents, s.tasks, query, showAgents, showMemories],
  );

  const graph = useMemo(() => {
    if (provFilter === 'all') return rawGraph;
    const keep = new Set(
      rawGraph.nodes
        .filter((n) => n.kind !== 'file' || n.provenance === provFilter)
        .map((n) => n.id),
    );
    return {
      ...rawGraph,
      nodes: rawGraph.nodes.filter((n) => keep.has(n.id)),
      edges: rawGraph.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
    };
  }, [rawGraph, provFilter]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rotRef = useRef({ yaw: 0.45, pitch: 0.24 });
  const dragRef = useRef<{ active: boolean; x: number; y: number; moved: boolean }>({ active: false, x: 0, y: 0, moved: false });
  const pulsesRef = useRef<PulseParticle[]>([]);
  const simRef = useRef<Map<string, SimPos>>(new Map());
  const screenHitsRef = useRef<Array<{ id: string; sx: number; sy: number; r: number; depth: number }>>([]);

  // Seed / maintain 3D positions when graph changes
  useEffect(() => {
    const map = simRef.current;
    graph.nodes.forEach((n, idx) => {
      if (!map.has(n.id)) {
        map.set(n.id, { x: n.sx, y: n.sy, z: n.sz, vx: 0, vy: 0, vz: 0 });
      } else if (topology === 'connectome') {
        const cur = map.get(n.id)!;
        cur.x = cur.x * 0.35 + n.sx * 0.65;
        cur.y = cur.y * 0.35 + n.sy * 0.65;
        cur.z = cur.z * 0.35 + n.sz * 0.65;
      } else if (topology === 'rings') {
        const ring = n.kind === 'core' ? 0 : n.kind === 'lobe' ? 0.36 : n.kind === 'file' ? 0.68 : 0.94;
        const a = (idx / Math.max(1, graph.nodes.length)) * Math.PI * 2 + (n.kind === 'agent' ? 0.4 : 0);
        const cur = map.get(n.id)!;
        cur.x = ring * Math.cos(a);
        cur.y = (n.kind === 'memory' ? -0.22 : n.kind === 'agent' ? 0.22 : 0) + Math.sin(a * 3) * 0.08;
        cur.z = ring * Math.sin(a);
      }
    });
  }, [graph, topology]);

  const fireWave = useCallback((onlyMatched = false) => {
    const arr = pulsesRef.current;
    graph.edges.forEach((e, idx) => {
      if (onlyMatched && !e.active) return;
      const color =
        e.kind === 'artifact' ? '#2dd4bf'
          : e.kind === 'reference' ? '#f472b6'
            : e.kind === 'engram' ? '#34d399'
              : e.kind === 'authorship' ? '#c084fc' : '#22d3ee';
      arr.push({
        edgeIdx: idx,
        t: Math.random() * 0.18,
        speed: 0.011 + Math.random() * 0.014,
        color,
        size: e.active ? 3.6 : 2.5,
      });
    });
    if (arr.length > 260) arr.splice(0, arr.length - 260);
  }, [graph.edges]);

  // Fire synaptic burst automatically on query match or vault mutation
  useEffect(() => {
    fireWave(!!query.trim());
  }, [query, s.vfs, s.memory.length, fireWave]);

  // High-DPI 60fps Neural Canvas Renderer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let tick = 0;

    const indexById = new Map<string, NeuronNode>();
    graph.nodes.forEach((n) => indexById.set(n.id, n));

    const neighborSet = new Set<string>();
    const focusTarget = hoverId || selectedId;
    if (focusTarget) {
      neighborSet.add(focusTarget);
      graph.edges.forEach((e) => {
        if (e.from === focusTarget) neighborSet.add(e.to);
        if (e.to === focusTarget) neighborSet.add(e.from);
      });
    }

    const stepForcePhysics = () => {
      if (topology !== 'force') return;
      const nodes = graph.nodes;
      const pos = simRef.current;
      for (let i = 0; i < nodes.length; i++) {
        const a = pos.get(nodes[i].id);
        if (!a || nodes[i].kind === 'core') continue;
        for (let j = i + 1; j < nodes.length; j++) {
          const b = pos.get(nodes[j].id);
          if (!b) continue;
          const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
          const d2 = dx * dx + dy * dy + dz * dz + 0.012;
          const f = 0.00055 / d2;
          a.vx += dx * f; a.vy += dy * f; a.vz += dz * f;
          b.vx -= dx * f; b.vy -= dy * f; b.vz -= dz * f;
        }
      }
      for (const e of graph.edges) {
        const a = pos.get(e.from), b = pos.get(e.to);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
        const target = e.kind === 'hierarchy' ? 0.34 : 0.52;
        const kSpring = (dist - target) * 0.016 * e.strength;
        const fx = (dx / dist) * kSpring, fy = (dy / dist) * kSpring, fz = (dz / dist) * kSpring;
        if (e.from !== 'core:thalamus') { a.vx += fx; a.vy += fy; a.vz += fz; }
        if (e.to !== 'core:thalamus') { b.vx -= fx; b.vy -= fy; b.vz -= fz; }
      }
      for (const n of nodes) {
        const p = pos.get(n.id);
        if (!p || n.kind === 'core') continue;
        p.vx = (p.vx - p.x * 0.004) * 0.86;
        p.vy = (p.vy - p.y * 0.004) * 0.86;
        p.vz = (p.vz - p.z * 0.004) * 0.86;
        p.x = Math.max(-1.25, Math.min(1.25, p.x + p.vx));
        p.y = Math.max(-1.0, Math.min(1.0, p.y + p.vy));
        p.z = Math.max(-1.25, Math.min(1.25, p.z + p.vz));
      }
    };

    const render = () => {
      tick++;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      const W = Math.max(320, Math.floor(rect.width));
      const H = Math.max(260, Math.floor(rect.height));
      if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
      }
      ctx.save();
      ctx.scale(dpr, dpr);

      // Deep neural cortex background
      const bg = ctx.createRadialGradient(W * 0.5, H * 0.48, 18, W * 0.5, H * 0.5, Math.max(W, H) * 0.72);
      bg.addColorStop(0, '#0a1326');
      bg.addColorStop(0.52, '#060a15');
      bg.addColorStop(1, '#03050b');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Subtle cortical meridian rings
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.055)';
      ctx.lineWidth = 1;
      const baseR = Math.min(W, H) * 0.37 * zoom;
      for (const mult of [0.38, 0.7, 1.0]) {
        ctx.beginPath();
        ctx.arc(W / 2, H / 2, baseR * mult, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (autoRotate && !dragRef.current.active && s.settings.motion) {
        rotRef.current.yaw += 0.0032;
      }

      stepForcePhysics();

      // Ambient resting pulses
      if (tick % 14 === 0 && graph.edges.length > 0 && pulsesRef.current.length < 90) {
        const idx = Math.floor(Math.random() * graph.edges.length);
        const e = graph.edges[idx];
        pulsesRef.current.push({
          edgeIdx: idx,
          t: 0,
          speed: 0.006 + Math.random() * 0.008,
          color: e.active ? '#22d3ee' : 'rgba(167, 139, 250, 0.85)',
          size: e.active ? 3.1 : 1.9,
        });
      }

      const cy = Math.cos(rotRef.current.yaw), sy = Math.sin(rotRef.current.yaw);
      const cp = Math.cos(rotRef.current.pitch), sp = Math.sin(rotRef.current.pitch);
      const scale = Math.min(W, H) * 0.40 * zoom;

      const projected = new Map<string, { sx: number; sy: number; z: number; persp: number; node: NeuronNode }>();
      for (const n of graph.nodes) {
        const p = simRef.current.get(n.id) || { x: n.sx, y: n.sy, z: n.sz };
        const x1 = p.x * cy - p.z * sy;
        const z1 = p.x * sy + p.z * cy;
        const y2 = p.y * cp - z1 * sp;
        const z2 = p.y * sp + z1 * cp;
        const persp = 2.4 / (2.4 + z2 * 0.85);
        projected.set(n.id, {
          sx: W * 0.5 + x1 * scale * persp,
          sy: H * 0.5 + y2 * scale * persp,
          z: z2,
          persp,
          node: n,
        });
      }

      // Draw Synaptic Axons (curved quadratic Bezier filaments pulled slightly toward thalamic center)
      for (const e of graph.edges) {
        const a = projected.get(e.from);
        const b = projected.get(e.to);
        if (!a || !b) continue;
        const highlighted =
          e.active ||
          (focusTarget && (e.from === focusTarget || e.to === focusTarget));
        const depthAlpha = Math.max(0.08, Math.min(0.85, ((a.persp + b.persp) * 0.5 - 0.62) * 1.1));
        const mx = (a.sx + b.sx) * 0.5 + (W * 0.5 - (a.sx + b.sx) * 0.5) * 0.14;
        const my = (a.sy + b.sy) * 0.5 + (H * 0.5 - (a.sy + b.sy) * 0.5) * 0.14;

        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.quadraticCurveTo(mx, my, b.sx, b.sy);

        if (highlighted) {
          ctx.strokeStyle = e.kind === 'reference'
            ? 'rgba(244, 114, 182, 0.72)'
            : e.kind === 'artifact'
              ? 'rgba(45, 212, 191, 0.78)'
              : 'rgba(34, 211, 238, 0.72)';
          ctx.lineWidth = 1.65;
        } else {
          ctx.strokeStyle = `rgba(148, 163, 184, ${(depthAlpha * 0.26).toFixed(3)})`;
          ctx.lineWidth = 0.85;
        }
        ctx.stroke();
      }

      // Draw Travelling Action-Potential Particles along Bezier Axons
      const nextPulses: PulseParticle[] = [];
      for (const p of pulsesRef.current) {
        const e = graph.edges[p.edgeIdx];
        if (!e) continue;
        const a = projected.get(e.from);
        const b = projected.get(e.to);
        if (!a || !b) continue;
        const t = p.t + p.speed;
        if (t < 1) {
          nextPulses.push({ ...p, t });
          const mx = (a.sx + b.sx) * 0.5 + (W * 0.5 - (a.sx + b.sx) * 0.5) * 0.14;
          const my = (a.sy + b.sy) * 0.5 + (H * 0.5 - (a.sy + b.sy) * 0.5) * 0.14;
          const omt = 1 - t;
          const px = omt * omt * a.sx + 2 * omt * t * mx + t * t * b.sx;
          const py = omt * omt * a.sy + 2 * omt * t * my + t * t * b.sy;

          const glow = ctx.createRadialGradient(px, py, 0, px, py, p.size * 3.4);
          glow.addColorStop(0, '#ffffff');
          glow.addColorStop(0.35, p.color);
          glow.addColorStop(1, 'rgba(34, 211, 238, 0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(px, py, p.size * 3.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      pulsesRef.current = nextPulses;

      // Sort Neurons back-to-front by Z depth
      const ordered = [...projected.values()].sort((a, b) => b.z - a.z);
      const hits: Array<{ id: string; sx: number; sy: number; r: number; depth: number }> = [];

      for (const item of ordered) {
        const { sx, sy, persp, node } = item;
        const isSelected = node.id === selectedId;
        const isHover = node.id === hoverId;
        const inFocus = !focusTarget || neighborSet.has(node.id);
        const pulseScale = node.matched ? 1 + 0.18 * Math.sin(tick * 0.12) : 1;
        const r = Math.max(2.8, node.radius * persp * pulseScale);

        hits.push({ id: node.id, sx, sy, r: Math.max(10, r + 5), depth: item.z });

        ctx.globalAlpha = inFocus ? Math.min(1, 0.45 + persp * 0.55) : 0.25;

        // Outer bioluminescent soma halo
        const haloRadius = r * (isSelected || isHover || node.matched ? 3.6 : 2.3);
        const halo = ctx.createRadialGradient(sx, sy, r * 0.2, sx, sy, haloRadius);
        halo.addColorStop(0, node.color);
        halo.addColorStop(0.45, node.color + '44');
        halo.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(sx, sy, haloRadius, 0, Math.PI * 2);
        ctx.fill();

        // Soma nucleus
        ctx.fillStyle = isSelected || isHover ? '#ffffff' : node.color;
        ctx.beginPath();
        if (node.kind === 'agent') {
          // Hexagonal ganglion for agents
          for (let h = 0; h < 6; h++) {
            const ang = (h / 6) * Math.PI * 2 - Math.PI / 6;
            const hx = sx + r * 1.15 * Math.cos(ang);
            const hy = sy + r * 1.15 * Math.sin(ang);
            if (h === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
          }
          ctx.closePath();
        } else if (node.kind === 'lobe' || node.kind === 'core') {
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
        } else {
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
        }
        ctx.fill();

        // Selection / match orbital reticle
        if (isSelected || isHover || node.matched) {
          ctx.strokeStyle = node.matched ? '#22d3ee' : '#e2e8f0';
          ctx.lineWidth = isSelected ? 1.6 : 1.1;
          ctx.beginPath();
          ctx.arc(sx, sy, r + 4.5, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Crisp HUD label for prominent / focused nodes
        if (isSelected || isHover || node.matched || node.kind === 'core' || node.kind === 'lobe' || (persp > 0.98 && node.kind === 'agent')) {
          ctx.font = `${isSelected || node.kind === 'core' ? '600 ' : ''}11px ui-monospace, SFMono-Regular, Menlo, monospace`;
          const text = node.label;
          const tw = ctx.measureText(text).width;
          const lx = sx - tw / 2;
          const ly = sy - r - 8;
          ctx.fillStyle = 'rgba(5, 8, 18, 0.78)';
          ctx.fillRect(lx - 4, ly - 10, tw + 8, 14);
          ctx.fillStyle = isSelected || node.matched ? '#67e8f9' : '#e2e8f0';
          ctx.fillText(text, lx, ly);
        }
      }
      ctx.globalAlpha = 1;
      screenHitsRef.current = hits.reverse(); // front-to-back for hit testing
      ctx.restore();

      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [graph, topology, zoom, autoRotate, selectedId, hoverId, s.settings.motion]);

  const pickNodeAt = (clientX: number, clientY: number): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    for (const h of screenHitsRef.current) {
      const dx = x - h.sx, dy = y - h.sy;
      if (dx * dx + dy * dy <= h.r * h.r) return h.id;
    }
    return null;
  };

  const selectedNode = graph.nodes.find((n) => n.id === selectedId) || graph.nodes[0];
  const selectedVNode = selectedNode?.path ? s.vfs[selectedNode.path] : undefined;
  const connectedEdges = useMemo(
    () => graph.edges.filter((e) => e.from === selectedNode?.id || e.to === selectedNode?.id),
    [graph.edges, selectedNode],
  );

  const createNeuralEngram = () => {
    const slug = (newTitle.trim() || `engram-${Date.now().toString(36)}`).replace(/[^a-zA-Z0-9._-]/g, '-');
    const path = `/home/harmos/HarmOS/notes/${slug.endsWith('.md') ? slug : slug + '.md'}`;
    const body = newBody.trim() || `# ${newTitle || slug}\n\nAuthored from NeuronBrain Cortex at ${new Date().toISOString()}.\nLinked to HarmOS Sovereign Vault.`;
    k.write('knowledge-node', path, body, 'user');
    setSelectedId(`file:${path}`);
    setNewTitle('');
    setNewBody('');
    setComposerOpen(false);
    fireWave(false);
  };

  const kindLabel: Record<NeuronKind, string> = {
    core: 'Thalamic Hub',
    lobe: 'Cortical Directory Lobe',
    file: 'Vault File Soma',
    agent: 'Specialist Agent Ganglion',
    memory: 'Long-Term Memory Engram',
    task: 'Executed Task Axon',
  };

  return (
    <div className="space-y-3">
      {/* Top Neural Control Strip */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-cyan-400/20 bg-[#060b17]/90 px-3 py-2.5">
        <div className="relative min-w-[210px] flex-1">
          <input
            className={cx(inputCls, 'border-cyan-400/25 pl-7')}
            placeholder="Neural recall: search vault files, memories, keywords…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="pointer-events-none absolute left-2.5 top-1.5 text-[12px] text-cyan-400">◎</span>
        </div>

        <div className="flex rounded-md border border-white/10 bg-black/40 p-0.5 text-[11px]">
          {([
            ['connectome', '3D Connectome'],
            ['force', 'Force Cortex'],
            ['rings', 'Thalamic Rings'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTopology(id)}
              className={cx(
                'rounded px-2 py-1 transition',
                topology === id ? 'bg-cyan-400/20 text-cyan-200' : 'text-slate-400 hover:text-slate-200',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <select
          className={cx(inputCls, 'w-36')}
          value={provFilter}
          onChange={(e) => setProvFilter(e.target.value as typeof provFilter)}
        >
          <option value="all">All provenance</option>
          <option value="verified">verified (cyan)</option>
          <option value="user">user (blue)</option>
          <option value="model">model (violet)</option>
          <option value="inferred">inferred (amber)</option>
        </select>

        <Btn tone="primary" onClick={() => fireWave(false)}>⚡ Fire Synaptic Wave</Btn>
        <Btn onClick={() => setComposerOpen((v) => !v)}>+ New Engram</Btn>
      </div>

      {composerOpen && (
        <div className="rounded-xl border border-cyan-400/30 bg-cyan-950/20 p-3">
          <div className="grid gap-2 sm:grid-cols-[220px_1fr_auto]">
            <input
              className={inputCls}
              placeholder="note-name.md"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
            <input
              className={inputCls}
              placeholder="Write vault note content (reference another filename like README.md to grow a cross-synapse)…"
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') createNeuralEngram(); }}
            />
            <Btn tone="primary" onClick={createNeuralEngram}>Imprint to Vault</Btn>
          </div>
        </div>
      )}

      {/* Main Cortex Canvas + Live Soma Inspector */}
      <div className={cx('grid gap-3', compact ? 'lg:grid-cols-[1fr_300px]' : 'lg:grid-cols-[1fr_340px]')}>
        <div className="relative overflow-hidden rounded-xl border border-cyan-400/20 bg-[#050914] shadow-inner">
          <canvas
            ref={canvasRef}
            className={cx('block w-full cursor-grab active:cursor-grabbing', compact ? 'h-[430px]' : 'h-[520px]')}
            onPointerDown={(e) => {
              dragRef.current = { active: true, x: e.clientX, y: e.clientY, moved: false };
            }}
            onPointerMove={(e) => {
              if (dragRef.current.active) {
                const dx = e.clientX - dragRef.current.x;
                const dy = e.clientY - dragRef.current.y;
                if (Math.abs(dx) + Math.abs(dy) > 3) dragRef.current.moved = true;
                rotRef.current.yaw += dx * 0.0065;
                rotRef.current.pitch = Math.max(-1.25, Math.min(1.25, rotRef.current.pitch + dy * 0.0065));
                dragRef.current.x = e.clientX;
                dragRef.current.y = e.clientY;
              } else {
                setHoverId(pickNodeAt(e.clientX, e.clientY));
              }
            }}
            onPointerUp={(e) => {
              const wasClick = !dragRef.current.moved;
              dragRef.current.active = false;
              if (wasClick) {
                const hit = pickNodeAt(e.clientX, e.clientY);
                if (hit) {
                  setSelectedId(hit);
                  fireWave(false);
                }
              }
            }}
            onPointerLeave={() => { dragRef.current.active = false; setHoverId(null); }}
            onWheel={(e) => {
              e.preventDefault();
              setZoom((z) => Math.max(0.55, Math.min(2.2, z - e.deltaY * 0.0008)));
            }}
          />

          {/* Top-left Telemetry Overlay */}
          <div className="pointer-events-none absolute left-3 top-3 space-y-1 rounded-lg border border-white/10 bg-black/60 px-2.5 py-2 backdrop-blur-md">
            <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-cyan-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
              NEURONBRAIN CORTEX · LIVE VAULT CONNECTOME
            </div>
            <div className="flex flex-wrap gap-3 font-mono text-[10.5px] text-slate-300">
              <span>{graph.nodes.length} neurons</span>
              <span>·</span>
              <span>{graph.stats.synapses} synapses</span>
              <span>·</span>
              <span>{graph.stats.files} vault files</span>
              {query.trim() && (
                <>
                  <span>·</span>
                  <span className="text-cyan-300">{graph.stats.activeMatches} recall hit(s)</span>
                </>
              )}
            </div>
          </div>

          {/* Bottom-left Legend & Camera Controls */}
          <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-black/65 px-2.5 py-1.5 text-[10px] backdrop-blur-md">
              {Object.entries(PROVENANCE_COLOR).map(([kName, col]) => (
                <span key={kName} className="inline-flex items-center gap-1 text-slate-300">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: col }} />
                  {kName}
                </span>
              ))}
              <span className="inline-flex items-center gap-1 text-slate-300">
                <span className="h-2 w-2 rounded-sm bg-fuchsia-400" />agent
              </span>
              <span className="inline-flex items-center gap-1 text-slate-300">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />memory
              </span>
            </div>

            <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/65 px-2 py-1 text-[11px] backdrop-blur-md">
              <label className="flex cursor-pointer items-center gap-1 pr-1 text-[10.5px] text-slate-300">
                <input type="checkbox" checked={showAgents} onChange={(e) => setShowAgents(e.target.checked)} className="accent-cyan-400" />
                Agents
              </label>
              <label className="flex cursor-pointer items-center gap-1 pr-1 text-[10.5px] text-slate-300">
                <input type="checkbox" checked={showMemories} onChange={(e) => setShowMemories(e.target.checked)} className="accent-cyan-400" />
                Memories
              </label>
              <button onClick={() => setAutoRotate((v) => !v)} className={cx('rounded border px-1.5 py-0.5 text-[10px]', autoRotate ? 'border-cyan-400/40 text-cyan-300' : 'border-white/10 text-slate-400')}>
                {autoRotate ? 'Orbit ON' : 'Orbit OFF'}
              </button>
              <button onClick={() => setZoom((z) => Math.min(2.2, z + 0.15))} className="rounded border border-white/10 px-1.5 py-0.5 text-slate-300 hover:bg-white/10">+</button>
              <button onClick={() => setZoom((z) => Math.max(0.55, z - 0.15))} className="rounded border border-white/10 px-1.5 py-0.5 text-slate-300 hover:bg-white/10">−</button>
              <button onClick={() => { rotRef.current = { yaw: 0.45, pitch: 0.24 }; setZoom(1.05); }} className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-slate-200">Reset</button>
            </div>
          </div>
        </div>

        {/* Right-hand Soma / Engram Inspector */}
        <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-3.5">
          {selectedNode ? (
            <>
              <div className="border-b border-white/10 pb-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-cyan-400">
                    {kindLabel[selectedNode.kind]}
                  </span>
                  {selectedNode.provenance && <Tag tone="info">{selectedNode.provenance}</Tag>}
                </div>
                <h4 className="mt-1 truncate text-[14px] font-semibold text-slate-100">{selectedNode.label}</h4>
                <p className="truncate font-mono text-[10.5px] text-slate-400">{selectedNode.path || selectedNode.sublabel}</p>
              </div>

              <div className="space-y-1">
                {selectedVNode && (
                  <>
                    <KV k="Payload size" v={fmtBytes(selectedVNode.content.length)} />
                    <KV k="Author" v={selectedVNode.author} />
                    <KV k="Updated" v={ago(selectedVNode.updatedAt)} />
                    <KV k="SHA-256" v={<span className="font-mono text-[10px] text-cyan-300">{sha256Hex(selectedVNode.content).slice(0, 20)}…</span>} />
                  </>
                )}
                <KV k="Connected synapses" v={connectedEdges.length} />
              </div>

              {selectedVNode && (
                <div className="min-h-0 flex-1">
                  <p className="mb-1 text-[10.5px] uppercase tracking-wider text-slate-500">Live Vault Engram Content</p>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/50 p-2.5 font-mono text-[11px] leading-relaxed text-slate-300">
                    {selectedVNode.content || '(empty file)'}
                  </pre>
                </div>
              )}

              <div>
                <p className="mb-1.5 text-[10.5px] uppercase tracking-wider text-slate-500">
                  Synaptic Pathways ({connectedEdges.length})
                </p>
                <div className="max-h-40 space-y-1 overflow-auto pr-1">
                  {connectedEdges.slice(0, 18).map((e) => {
                    const peerId = e.from === selectedNode.id ? e.to : e.from;
                    const peer = graph.nodes.find((n) => n.id === peerId);
                    if (!peer) return null;
                    return (
                      <button
                        key={e.id}
                        onClick={() => setSelectedId(peer.id)}
                        className="flex w-full items-center justify-between gap-2 rounded border border-white/10 bg-black/30 px-2 py-1 text-left text-[11px] hover:border-cyan-400/40"
                      >
                        <span className="truncate text-slate-200">{peer.label}</span>
                        <Tag tone={e.kind === 'reference' ? 'info' : e.kind === 'artifact' ? 'ok' : 'mute'}>{e.kind}</Tag>
                      </button>
                    );
                  })}
                  {!connectedEdges.length && <Empty>Isolated neuron — no active axons.</Empty>}
                </div>
              </div>
            </>
          ) : (
            <Empty>Click any glowing neuron soma in the 3D cortex to inspect it.</Empty>
          )}
        </div>
      </div>
    </div>
  );
}
