'use client';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import { DEPTS, OB_ROLES, OB_TECH, OB_STAGES, OB_NOTES, OB_CATEGORIES, OB_TOTAL } from '@/lib/data';
import { buildRevealSummary, type RevealSummary } from '@/lib/onboarding/firstRun';
import type { CompanyBrief } from '@/lib/firebase/schema';
import { track } from '@/lib/analytics';
import { Byte } from './Byte';

interface ObData {
  name: string;
  role: string;
  roleLabel: string;
  tech: string;
  projName: string;
  oneLiner: string;
  proj: string; // free-form "paste anything" details
  link: string;
  categories: string[];
  audience: string;
  stage: number;
}

// Bright-on-dark dot colour per department, for the cold-open department preview chips.
const DEPT_DOT: Record<string, string> = {
  eng: '#6ea8ff',
  mkt: '#ff9d6b',
  ops: '#4fe0cf',
  fin: '#f2c94c',
  legal: '#b98cf0',
  design: '#d08cf5',
  sales: '#7ea8ff',
  support: '#7fd694',
};

// One cinematic scene per step (left panel art; step 0 is the full-bleed cold-open).
const STEP_ART = [
  '/onboarding/ob-team.jpg', // 0 cold-open
  '/onboarding/ob-couch.jpg', // 1 name
  '/onboarding/ob-chess.jpg', // 2 role
  '/onboarding/ob-drummer.jpg', // 3 tech
  '/onboarding/ob-observatory.jpg', // 4 project
  '/onboarding/ob-isometric.jpg', // 5 stage
  '/onboarding/ob-boardroom.jpg', // 6 analysis
  '/onboarding/ob-team.jpg', // 7 summary
];

const AN_LINES = [
  'Reading what you told me…',
  'Mapping it across 8 departments',
  'Cross-checking your space & stage',
  'Drafting your roadmap to launch',
];

// The wizard's collected answers → the CompanyBrief byte scaffolds + grounds work in.
function briefFromData(data: ObData): CompanyBrief {
  return {
    founderName: data.name || undefined,
    role: data.roleLabel || undefined,
    tech: OB_TECH.find(([, k]) => k === data.tech)?.[0],
    stage: OB_STAGES[data.stage],
    projectName: data.projName || undefined,
    oneLiner: data.oneLiner || undefined,
    notes: data.proj || undefined,
    link: data.link || undefined,
    categories: data.categories.length ? data.categories : undefined,
    audience: data.audience || undefined,
  };
}

function StageBar({ stage, setStage }: { stage: number; setStage: (n: number) => void }) {
  const n = OB_STAGES.length,
    STEP = 4,
    total = (n - 1) * STEP;
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const cf = stage / (n - 1);

  const setFromX = (cx: number) => {
    const t = trackRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    let f = (cx - r.left) / r.width;
    f = Math.max(0, Math.min(1, f));
    setStage(Math.round(f * (n - 1)));
  };

  return (
    <div
      className={`stagebar${drag ? ' drag' : ''}`}
      tabIndex={0}
      role="slider"
      aria-label="Project stage"
      aria-valuemin={0}
      aria-valuemax={n - 1}
      aria-valuenow={stage}
      onPointerDown={(e) => {
        setDrag(true);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        setFromX(e.clientX);
      }}
      onPointerMove={(e) => {
        if (drag) setFromX(e.clientX);
      }}
      onPointerUp={() => setDrag(false)}
      onPointerCancel={() => setDrag(false)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          setStage(Math.min(n - 1, stage + 1));
          e.preventDefault();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          setStage(Math.max(0, stage - 1));
          e.preventDefault();
        }
      }}
    >
      <div className="sb-track" ref={trackRef}>
        <div className="sb-base" />
        <div className="sb-prog" style={{ width: `${cf * 100}%` }} />
        <div className="sb-ticks">
          {Array.from({ length: total + 1 }, (_, t) => (
            <div
              key={t}
              className={`sb-tick ${t % STEP === 0 ? 'major' : 'minor'}${t / total <= cf + 0.001 ? ' fill' : ''}`}
              style={{ left: `${((t / total) * 100).toFixed(2)}%` }}
            />
          ))}
        </div>
        <div className="sb-thumb" style={{ left: `${cf * 100}%` }} />
      </div>
    </div>
  );
}

export function Onboarding() {
  const { onboarding, finishOnboarding, toast, scaffoldFromOnboarding } = useApp();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<ObData>({
    name: '',
    role: '',
    roleLabel: '',
    tech: '',
    projName: '',
    oneLiner: '',
    proj: '',
    link: '',
    categories: [],
    audience: '',
    stage: 2,
  });
  const [anShown, setAnShown] = useState(0);
  const [anDone, setAnDone] = useState(false);
  const [reveal, setReveal] = useState<RevealSummary | null>(null);
  const [slow, setSlow] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // step 6: play the analysis animation AND run the real scaffold. "See what I found"
  // unlocks only when both the animation has finished and the scaffold has resolved.
  useEffect(() => {
    if (step !== 6) {
      setAnShown(0);
      setAnDone(false);
      if (step < 6) {
        setReveal(null);
        setSlow(false);
      }
      return;
    }
    setAnShown(0);
    setAnDone(false);
    setReveal(null);
    setSlow(false);
    let done = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    AN_LINES.forEach((_, i) => timers.push(setTimeout(() => setAnShown(i + 1), i * 640)));
    timers.push(setTimeout(() => setAnDone(true), AN_LINES.length * 640 + 300));
    // subtle "still working…" affordance if the API runs long
    timers.push(
      setTimeout(
        () => {
          if (!done) setSlow(true);
        },
        AN_LINES.length * 640 + 3000,
      ),
    );
    // the real work
    scaffoldFromOnboarding(briefFromData(data)).then((sum) => {
      if (done) return;
      setReveal(sum);
      if (sum.ok) track('firstrun.scaffold_shown', { depts: sum.deptCount, tasks: sum.taskCount });
    });
    // hard safety net: never leave the founder stuck on the analysis screen
    timers.push(
      setTimeout(() => {
        if (!done) setReveal(buildRevealSummary(DEPTS, false));
      }, 20000),
    );
    return () => {
      done = true;
      timers.forEach(clearTimeout);
    };
    // data is complete + frozen by step 6; scaffoldFromOnboarding is stable (useCallback)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // focus the name field on step 1
  useEffect(() => {
    if (step === 1) nameRef.current?.focus();
  }, [step]);

  if (!onboarding) return null;

  const set = (patch: Partial<ObData>) => setData((d) => ({ ...d, ...patch }));
  const toggleCat = (c: string) =>
    setData((d) => ({
      ...d,
      categories: d.categories.includes(c)
        ? d.categories.filter((x) => x !== c)
        : [...d.categories, c],
    }));
  const enterApp = () => finishOnboarding();
  const finish = () => {
    finishOnboarding(briefFromData(data));
    setTimeout(
      () => toast('Your roadmap is ready — byte mapped your company across your departments.'),
      400,
    );
  };

  // Step 0 — cinematic cold-open (full-bleed hero), distinct from the question screens.
  if (step === 0) {
    return (
      <div className="ob ob-cold">
        <button className="skip-pre" onClick={enterApp}>
          Skip onboarding →
        </button>
        <div className="ob-cold-in">
          <div className="ob-cold-byte">
            <Byte size="s28" />
            <span>byte</span>
          </div>
          <h1>
            Let&apos;s build your company — <span className="ob-hl">not just your code.</span>
          </h1>
          <p>
            I&apos;m byte. I&apos;ll run the whole company around your product, department by
            department — and I do the work <b>with</b> you, so you always understand what&apos;s
            happening.
          </p>
          <div className="ob-depts">
            <div className="ob-depts-ey">byte runs all {DEPTS.length} departments</div>
            <div className="ob-chips">
              {DEPTS.map((d) => (
                <span
                  key={d.k}
                  className="ob-chip"
                  style={{ ['--dc' as string]: DEPT_DOT[d.k] || '#9d5cf5' }}
                >
                  <i />
                  {d.name}
                </span>
              ))}
            </div>
          </div>
          <button className="splash-btn" onClick={() => setStep(1)}>
            Set up my company
          </button>
          <div className="ob-cold-meta">
            <span className="ob-pt">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
              About a minute to set up
            </span>
            <span className="ob-pt">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              You approve every move
            </span>
          </div>
        </div>
      </div>
    );
  }

  const pct = Math.round(((step + 1) / OB_TOTAL) * 100);

  const Foot = ({
    label,
    onClick,
    disabled,
  }: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
  }) => (
    <div className="ob-foot">
      <div className="ob-prog">
        <div className="ob-bar">
          <i style={{ width: `${pct}%` }} />
        </div>
        <span className="rstep">
          Step {step + 1} of {OB_TOTAL}
        </span>
      </div>
      <span className="grow" />
      <button className="btnlg" disabled={disabled} onClick={onClick}>
        {label}
      </button>
    </div>
  );

  let body: React.ReactNode, foot: React.ReactNode;
  let tall = false;
  if (step === 1) {
    body = (
      <>
        <h2>First — what should I call you?</h2>
        <p>I&apos;ll use it when I walk you through your company.</p>
        <label>Your name</label>
        <input
          ref={nameRef}
          className="t"
          placeholder="e.g. Mona"
          value={data.name}
          autoComplete="off"
          onChange={(e) => set({ name: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && data.name.trim()) setStep(2);
          }}
        />
      </>
    );
    foot = <Foot label="Continue" disabled={!data.name.trim()} onClick={() => setStep(2)} />;
  } else if (step === 2) {
    body = (
      <>
        <h2>Which best describes you?</h2>
        <p>This shapes how I explain each department to you.</p>
        <div className="obopts">
          {OB_ROLES.map((r, i) => (
            <div
              key={r[1]}
              className={`obopt${data.role === r[1] ? ' sel' : ''}`}
              onClick={() => set({ role: r[1], roleLabel: r[0] })}
            >
              <span className="on">{String(i + 1).padStart(2, '0')}</span>
              <span className="ol">{r[0]}</span>
              <span className="ock">✓</span>
            </div>
          ))}
        </div>
      </>
    );
    foot = <Foot label="Continue" disabled={!data.role} onClick={() => setStep(3)} />;
  } else if (step === 3) {
    body = (
      <>
        <h2>How hands-on are you with the code?</h2>
        <p>So I know how deep to go on the technical side.</p>
        <div className="obopts">
          {OB_TECH.map((r, i) => (
            <div
              key={r[1]}
              className={`obopt${data.tech === r[1] ? ' sel' : ''}`}
              onClick={() => set({ tech: r[1] })}
            >
              <span className="on">{String(i + 1).padStart(2, '0')}</span>
              <span className="ol">{r[0]}</span>
              <span className="ock">✓</span>
            </div>
          ))}
        </div>
      </>
    );
    foot = <Foot label="Continue" disabled={!data.tech} onClick={() => setStep(4)} />;
  } else if (step === 4) {
    tall = true;
    body = (
      <>
        <h2>Now — what are you building?</h2>
        <p>Just a name and one line is plenty. The rest helps me do sharper work.</p>
        <label>Project name</label>
        <input
          className="t"
          placeholder="e.g. Codepet"
          value={data.projName}
          autoComplete="off"
          onChange={(e) => set({ projName: e.target.value })}
        />
        <label>In one sentence, what is it?</label>
        <input
          className="t"
          placeholder="A macOS companion that helps founders run their company with AI"
          value={data.oneLiner}
          autoComplete="off"
          onChange={(e) => set({ oneLiner: e.target.value })}
        />
        <label>
          What kind of product is it? <span className="opt">optional</span>
        </label>
        <div className="obchips">
          {OB_CATEGORIES.map((c) => (
            <div
              key={c}
              className={`obchip${data.categories.includes(c) ? ' sel' : ''}`}
              onClick={() => toggleCat(c)}
            >
              {c}
            </div>
          ))}
        </div>
        <label>
          Who&apos;s it for? <span className="opt">optional</span>
        </label>
        <input
          className="t"
          placeholder="e.g. solo founders shipping their first product"
          value={data.audience}
          autoComplete="off"
          onChange={(e) => set({ audience: e.target.value })}
        />
        <label>
          Link <span className="opt">optional — website, repo, or Figma</span>
        </label>
        <input
          className="t"
          type="url"
          inputMode="url"
          placeholder="https://"
          value={data.link}
          autoComplete="off"
          onChange={(e) => set({ link: e.target.value })}
        />
        <label>
          Anything else to read?{' '}
          <span className="opt">optional — paste a pitch, README, or notes</span>
        </label>
        <textarea
          placeholder="Paste anything that helps me understand the product…"
          value={data.proj}
          onChange={(e) => set({ proj: e.target.value })}
        />
      </>
    );
    foot = <Foot label="Continue" disabled={!data.projName.trim()} onClick={() => setStep(5)} />;
  } else if (step === 5) {
    body = (
      <>
        <h2>Where are you today?</h2>
        <p>This sets your starting point on the roadmap.</p>
        <StageBar stage={data.stage} setStage={(s) => set({ stage: s })} />
        <div className="rngticks">
          {OB_STAGES.map((s, i) => (
            <span key={s} className={i === data.stage ? 'on' : ''}>
              {s}
            </span>
          ))}
        </div>
        <div className="obnote">{OB_NOTES[data.stage]}</div>
      </>
    );
    foot = <Foot label="Analyze my project" onClick={() => setStep(6)} />;
  } else if (step === 6) {
    body = (
      <>
        <h2>byte is reading {data.projName || 'your project'}…</h2>
        <p>Turning what you told me into a full company plan.</p>
        <div className="ob-an">
          {AN_LINES.slice(0, anShown).map((t, i) => {
            const live = !anDone && i === anShown - 1;
            return (
              <div className={`anrow${live ? ' live' : ''}`} key={i}>
                <span className="tk2">{live ? '' : '✓'}</span>
                <span>{t}</span>
              </div>
            );
          })}
        </div>
      </>
    );
    foot =
      anDone && reveal ? (
        <div className="ob-foot">
          <div className="ob-prog">
            <div className="ob-bar">
              <i style={{ width: `${pct}%` }} />
            </div>
            <span className="rstep">
              Step {step + 1} of {OB_TOTAL}
            </span>
          </div>
          <span className="grow" />
          <button className="btnlg" onClick={() => setStep(7)}>
            See what I found
          </button>
        </div>
      ) : slow ? (
        <div className="ob-foot">
          <span className="rstep">Still building your company…</span>
        </div>
      ) : null;
  } else {
    const rl = (data.roleLabel || 'founder').toLowerCase();
    const r = reveal;
    body = (
      <>
        <h2>Here&apos;s your company{data.name ? ', ' + data.name : ''}.</h2>
        <p>
          You&apos;re a <b>{rl}</b> at the <b>{OB_STAGES[data.stage].toLowerCase()}</b> stage.
          {r && r.ok
            ? ` I built your roadmap and staffed ${r.deptCount} departments — ${r.taskCount} tasks already prepped:`
            : ' I built your roadmap and staffed your departments — here’s what I’ll take off your plate:'}
        </p>
        <div className="val">
          {r && r.ok && r.sampleTasks.length ? (
            r.sampleTasks.map((t) => (
              <div className="vrow" key={t}>
                <div className="vi">✦</div>
                <div>
                  <b>{t}</b>
                </div>
              </div>
            ))
          ) : (
            <>
              <div className="vrow">
                <div className="vi">✦</div>
                <div>
                  <b>A living roadmap</b> — staged from &quot;{OB_STAGES[data.stage]}&quot; to
                  launch.
                </div>
              </div>
              <div className="vrow">
                <div className="vi">✦</div>
                <div>
                  <b>Real work, done with you</b> — tasks prepped across your departments.
                </div>
              </div>
              <div className="vrow">
                <div className="vi">✦</div>
                <div>
                  <b>You stay in control</b> — I draft &amp; build; you approve.
                </div>
              </div>
            </>
          )}
        </div>
      </>
    );
    foot = <Foot label="See my company" onClick={finish} />;
  }

  return (
    <div className="ob">
      <button className="skip-pre" onClick={enterApp}>
        Skip onboarding →
      </button>
      <div className="obcard">
        <div className="ob-art">
          <span key={step} style={{ backgroundImage: `url(${STEP_ART[step]})` }} />
        </div>
        <div className="ob-main" id="obIn">
          <div className="ob-top">
            {step !== 6 && (
              <button className="ob-back" onClick={() => setStep(Math.max(0, step - 1))}>
                ← Back
              </button>
            )}
          </div>
          <div key={step} className={`ob-body${tall ? ' tall' : ''}`}>
            {body}
          </div>
          {foot}
        </div>
      </div>
    </div>
  );
}
