'use client';
// Overview — a 3D force-directed map of the company: the project at the center,
// departments orbiting it, each branching into its tasks. Obsidian-graph-view
// inspired, dark "map mode". Loaded client-only (three.js / WebGL).
//
// Nodes are seeded with deterministic 3D positions (project at the origin,
// departments on a Fibonacci sphere, tasks clustered around their department).
// This avoids the degenerate all-at-origin case where the symmetric many-body
// force can't separate coincident nodes, and gives a clean layout immediately;
// the live simulation then just relaxes it and reacts to dragging.
import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D, { type ForceGraphMethods } from 'react-force-graph-3d';
import SpriteText from 'three-spritetext';
import { useApp } from '@/lib/store';
import { DEPTS, DCOL, type Dept, type Task } from '@/lib/data';
import { taskState } from '@/lib/helpers';

const HEX: Record<string, string> = {
  '--blue': '#3B82F6', '--clay': '#FF8C42', '--teal': '#2DD4BF', '--gold': '#FDB022',
  '--violet': '#A855F7', '--accent': '#8B5CF6', '--rose': '#FF6B9D',
};
const STATE_HEX: Record<string, string> = {
  'st-does': '#8B5CF6', 'st-draft': '#FDB022', 'st-you': '#3B82F6', 'st-done': '#34D399',
};
const STATUS_ALPHA: Record<string, number> = { attention: 1, ready: 0.85, idle: 0.5 };

function rgba(hex: string, a: number) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

const DEPT_R = 140; // department orbit radius
const TASK_R = 46;  // task cluster radius around a department
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

interface GNode {
  id: string; name: string; kind: 'project' | 'dept' | 'task';
  color: string; val: number; deptColor?: string;
  dept?: Dept; task?: Task; sub?: string;
  x: number; y: number; z: number;
}
interface GLink { source: string; target: string; color: string; kind: 'pd' | 'dt'; active?: boolean; }

export default function OverviewView() {
  const { openDept, runTask, tick } = useApp();
  void tick;
  const wrapRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  // measure container (guarded so we don't churn renders / restart the sim)
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const measure = () => {
      const w = el.clientWidth, h = el.clientHeight;
      setDims((d) => (Math.abs(d.w - w) > 1 || Math.abs(d.h - h) > 1 ? { w, h } : d));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = useMemo(() => {
    const nodes: GNode[] = [];
    const links: GLink[] = [];
    nodes.push({ id: 'project', name: 'Codepet', kind: 'project', color: '#F4F1FF', val: 22, x: 0, y: 0, z: 0 });
    DEPTS.forEach((d, di) => {
      const dHex = HEX[DCOL[d.k]] || HEX['--accent'];
      const alpha = STATUS_ALPHA[d.status] ?? 0.8;
      const done = d.tasks.filter((t) => t.done).length;
      const total = d.tasks.length;
      const did = `dept:${d.k}`;
      // Fibonacci-sphere placement around the project
      const yy = 1 - (di / (DEPTS.length - 1)) * 2;
      const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
      const th = GOLDEN * di;
      const dx = Math.cos(th) * rr * DEPT_R, dy = yy * DEPT_R, dz = Math.sin(th) * rr * DEPT_R;
      nodes.push({
        id: did, name: d.name, kind: 'dept', deptColor: dHex,
        color: rgba(dHex, alpha), val: d.status === 'attention' ? 7 : 5, dept: d,
        sub: `${done}/${total} done · ${d.status === 'attention' ? 'needs you' : d.status}`,
        x: dx, y: dy, z: dz,
      });
      links.push({ source: 'project', target: did, color: rgba(dHex, 0.4), kind: 'pd', active: d.status === 'attention' });
      d.tasks.forEach((t, i) => {
        const st = taskState(t, true);
        const tHex = STATE_HEX[st.cls] || '#94A3B8';
        const tid = `task:${d.k}:${i}`;
        // small sphere of tasks around the department node
        const tyy = 1 - ((i + 0.5) / total) * 2;
        const trr = Math.sqrt(Math.max(0, 1 - tyy * tyy));
        const tth = GOLDEN * (i + 1);
        nodes.push({
          id: tid, name: t.t, kind: 'task', color: rgba(tHex, t.done ? 0.55 : 0.95), val: 1.1,
          dept: d, task: t, sub: `${d.name} · ${st.label}`,
          x: dx + Math.cos(tth) * trr * TASK_R, y: dy + tyy * TASK_R, z: dz + Math.sin(tth) * trr * TASK_R,
        });
        links.push({ source: did, target: tid, color: rgba(dHex, 0.16), kind: 'dt' });
      });
    });
    return { nodes, links };
  }, [tick]);

  // gentle forces (positions are already seeded) + frame the camera
  useEffect(() => {
    if (!dims.w) return;
    const fg = fgRef.current as any;
    if (!fg) return;
    try {
      fg.d3Force('charge')?.strength(-90);
      fg.d3Force('link')?.distance((l: GLink) => (l.kind === 'pd' ? 95 : 36)).strength(0.25);
    } catch { /* forces not ready */ }
    const frame = () => { const g = fgRef.current as any; if (g) g.cameraPosition({ x: 0, y: 0, z: 360 }, { x: 0, y: 0, z: 0 }, 800); };
    const t1 = setTimeout(frame, 600);
    const t2 = setTimeout(frame, 2600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [dims.w, data]);

  const onEngineStop = () => { const g = fgRef.current as any; if (g) g.cameraPosition({ x: 0, y: 0, z: 360 }, { x: 0, y: 0, z: 0 }, 800); };

  const nodeThreeObject = (n: GNode): any => {
    if (n.kind === 'task') return undefined; // default sphere; label on hover
    const s = new SpriteText(n.name);
    s.color = n.kind === 'project' ? '#FFFFFF' : '#EDEAFB';
    s.textHeight = n.kind === 'project' ? 7 : 4;
    s.fontFace = 'Inter, system-ui, sans-serif';
    s.fontWeight = n.kind === 'project' ? '700' : '600';
    s.strokeColor = 'rgba(8,6,18,0.9)';
    s.strokeWidth = 1.6;
    const radius = Math.cbrt(n.val) * 2.2;
    (s as any).position.set(0, radius + 4, 0);
    return s;
  };

  return (
    <section className="view on" style={{ position: 'absolute', inset: 0, background: '#0c0a17', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 22, left: 26, zIndex: 5, pointerEvents: 'none' }}>
        <h1 style={{ fontSize: 21, fontWeight: 600, color: '#F5F3FF', letterSpacing: '-.3px' }}>Overview</h1>
        <div style={{ fontSize: 13, color: 'rgba(245,243,255,.55)', marginTop: 3 }}>Your whole company as a living map — drag to orbit, scroll to zoom, click a node to open it.</div>
      </div>
      <div style={{ position: 'absolute', bottom: 20, left: 26, zIndex: 5, display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11.5, color: 'rgba(245,243,255,.7)', pointerEvents: 'none' }}>
        <Legend dot="#F4F1FF" label="Project" />
        <Legend dot="#8B5CF6" label="byte does" />
        <Legend dot="#FDB022" label="Needs approval" />
        <Legend dot="#3B82F6" label="Needs you" />
        <Legend dot="#34D399" label="Done" />
      </div>

      <div ref={wrapRef} style={{ position: 'absolute', inset: 0 }}>
        {dims.w > 0 && (
          <ForceGraph3D<GNode, GLink>
            ref={fgRef}
            width={dims.w}
            height={dims.h}
            graphData={data}
            backgroundColor="#0c0a17"
            showNavInfo={false}
            nodeVal={(n) => n.val}
            nodeColor={(n) => n.color}
            nodeOpacity={0.92}
            nodeResolution={18}
            nodeRelSize={2.2}
            nodeThreeObjectExtend
            nodeThreeObject={nodeThreeObject}
            nodeLabel={(n) => `<div style="font:600 12px Inter,sans-serif;color:#fff;background:rgba(12,10,23,.92);border:1px solid rgba(255,255,255,.14);padding:6px 9px;border-radius:8px;max-width:240px">${n.name}${n.sub ? `<div style='font-weight:500;color:rgba(255,255,255,.6);margin-top:2px;font-size:11px'>${n.sub}</div>` : ''}</div>`}
            linkColor={(l) => l.color}
            linkWidth={(l) => (l.kind === 'pd' ? 1.1 : 0.4)}
            linkDirectionalParticles={(l) => (l.active ? 3 : 0)}
            linkDirectionalParticleWidth={1.6}
            linkDirectionalParticleSpeed={0.006}
            enableNodeDrag
            cooldownTime={4000}
            d3AlphaDecay={0.05}
            d3VelocityDecay={0.45}
            onEngineStop={onEngineStop}
            onNodeClick={(n) => {
              if (n.kind === 'dept' && n.dept) openDept(n.dept.k);
              else if (n.kind === 'task' && n.task && n.dept) {
                if (n.task.done) openDept(n.dept.k);
                else runTask(n.task, n.dept, n.task.who === 'you');
              } else if (n.kind === 'project') {
                fgRef.current?.zoomToFit(700, 90);
              }
            }}
          />
        )}
      </div>
    </section>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, boxShadow: `0 0 6px ${dot}` }} />
      {label}
    </span>
  );
}
