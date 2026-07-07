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
import { nextAction, stageWatermark } from '@/lib/roadmap';
import { stageComplete, nextStageOf, nextPhaseName } from '@/lib/stages';
import { examplePlanBanner } from '@/lib/examplePlan';
import StageRibbon from '@/components/views/overview/StageRibbon';
import OverviewProgressHud from '@/components/views/overview/OverviewProgressHud';
import { overviewProgress, deptProgress } from '@/lib/overview/progress';
import { StageDrawer } from '@/components/views/overview/StageDrawer';
import OverviewIntro from '@/components/views/overview/OverviewIntro';
import { INTRO_SEEN_KEY, introInitialPhase, type IntroPhase } from '@/lib/overviewIntro';

// First-run "seen" flag. Reads default to seen (true) on failure so we never
// re-trap a user behind a broken storage read.
const readIntroSeen = () => {
  try {
    return !!localStorage.getItem(INTRO_SEEN_KEY);
  } catch {
    return true;
  }
};
const markIntroSeen = () => {
  try {
    localStorage.setItem(INTRO_SEEN_KEY, '1');
  } catch {
    /* ignore */
  }
};

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
// byte's "do this next" guide color — deliberately outside the state palette
// (purple/gold/blue/green) so the beacon + its trail pop from the field.
const BEACON_HEX = '#7DE3FF';

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
  done?: number;
  total?: number;
  pct?: number;
  later?: boolean;
  reveal?: boolean;
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

// A billboarded ring sprite: a faint full track + an arc filled clockwise from the top to
// `pct`. Drawn on a canvas → CanvasTexture → Sprite, so it always faces the camera (reads
// as a clean circle at any orbit angle) with no per-frame screen projection.
function makeRingSprite(pct: number, colorHex: string, size: number, parked = false): THREE.Sprite {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const cx = S / 2;
  const cy = S / 2;
  const r = S * 0.4;
  const lw = S * 0.08;
  ctx.lineCap = 'round';
  if (parked) {
    // Dormant "for later": a single dashed hollow outline, muted — no track, no fill.
    ctx.setLineDash([S * 0.06, S * 0.06]);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(200,190,230,0.42)';
    ctx.lineWidth = lw * 0.7;
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    // track
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = lw;
    ctx.stroke();
    // filled arc
    if (pct > 0) {
      const start = -Math.PI / 2;
      const end = start + (Math.min(100, pct) / 100) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, start, end);
      ctx.strokeStyle = colorHex;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(size, size, 1);
  return sprite;
}

// A soft radial glow the UnrealBloomPass amplifies — used to flash a just-unlocked branch.
function makeGlowSprite(colorHex: string, size: number): THREE.Sprite {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, colorHex);
  g.addColorStop(0.4, colorHex);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  sprite.scale.set(size, size, 1);
  return sprite;
}

export default function OverviewView() {
  const {
    openDept,
    runTask,
    portalToTask,
    tick,
    brief,
    nextStep,
    portalSignal,
    advanceStage,
    selStage,
    drawerOpen,
    projectAnalysis,
    analysisLoading,
    ensureProjectAnalysis,
    planTailored,
    scaffoldFailed,
    regenerateCompany,
    growthSignal,
    clearGrowthSignal,
  } = useApp();
  const examplePlan = examplePlanBanner({ planTailored, scaffoldFailed });
  void tick; // (already present) keeps the reads below live
  const progress = overviewProgress(DEPTS);
  const nextMilestone = nextPhaseName(brief.stage);
  // First-run spotlight handoff. OverviewView owns the phase + the localStorage
  // flag; OverviewIntro / ByteGuide / the reopen chip are thin consumers.
  // OverviewView is imported ssr:false, so reading localStorage in the lazy
  // initializer is safe.
  const [introPhase, setIntroPhase] = useState<IntroPhase>(() =>
    introInitialPhase(readIntroSeen()),
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const calloutRef = useRef<HTMLDivElement>(null);
  const [beaconFlip, setBeaconFlip] = useState(false);
  const beaconFlipRef = useRef(false);
  const hereRef = useRef<HereInfo | null>(null);
  const fgRef = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined);
  const bloomRef = useRef<any>(null);
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tookControlRef = useRef(false); // once the user moves/clicks, stop auto-fitting
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  // Transient unlock reveal: which dept keys just grew in, cleared after the flash.
  const [revealKeys, setRevealKeys] = useState<Set<string>>(() => new Set());

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
      const dp = deptProgress(d);
      const done = dp.done;
      const total = dp.total;
      const did = `dept:${d.k}`;
      const yy = 1 - (di / (DEPTS.length - 1)) * 2;
      const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
      const th = GOLDEN * di;
      const dx = Math.cos(th) * rr * DEPT_R,
        dy = yy * DEPT_R,
        dz = Math.sin(th) * rr * DEPT_R;
      const allDone = total > 0 && done === total;
      nodes.push({
        id: did,
        name: d.name,
        kind: 'dept',
        deptColor: dHex,
        color: rgba(dHex, allDone ? 0.32 : alpha),
        val: allDone ? 4 : d.status === 'attention' ? 7 : 5,
        dept: d,
        sub: d.later
          ? 'for later'
          : `${done}/${total} done · ${d.status === 'attention' ? 'needs you' : d.status}`,
        done,
        total,
        pct: dp.pct,
        later: !!d.later,
        reveal: revealKeys.has(d.k),
        x: dx,
        y: dy,
        z: dz,
      });
      links.push({
        source: 'project',
        target: did,
        color: rgba(dHex, d.later ? 0.12 : 0.4),
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
          color: rgba(tHex, t.done ? 0.28 : 0.95),
          val: t.done ? 0.7 : 1.1,
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
  }, [tick, brief.projectName, revealKeys]);

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
  // When the founder opens a stage that isn't where they are now, the map has no
  // real nodes to show for it (tasks are scaffolded for the current stage only),
  // so we dim the live map to background and let the drawer carry that stage's
  // authored checklist. Opening the current stage keeps the map fully lit.
  const mapDimmed = drawerOpen && selStage !== stageWatermark();
  // Slow breathe for the beacon (color/size only — never touches the sim). Runs
  // only while a beacon exists.
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (!beaconId) return;
    const id = setInterval(() => setBeat((b) => (b + 1) % 100000), 60);
    return () => clearInterval(id);
  }, [beaconId]);
  const pulse = 0.5 + 0.5 * Math.sin(beat * 0.16); // 0..1

  hereRef.current = here;
  // The lit trail byte draws from the center to your move: project → the active
  // department → the next task. These two link keys get the guide color +
  // particles that stream OUTWARD (source→target) from "Your company" to the node.
  const pathLinkIds = useMemo(() => {
    if (!here) return new Set<string>();
    const dk = here.dept.k;
    const idx = here.dept.tasks.indexOf(here.task);
    return new Set([`project->dept:${dk}`, `dept:${dk}->task:${dk}:${idx}`]);
  }, [here]);
  const beaconNode = useMemo(
    () => data.nodes.find((n) => n.id === beaconId) ?? null,
    [data, beaconId],
  );
  // byte's on-map callout shows whenever there's a live next move (not while a
  // non-current stage drawer has dimmed the map, and not when the stage is done).
  const showCallout = !!beaconId && !mapDimmed && !stageComplete();

  // Tether the callout to the beacon node: project its live 3D position to screen
  // coords each frame and move the HTML callout there. Writes the DOM transform
  // directly (no React re-render per frame); hides it if the node goes off-screen.
  useEffect(() => {
    if (!showCallout || !dims.w) return;
    let raf = 0;
    const draw = () => {
      const fg = fgRef.current;
      const el = calloutRef.current;
      if (fg && el && beaconNode && Number.isFinite(beaconNode.x)) {
        const sc = fg.graph2ScreenCoords(beaconNode.x, beaconNode.y, beaconNode.z);
        if (
          sc &&
          Number.isFinite(sc.x) &&
          sc.x > -240 &&
          sc.x < dims.w + 240 &&
          sc.y > -240 &&
          sc.y < dims.h + 240
        ) {
          el.style.opacity = '1';
          el.style.transform = `translate(${sc.x}px, ${sc.y}px)`;
          // Flip to the left before the right-placed card (offset 18 + width 250) would
          // clip the right edge — robust on narrow panels (e.g. chat open), not just a
          // fixed fraction of the width.
          const nextFlip = sc.x + 268 > dims.w;
          if (nextFlip !== beaconFlipRef.current) {
            beaconFlipRef.current = nextFlip;
            setBeaconFlip(nextFlip);
          }
        } else {
          el.style.opacity = '0';
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [showCallout, dims.w, dims.h, beaconNode]);

  // Glide the camera to frame a node — the "jump to the step" on Start, so the
  // docked work panel opens with its node in view (map stays as context behind it).
  const flyTo = (nodeId: string | null, ms = 900) => {
    const fg = fgRef.current as any;
    if (!fg || !nodeId) return;
    const n = data.nodes.find((x) => x.id === nodeId);
    if (!n || !Number.isFinite(n.x)) return;
    tookControlRef.current = true; // don't let a settle-time auto-fit override this
    noteInteract(); // pause auto-rotate so the framed shot holds
    const aspect = dims.w / Math.max(1, dims.h);
    const k = 2.7 * Math.max(1, 1.2 / aspect);
    const look = { x: n.x * 0.45, y: n.y * 0.45, z: n.z * 0.45 };
    fg.cameraPosition({ x: n.x * k, y: n.y * k, z: n.z * k }, look, ms);
  };

  // A portal was requested from elsewhere (e.g. the Roadmap's Start) — glide the
  // camera to that department once the map is mounted. The signal's `n` changes per
  // request, so re-portaling to the same dept still fires. Small delay lets the graph
  // ref settle after a view switch.
  useEffect(() => {
    if (!portalSignal || !dims.w) return;
    const id = setTimeout(() => flyTo(`dept:${portalSignal.deptK}`), 220);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portalSignal, dims.w]);

  // A re-scaffold just unlocked one or more parked branches — flash the reveal
  // (glow halo on the affected dept nodes), gently ease the camera toward the
  // first one, and hold a transient "N areas unlocked" tag for a few seconds.
  //
  // Adopt a newly-published growthSignal into revealKeys at render time (a ref
  // diff against the last-seen signal, not a synchronous setState-in-effect) —
  // same "don't setState synchronously inside an effect" convention as the rest
  // of this codebase. The imperative side effects (camera ease + the auto-clear
  // timer) still live in the effect below, gated on the same signal.
  const lastGrowthSignalRef = useRef<typeof growthSignal>(null);
  if (growthSignal && growthSignal !== lastGrowthSignalRef.current) {
    lastGrowthSignalRef.current = growthSignal;
    if (growthSignal.unlockedKeys.length > 0) setRevealKeys(new Set(growthSignal.unlockedKeys));
  }
  useEffect(() => {
    if (!growthSignal || growthSignal.unlockedKeys.length === 0) return;
    // Gentle camera ease toward the first newly-grown branch (skip under reduced motion).
    if (!introReduceMotion()) flyTo(`dept:${growthSignal.unlockedKeys[0]}`, 900);
    clearGrowthSignal(); // consume once — prevents replay on remount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [growthSignal, clearGrowthSignal]);
  // Auto-clear the reveal glow/tag ~3s after it's adopted. Decoupled from growthSignal
  // (which is cleared the instant the signal is consumed, above) so consuming it can't
  // cancel this timer early.
  useEffect(() => {
    if (revealKeys.size === 0) return;
    const t = setTimeout(() => setRevealKeys(new Set()), 3000);
    return () => clearTimeout(t);
  }, [revealKeys]);

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
    // Only auto-fit while the user (or a Start/portal) hasn't framed something.
    // Without this guard, opening the chat panel resizes the container and yanks
    // the camera off the department a Start just flew to.
    const fit = () => {
      if (!tookControlRef.current) fitView();
    };
    const t1 = setTimeout(fit, 500);
    const t2 = setTimeout(fit, 2400);
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
      if (cc && !hereRef.current) cc.autoRotate = true; // stay at rest while a move is pinned
    }, 3500);
  }, []);

  useEffect(() => {
    if (!dims.w) return;
    const c = (fgRef.current as any)?.controls?.();
    if (c) {
      // Rest the map (no auto-spin) while byte is pointing at a move, so the
      // tethered callout holds steady; gently spin only when there's no move.
      c.autoRotate = !here;
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
  }, [dims.w, noteInteract, here]);

  // The graph's world size is fixed (department orbit radius is constant), so a
  // fixed camera distance reliably frames it — scaled by viewport aspect so the
  // whole graph stays visible on narrower panels (e.g. when the chat is open).
  const fitView = () => {
    const fg = fgRef.current as any;
    if (!fg) return;
    const aspect = dims.w / Math.max(1, dims.h);
    const dist = 360 * Math.max(1, 1.55 / aspect);
    // Bias the composition a touch left so the beacon card (tethered to the right of its
    // node) has clear space and the project center never sits under it.
    const bx = DEPT_R * 0.35;
    fg.cameraPosition({ x: bx, y: 0, z: dist }, { x: bx, y: 0, z: 0 }, 800);
  };

  const onEngineStop = () => {
    if (!tookControlRef.current) fitView();
  };

  const nodeThreeObject = (n: GNode): any => {
    if (n.kind === 'task') return undefined; // default sphere; label on hover

    // Label — for departments, append the progress count.
    const total = n.total ?? 0;
    const done = n.done ?? 0;
    const labelText =
      n.kind === 'dept' && total > 0
        ? done === total
          ? `${n.name} ✓`
          : `${n.name}  ${done}/${total}`
        : n.name;
    const s = new SpriteText(labelText);
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

    // Project node: label only (overall progress lives in the hero HUD).
    if (n.kind !== 'dept') return s;

    // Department node.
    if (n.later) {
      // Parked "for later": hollow dashed outline + muted two-line label, no count/ring.
      const label = new SpriteText(n.name);
      label.color = 'rgba(220,214,245,0.6)';
      label.textHeight = 4;
      label.fontFace = 'Inter, system-ui, sans-serif';
      label.fontWeight = '600';
      (label as any).backgroundColor = 'rgba(7,5,16,0.6)';
      (label as any).padding = 2;
      (label as any).borderRadius = 3;
      (label as any).position.set(0, radius + 5, 0);
      const sub = new SpriteText('for later');
      sub.color = 'rgba(200,190,230,0.4)';
      sub.textHeight = 2.6;
      sub.fontFace = 'Inter, system-ui, sans-serif';
      (sub as any).position.set(0, radius + 1.5, 0);
      const parkedRing = makeRingSprite(0, n.deptColor ?? '#8B5CF6', radius * 3.4, true);
      const group = new THREE.Group();
      group.add(parkedRing);
      group.add(label);
      group.add(sub);
      return group;
    }

    // Department node: label + progress ring around the node.
    const ringColor = total > 0 && done === total ? '#34D399' : (n.deptColor ?? '#8B5CF6');
    const ring = makeRingSprite(n.pct ?? 0, ringColor, radius * 3.4); // tune multiplier on preview
    const group = new THREE.Group();
    group.add(ring);
    group.add(s);
    if (n.reveal) {
      const halo = makeGlowSprite(n.deptColor ?? '#7DE3FF', radius * 5.5);
      group.add(halo);
    }
    return group;
  };

  // Skip the camera glide (jump-cut) for users who prefer reduced motion.
  const introReduceMotion = () =>
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // CTA in the intro: remember it's seen, then either fly to the lit beacon or
  // (no live move) recenter the whole map, and enter the spotlight.
  const handleIntroReveal = () => {
    markIntroSeen();
    // Only enter the spotlight when the beacon callout will actually render
    // (ByteGuide is gated by showCallout) — otherwise there's nothing to
    // illuminate, so just recenter the map and finish.
    if (showCallout && beaconId) {
      flyTo(beaconId, introReduceMotion() ? 0 : 900);
      setIntroPhase('spotlight');
    } else {
      fitView();
      setIntroPhase('done');
    }
  };

  // Backdrop click: dismiss without flying, but still mark it seen.
  const handleIntroDismiss = () => {
    markIntroSeen();
    setIntroPhase('done');
  };

  // The spotlight is a light touch, not a second modal — auto-settle after a beat.
  useEffect(() => {
    if (introPhase !== 'spotlight') return;
    const id = setTimeout(() => setIntroPhase('done'), 6000);
    return () => clearTimeout(id);
  }, [introPhase]);

  // Kick off byte's one-time project analysis as soon as the intro is showing
  // (or about to show), so the briefing card has something to render instead of
  // sitting in the loading state longer than necessary. ensureProjectAnalysis is
  // idempotent — a persisted or in-flight analysis short-circuits this.
  useEffect(() => {
    if (introPhase === 'intro') ensureProjectAnalysis();
  }, [introPhase, ensureProjectAnalysis]);

  // Settle the spotlight the moment the founder actually grabs the map
  // (deliberate pointer-down or wheel-zoom) — not on mere mouse movement.
  useEffect(() => {
    if (introPhase !== 'spotlight') return;
    const el = wrapRef.current;
    if (!el) return;
    const settle = () => setIntroPhase('done');
    el.addEventListener('pointerdown', settle);
    el.addEventListener('wheel', settle, { passive: true });
    return () => {
      el.removeEventListener('pointerdown', settle);
      el.removeEventListener('wheel', settle);
    };
  }, [introPhase]);

  return (
    <section
      className="view on"
      style={{ position: 'absolute', inset: 0, background: '#000000', overflow: 'hidden' }}
    >
      {introPhase === 'intro' && (
        <OverviewIntro
          analysis={projectAnalysis}
          analysisLoading={analysisLoading}
          onReveal={handleIntroReveal}
          onDismiss={handleIntroDismiss}
        />
      )}
      {introPhase === 'spotlight' && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 3,
            pointerEvents: 'none',
            background:
              'radial-gradient(closest-side at 50% 50%, rgba(4,3,10,0) 45%, rgba(4,3,10,0.5) 100%)',
          }}
        />
      )}
      <StageRibbon />
      {revealKeys.size > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 52,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 7,
            pointerEvents: 'none',
            padding: '6px 14px',
            borderRadius: 999,
            background: 'rgba(16,14,28,0.92)',
            border: '1px solid rgba(125,227,255,0.4)',
            color: '#7DE3FF',
            fontSize: 12,
            fontWeight: 700,
            fontFamily: 'inherit',
            boxShadow: '0 0 20px rgba(125,227,255,0.25)',
          }}
        >
          ✦ {revealKeys.size} {revealKeys.size === 1 ? 'area' : 'areas'} unlocked
        </div>
      )}
      <OverviewProgressHud progress={progress} nextStage={nextMilestone} />

      <div
        style={{
          position: 'absolute',
          top: 58,
          left: 26,
          right: 26,
          maxWidth: 640,
          zIndex: 5,
          pointerEvents: 'none',
        }}
      >
        <h1 style={{ fontSize: 21, fontWeight: 600, color: '#F5F3FF', letterSpacing: '-.3px' }}>
          Overview
        </h1>
        <div style={{ fontSize: 13, color: 'rgba(245,243,255,.55)', marginTop: 3 }}>
          Your whole company as a living map — drag to orbit, scroll to zoom, hover to focus, click
          a node to open it.
        </div>
        {/* Honest signal: until byte's scaffold lands, this map is the built-in example —
            never let a seeded map pass for a plan tailored to the founder's product. */}
        {examplePlan && (
          <div
            style={{
              pointerEvents: 'auto',
              marginTop: 11,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '7px 12px',
              borderRadius: 8,
              background: 'rgba(253,176,34,.12)',
              border: '1px solid rgba(253,176,34,.28)',
              fontSize: 12.5,
              color: 'rgba(245,243,255,.82)',
            }}
          >
            <span>{examplePlan.text}</span>
            <button
              type="button"
              onClick={regenerateCompany}
              style={{
                fontFamily: 'inherit',
                fontSize: 12.5,
                fontWeight: 600,
                color: '#FDB022',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {examplePlan.cta}
            </button>
          </div>
        )}
      </div>

      {stageComplete() && <AdvanceCard next={nextStageOf(brief.stage)} onAdvance={advanceStage} />}
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
        {introPhase === 'done' && (
          <button
            type="button"
            onClick={() => setIntroPhase('intro')}
            style={{
              pointerEvents: 'auto',
              fontFamily: 'inherit',
              fontSize: 11.5,
              color: 'rgba(245,243,255,.55)',
              background: 'transparent',
              border: 'none',
              borderLeft: '1px solid rgba(245,243,255,.15)',
              paddingLeft: 16,
              cursor: 'pointer',
            }}
          >
            ? how to read this map
          </button>
        )}
      </div>

      <div ref={wrapRef} style={{ position: 'absolute', inset: 0 }}>
        {mapDimmed && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 4,
              background: 'rgba(7,5,16,0.62)',
              transition: 'opacity .25s',
              pointerEvents: 'none',
            }}
          />
        )}
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
              if (n.id === beaconId) return rgba(BEACON_HEX, 0.85 + pulse * 0.15); // byte's guide star
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
              const key = `${linkId(l.source)}->${linkId(l.target)}`;
              if (hoverId) {
                const s = linkId(l.source),
                  t = linkId(l.target);
                return s === hoverId || t === hoverId ? rgba(l.hex, 0.9) : DIM_LINK;
              }
              return pathLinkIds.has(key) ? rgba(BEACON_HEX, 0.9) : l.color;
            }}
            linkWidth={(l) => {
              const key = `${linkId(l.source)}->${linkId(l.target)}`;
              const s = linkId(l.source),
                t = linkId(l.target);
              if (hoverId && (s === hoverId || t === hoverId)) return 2.4;
              if (pathLinkIds.has(key)) return 2;
              return l.kind === 'pd' ? 1.1 : 0.4;
            }}
            linkDirectionalParticles={(l) => {
              const key = `${linkId(l.source)}->${linkId(l.target)}`;
              const s = linkId(l.source),
                t = linkId(l.target);
              if (hoverId && (s === hoverId || t === hoverId)) return 4;
              if (pathLinkIds.has(key)) return 4;
              return l.active ? 3 : 0;
            }}
            linkDirectionalParticleColor={(l) => {
              const key = `${linkId(l.source)}->${linkId(l.target)}`;
              return pathLinkIds.has(key) ? BEACON_HEX : rgba(l.hex, 0.9);
            }}
            linkDirectionalParticleWidth={(l) => {
              const key = `${linkId(l.source)}->${linkId(l.target)}`;
              return pathLinkIds.has(key) ? 3 : 1.8;
            }}
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
        {showCallout && here && (
          <div
            ref={calloutRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              zIndex: 5,
              opacity: 0,
              pointerEvents: 'none',
              willChange: 'transform, opacity',
              transition: 'opacity .2s',
            }}
          >
            <ByteGuide
              here={here}
              spotlight={introPhase === 'spotlight'}
              flip={beaconFlip}
              // One shared arrival: byte opens the chat + briefs you, then the
              // portalSignal effect glides the camera to the department AFTER the
              // chat has docked. Starting also settles any active spotlight.
              onStart={() => {
                setIntroPhase('done');
                portalToTask(here.dept.k, here.task.t);
              }}
            />
          </div>
        )}
      </div>

      <StageDrawer />
    </section>
  );
}

interface HereInfo {
  dept: Dept;
  task: Task;
}

// byte's single next move, tethered to the beacon node on the map (its wrapper is
// positioned at the node's screen coords each frame). A pointer nub aims back at
// the node; the card sits to its right, vertically centered. One thing to read,
// one thing to do: the task + Start (which opens the run loop).
function ByteGuide({
  here,
  onStart,
  spotlight = false,
  flip = false,
}: {
  here: HereInfo;
  onStart: () => void;
  spotlight?: boolean;
  flip?: boolean;
}) {
  const st = taskState(here.task, true);
  return (
    <div
      style={{
        position: 'relative',
        width: 250,
        transform: flip ? 'translate(calc(-100% - 18px), -50%)' : 'translate(18px, -50%)',
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute',
          ...(flip ? { right: -5 } : { left: -5 }),
          top: '50%',
          width: 10,
          height: 10,
          marginTop: -5,
          background: 'rgba(16,14,28,0.92)',
          ...(flip
            ? {
                borderRight: '1px solid rgba(125,227,255,0.5)',
                borderTop: '1px solid rgba(125,227,255,0.5)',
              }
            : {
                borderLeft: '1px solid rgba(125,227,255,0.5)',
                borderBottom: '1px solid rgba(125,227,255,0.5)',
              }),
          transform: 'rotate(45deg)',
        }}
      />
      <div
        style={{
          pointerEvents: 'auto',
          padding: '13px 15px 15px',
          background: 'rgba(16,14,28,0.92)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          border: '1px solid rgba(125,227,255,0.35)',
          borderRadius: 13,
          boxShadow: spotlight
            ? '0 0 0 2px rgba(125,227,255,0.55), 0 0 24px 4px rgba(125,227,255,0.35), 0 8px 30px rgba(0,0,0,0.5)'
            : '0 8px 30px rgba(0,0,0,0.5)',
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: '1.3px',
            fontWeight: 700,
            color: BEACON_HEX,
            textTransform: 'uppercase',
          }}
        >
          byte · do this next
        </div>
        <div
          style={{
            fontSize: 14.5,
            fontWeight: 650,
            color: '#F7F5FF',
            letterSpacing: '-.2px',
            marginTop: 8,
            lineHeight: 1.35,
          }}
        >
          {here.task.t}
        </div>
        <div style={{ fontSize: 12, marginTop: 5, color: 'rgba(245,243,255,.5)' }}>
          {here.dept.name} · {st.label}
        </div>
        {spotlight && (
          <div
            style={{
              marginTop: 9,
              fontSize: 11.5,
              lineHeight: 1.45,
              color: 'rgba(125,227,255,.9)',
            }}
          >
            The bright cyan star is always your next move.
          </div>
        )}
        <button
          onClick={onStart}
          style={{
            marginTop: 13,
            fontFamily: 'inherit',
            fontSize: 13,
            fontWeight: 650,
            color: '#0B0616',
            background: BEACON_HEX,
            border: 0,
            borderRadius: 9,
            padding: '8px 22px',
            cursor: 'pointer',
          }}
        >
          Start
        </button>
      </div>
    </div>
  );
}

// Shown in place of the next-step card when every current-stage task is done:
// the one move left is to advance the journey. Same overlay slot + styling.
function AdvanceCard({ next, onAdvance }: { next: string | null; onAdvance: () => void }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 126,
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
          color: 'rgba(52,211,153,.75)',
          textTransform: 'uppercase',
        }}
      >
        Stage complete
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
        You&apos;ve finished this stage&apos;s work.
      </div>
      {next && (
        <button
          onClick={onAdvance}
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
          Advance to {next}
        </button>
      )}
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
