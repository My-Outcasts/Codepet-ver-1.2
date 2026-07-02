'use client';
// Overview — a 3D force-directed map of the company: the project at the center,
// departments orbiting it, each branching into its tasks. Obsidian-graph-view
// inspired, dark "map mode". Loaded client-only (three.js / WebGL).
//
// Nodes are seeded with deterministic 3D positions (project at origin,
// departments on a Fibonacci sphere, tasks clustered around their department) to
// avoid the degenerate all-at-origin case; the live simulation then relaxes it.
//
// Features: hover-highlight a node's neighborhood, bloom glow, responsive
// auto-fit framing, and gentle idle auto-rotate.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D, { type ForceGraphMethods } from 'react-force-graph-3d';
import SpriteText from 'three-spritetext';
import * as THREE from 'three';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - addons ship without bundled types in some setups
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { useApp } from '@/lib/store';
import { DEPTS, DCOL, type Dept, type Task } from '@/lib/data';
import { taskState } from '@/lib/helpers';
import { nextAction } from '@/lib/roadmap';
import {
  stageIndexOf,
  stageLabelOf,
  currentPhaseName,
  productProgress,
  companyProgress,
} from '@/lib/stages';

const HEX: Record<string, string> = {
  '--blue': '#3B82F6',
  '--clay': '#FF8C42',
  '--teal': '#2DD4BF',
  '--gold': '#FDB022',
  '--violet': '#A855F7',
  '--accent': '#8B5CF6',
  '--rose': '#FF6B9D',
};
const STATE_HEX: Record<string, string> = {
  'st-does': '#8B5CF6',
  'st-draft': '#FDB022',
  'st-you': '#3B82F6',
  'st-done': '#34D399',
};
const STATUS_ALPHA: Record<string, number> = { attention: 1, ready: 0.85, idle: 0.5 };
const DIM_NODE = 'rgba(150,150,170,0.09)';
const DIM_LINK = 'rgba(150,150,170,0.03)';

function rgba(hex: string, a: number) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16),
    g = parseInt(h.slice(2, 4), 16),
    b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

const DEPT_R = 140; // department orbit radius
const TASK_R = 46; // task cluster radius around a department
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

interface GNode {
  id: string;
  name: string;
  kind: 'project' | 'dept' | 'task';
  color: string;
  val: number;
  deptColor?: string;
  dept?: Dept;
  task?: Task;
  sub?: string;
  x: number;
  y: number;
  z: number;
}
interface GLink {
  source: string;
  target: string;
  color: string;
  hex: string;
  kind: 'pd' | 'dt';
  active?: boolean;
}

const linkId = (x: unknown): string =>
  typeof x === 'object' && x ? (x as GNode).id : (x as string);

export default function OverviewView() {
  const { openDept, runTask, briefDepartment, tick, brief, nextStep } = useApp();
  void tick;
  const wrapRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined);
  const bloomRef = useRef<any>(null);
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tookControlRef = useRef(false); // once the user moves/clicks, stop auto-fitting
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);

  // measure container (guarded so we don't churn renders / restart the sim)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth,
        h = el.clientHeight;
      setDims((d) => (Math.abs(d.w - w) > 1 || Math.abs(d.h - h) > 1 ? { w, h } : d));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { data, adj } = useMemo(() => {
    const nodes: GNode[] = [];
    const links: GLink[] = [];
    nodes.push({
      id: 'project',
      name: brief.projectName?.trim() || 'Your company',
      kind: 'project',
      color: '#D8D2F5',
      val: 12,
      x: 0,
      y: 0,
      z: 0,
    });
    DEPTS.forEach((d, di) => {
      const dHex = HEX[DCOL[d.k]] || HEX['--accent'];
      const alpha = STATUS_ALPHA[d.status] ?? 0.8;
      const done = d.tasks.filter((t) => t.done).length;
      const total = d.tasks.length;
      const did = `dept:${d.k}`;
      const yy = 1 - (di / (DEPTS.length - 1)) * 2;
      const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
      const th = GOLDEN * di;
      const dx = Math.cos(th) * rr * DEPT_R,
        dy = yy * DEPT_R,
        dz = Math.sin(th) * rr * DEPT_R;
      nodes.push({
        id: did,
        name: d.name,
        kind: 'dept',
        deptColor: dHex,
        color: rgba(dHex, alpha),
        val: d.status === 'attention' ? 7 : 5,
        dept: d,
        sub: `${done}/${total} done · ${d.status === 'attention' ? 'needs you' : d.status}`,
        x: dx,
        y: dy,
        z: dz,
      });
      links.push({
        source: 'project',
        target: did,
        color: rgba(dHex, 0.4),
        hex: dHex,
        kind: 'pd',
        active: d.status === 'attention',
      });
      d.tasks.forEach((t, i) => {
        const st = taskState(t, true);
        const tHex = STATE_HEX[st.cls] || '#94A3B8';
        const tid = `task:${d.k}:${i}`;
        const tyy = 1 - ((i + 0.5) / total) * 2;
        const trr = Math.sqrt(Math.max(0, 1 - tyy * tyy));
        const tth = GOLDEN * (i + 1);
        nodes.push({
          id: tid,
          name: t.t,
          kind: 'task',
          color: rgba(tHex, t.done ? 0.55 : 0.95),
          val: 1.1,
          dept: d,
          task: t,
          sub: `${d.name} · ${st.label}`,
          x: dx + Math.cos(tth) * trr * TASK_R,
          y: dy + tyy * TASK_R,
          z: dz + Math.sin(tth) * trr * TASK_R,
        });
        links.push({ source: did, target: tid, color: rgba(dHex, 0.16), hex: dHex, kind: 'dt' });
      });
    });
    const adj = new Map<string, Set<string>>();
    links.forEach((l) => {
      if (!adj.has(l.source)) adj.set(l.source, new Set());
      if (!adj.has(l.target)) adj.set(l.target, new Set());
      adj.get(l.source)!.add(l.target);
      adj.get(l.target)!.add(l.source);
    });
    return { data: { nodes, links }, adj };
  }, [tick, brief.projectName]);

  const inFocus = useCallback(
    (id: string) => !hoverId || id === hoverId || adj.get(hoverId)?.has(id),
    [hoverId, adj],
  );

  // The beacon reads byte's single next step (the same value chat reads, so they
  // never disagree). Resolve it to the live dept+task; until byte's pick lands (or
  // if it fails) fall back to the authored golden path so the beacon is never blank.
  const here = useMemo(() => {
    if (nextStep) {
      const dept = DEPTS.find((d) => d.k === nextStep.deptK);
      const task = dept?.tasks.find((t) => t.t === nextStep.taskTitle && !t.done);
      if (dept && task) return { dept, task };
    }
    const fb = nextAction();
    return fb ? { dept: fb.dept, task: fb.task } : null;
  }, [tick, nextStep]);

  // The beacon: the map node for the single next action. It's brightened and
  // gently pulses so one "start here" star stands out; the rest of the map keeps
  // its normal colors.
  const beaconId = useMemo(() => {
    if (!here) return null;
    const idx = here.dept.tasks.indexOf(here.task);
    return idx >= 0 ? `task:${here.dept.k}:${idx}` : null;
  }, [here]);
  const beaconHex = useMemo(
    () => (here ? STATE_HEX[taskState(here.task, true).cls] || '#FFFFFF' : '#FFFFFF'),
    [here],
  );
  // Slow breathe for the beacon (color/size only — never touches the sim). Runs
  // only while a beacon exists.
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (!beaconId) return;
    const id = setInterval(() => setBeat((b) => (b + 1) % 100000), 60);
    return () => clearInterval(id);
  }, [beaconId]);
  const pulse = 0.5 + 0.5 * Math.sin(beat * 0.16); // 0..1

  // Glide the camera to frame a node — the "jump to the step" on Start, so the
  // docked work panel opens with its node in view (map stays as context behind it).
  const flyTo = (nodeId: string | null) => {
    const fg = fgRef.current as any;
    if (!fg || !nodeId) return;
    const n = data.nodes.find((x) => x.id === nodeId);
    if (!n || !Number.isFinite(n.x)) return;
    tookControlRef.current = true; // don't let a settle-time auto-fit override this
    noteInteract(); // pause auto-rotate so the framed shot holds
    const aspect = dims.w / Math.max(1, dims.h);
    const k = 2.7 * Math.max(1, 1.2 / aspect);
    const look = { x: n.x * 0.45, y: n.y * 0.45, z: n.z * 0.45 };
    fg.cameraPosition({ x: n.x * k, y: n.y * k, z: n.z * k }, look, 900);
  };

  // gentle forces (positions are seeded)
  useEffect(() => {
    if (!dims.w) return;
    const fg = fgRef.current as any;
    if (!fg) return;
    try {
      fg.d3Force('charge')?.strength(-90);
      fg.d3Force('link')
        ?.distance((l: GLink) => (l.kind === 'pd' ? 95 : 36))
        .strength(0.25);
    } catch {
      /* forces not ready */
    }
  }, [dims.w, data]);

  // responsive framing — fit on settle + on resize
  useEffect(() => {
    if (!dims.w) return;
    if (bloomRef.current) bloomRef.current.setSize(dims.w, dims.h);
    const t1 = setTimeout(() => fitView(), 500);
    const t2 = setTimeout(() => fitView(), 2400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dims.w, dims.h, data]);

  // bloom glow (added once)
  useEffect(() => {
    if (!dims.w || bloomRef.current) return;
    const fg = fgRef.current as any;
    const composer = fg?.postProcessingComposer?.();
    if (!composer) return;
    // strength, radius, threshold — high threshold so only bright node cores
    // bloom (not the whole field, which washed the canvas to grey).
    // radius ~0 keeps the glow tight on each node instead of spreading a
    // full-frame haze across the coarse mip (which washed the field to purple).
    const bloom = new UnrealBloomPass(new THREE.Vector2(dims.w, dims.h), 0.45, 0.0, 0.8);
    composer.addPass(bloom);
    bloomRef.current = bloom;
  }, [dims.w]);

  // idle auto-rotate (pauses on interaction, resumes after ~3.5s idle)
  const noteInteract = useCallback(() => {
    tookControlRef.current = true;
    const c = (fgRef.current as any)?.controls?.();
    if (!c) return;
    c.autoRotate = false;
    if (idleRef.current) clearTimeout(idleRef.current);
    idleRef.current = setTimeout(() => {
      const cc = (fgRef.current as any)?.controls?.();
      if (cc) cc.autoRotate = true;
    }, 3500);
  }, []);

  useEffect(() => {
    if (!dims.w) return;
    const c = (fgRef.current as any)?.controls?.();
    if (c) {
      c.autoRotate = true;
      c.autoRotateSpeed = 0.5;
    }
    const el = wrapRef.current;
    el?.addEventListener('pointermove', noteInteract);
    el?.addEventListener('pointerdown', noteInteract);
    el?.addEventListener('wheel', noteInteract, { passive: true });
    return () => {
      el?.removeEventListener('pointermove', noteInteract);
      el?.removeEventListener('pointerdown', noteInteract);
      el?.removeEventListener('wheel', noteInteract);
    };
  }, [dims.w, noteInteract]);

  // The graph's world size is fixed (department orbit radius is constant), so a
  // fixed camera distance reliably frames it — scaled by viewport aspect so the
  // whole graph stays visible on narrower panels (e.g. when the chat is open).
  const fitView = () => {
    const fg = fgRef.current as any;
    if (!fg) return;
    const aspect = dims.w / Math.max(1, dims.h);
    const dist = 360 * Math.max(1, 1.55 / aspect);
    fg.cameraPosition({ x: 0, y: 0, z: dist }, { x: 0, y: 0, z: 0 }, 800);
  };

  const onEngineStop = () => {
    if (!tookControlRef.current) fitView();
  };

  const nodeThreeObject = (n: GNode): any => {
    if (n.kind === 'task') return undefined; // default sphere; label on hover
    const s = new SpriteText(n.name);
    s.color = '#FFFFFF';
    s.textHeight = n.kind === 'project' ? 6 : 4;
    s.fontFace = 'Inter, system-ui, sans-serif';
    s.fontWeight = n.kind === 'project' ? '700' : '600';
    // a dark pill behind the text so labels stay legible over bright / bloomed
    // nodes — the project label in particular sat invisibly on the white core.
    (s as any).backgroundColor = n.kind === 'project' ? 'rgba(7,5,16,0.85)' : 'rgba(7,5,16,0.7)';
    (s as any).padding = n.kind === 'project' ? 3 : 2;
    (s as any).borderRadius = 3;
    s.strokeColor = 'rgba(0,0,0,0.5)';
    s.strokeWidth = 0.5;
    const radius = Math.cbrt(n.val) * 2.2;
    // lift the label clear of the node (and its bloom), more so for the project
    (s as any).position.set(0, radius + (n.kind === 'project' ? 10 : 5), 0);
    return s;
  };

  return (
    <section
      className="view on"
      style={{ position: 'absolute', inset: 0, background: '#000000', overflow: 'hidden' }}
    >
      <div style={{ position: 'absolute', top: 22, left: 26, zIndex: 5, pointerEvents: 'none' }}>
        <h1 style={{ fontSize: 21, fontWeight: 600, color: '#F5F3FF', letterSpacing: '-.3px' }}>
          Overview
        </h1>
        <div style={{ fontSize: 13, color: 'rgba(245,243,255,.55)', marginTop: 3 }}>
          Your whole company as a living map — drag to orbit, scroll to zoom, hover to focus, click
          a node to open it.
        </div>
      </div>

      <ProgressCard stage={brief.stage} />

      {here && (
        <HereCard
          here={here}
          onStart={() => {
            flyTo(`dept:${here.dept.k}`); // glide to the department…
            briefDepartment(here.dept, here.task); // …byte arrives + orients you in chat
          }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          bottom: 20,
          left: 26,
          zIndex: 5,
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
          fontSize: 11.5,
          color: 'rgba(245,243,255,.7)',
          pointerEvents: 'none',
        }}
      >
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
            // pure black so the composer's linear->sRGB output stays black
            // (any non-zero dark value gets lifted to a visible purple-navy)
            backgroundColor="#000000"
            showNavInfo={false}
            controlType="orbit"
            nodeVal={(n) => {
              if (n.id === beaconId) return 2.8 + pulse * 1.0; // the "start here" star
              return hoverId === n.id ? n.val * 1.7 : n.val;
            }}
            nodeColor={(n) => {
              if (n.id === beaconId) return rgba(beaconHex, 0.9 + pulse * 0.1); // always lit
              return inFocus(n.id) ? n.color : DIM_NODE;
            }}
            nodeOpacity={0.95}
            nodeResolution={18}
            nodeRelSize={2.2}
            nodeThreeObjectExtend
            nodeThreeObject={nodeThreeObject}
            onNodeHover={(n) => {
              setHoverId(n ? (n as GNode).id : null);
              noteInteract();
            }}
            nodeLabel={(n) =>
              `<div style="font:600 12px Inter,sans-serif;color:#fff;background:rgba(12,10,23,.92);border:1px solid rgba(255,255,255,.14);padding:6px 9px;border-radius:8px;max-width:240px">${n.name}${n.sub ? `<div style='font-weight:500;color:rgba(255,255,255,.6);margin-top:2px;font-size:11px'>${n.sub}</div>` : ''}</div>`
            }
            linkColor={(l) => {
              if (!hoverId) return l.color;
              const s = linkId(l.source),
                t = linkId(l.target);
              return s === hoverId || t === hoverId ? rgba(l.hex, 0.9) : DIM_LINK;
            }}
            linkWidth={(l) => {
              const s = linkId(l.source),
                t = linkId(l.target);
              const hot = hoverId && (s === hoverId || t === hoverId);
              return hot ? 2.4 : l.kind === 'pd' ? 1.1 : 0.4;
            }}
            linkDirectionalParticles={(l) => {
              const s = linkId(l.source),
                t = linkId(l.target);
              if (hoverId && (s === hoverId || t === hoverId)) return 4;
              return l.active ? 3 : 0;
            }}
            linkDirectionalParticleWidth={1.8}
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
                fitView();
              }
            }}
          />
        )}
      </div>
    </section>
  );
}

interface HereInfo {
  dept: Dept;
  task: Task;
}

// The beacon — byte's single next move. One thing to read, one thing to do:
// the task, and Start (which opens the run loop). Nothing else. Fixed overlay.
function HereCard({ here, onStart }: { here: HereInfo; onStart: () => void }) {
  const st = taskState(here.task, true);
  return (
    <div
      style={{
        position: 'absolute',
        top: 92,
        left: 26,
        zIndex: 6,
        width: 264,
        padding: '15px 17px 16px',
        background: 'rgba(16,14,28,0.74)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 14,
        boxShadow: '0 8px 30px rgba(0,0,0,0.45)',
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: '1.4px',
          fontWeight: 700,
          color: 'rgba(245,243,255,.45)',
          textTransform: 'uppercase',
        }}
      >
        Next step
      </div>
      <div
        style={{
          fontSize: 15,
          fontWeight: 650,
          color: '#F7F5FF',
          letterSpacing: '-.2px',
          marginTop: 9,
          lineHeight: 1.35,
        }}
      >
        {here.task.t}
      </div>
      <div style={{ fontSize: 12, marginTop: 5, color: 'rgba(245,243,255,.5)' }}>
        {here.dept.name} · {st.label}
      </div>
      <button
        onClick={onStart}
        style={{
          marginTop: 15,
          fontFamily: 'inherit',
          fontSize: 13,
          fontWeight: 650,
          color: '#0B0616',
          background: '#F5F3FF',
          border: 0,
          borderRadius: 9,
          padding: '9px 24px',
          cursor: 'pointer',
        }}
      >
        Start
      </button>
    </div>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: dot,
          boxShadow: `0 0 6px ${dot}`,
        }}
      />
      {label}
    </span>
  );
}

// Compact progress read — where you are on the stage ladder, and how far Product
// vs Company have come. Display-only (pointer-events off so the map stays draggable).
function Meter({ label, pct, hex }: { label: string; pct: number; hex: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
      <span style={{ width: 54, fontSize: 11, color: 'rgba(245,243,255,.6)', flex: 'none' }}>
        {label}
      </span>
      <div
        style={{
          flex: 1,
          height: 5,
          borderRadius: 3,
          background: 'rgba(255,255,255,.08)',
          overflow: 'hidden',
        }}
      >
        <div style={{ width: `${pct}%`, height: '100%', background: hex, borderRadius: 3 }} />
      </div>
      <span
        style={{
          width: 30,
          textAlign: 'right',
          fontSize: 11,
          color: 'rgba(245,243,255,.7)',
          flex: 'none',
        }}
      >
        {pct}%
      </span>
    </div>
  );
}

function ProgressCard({ stage }: { stage?: string }) {
  const prod = productProgress();
  const comp = companyProgress();
  const label = stageLabelOf(stageIndexOf(stage));
  const phase = currentPhaseName(stage); // the roadmap phase — keeps this in step with the Roadmap
  return (
    <div
      style={{
        position: 'absolute',
        top: 22,
        right: 26,
        zIndex: 5,
        width: 216,
        padding: '13px 15px 14px',
        background: 'rgba(16,14,28,0.72)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,0.09)',
        borderRadius: 13,
        boxShadow: '0 8px 30px rgba(0,0,0,0.45)',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: '1.2px',
          fontWeight: 700,
          color: 'rgba(245,243,255,.42)',
          textTransform: 'uppercase',
        }}
      >
        Progress
      </div>
      {(phase || label) && (
        <div style={{ fontSize: 12.5, fontWeight: 600, color: '#F5F3FF', marginTop: 6 }}>
          {phase || 'In progress'}
          {label && (
            <span style={{ color: 'rgba(245,243,255,.5)', fontWeight: 500 }}> · {label}</span>
          )}
        </div>
      )}
      <Meter label="Product" pct={prod.pct} hex="#8B5CF6" />
      <Meter label="Company" pct={comp.pct} hex="#2DD4BF" />
    </div>
  );
}
