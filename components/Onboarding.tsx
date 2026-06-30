'use client';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import { OB_ROLES, OB_TECH, OB_STAGES, OB_NOTES, OB_TOTAL } from '@/lib/data';

interface ObData {
  name: string;
  role: string;
  roleLabel: string;
  tech: string;
  proj: string;
  projName: string;
  stage: number;
}
const AN_LINES = [
  'Reading what you told me…',
  'Mapping it across 8 departments',
  'Cross-checking your space & stage',
  'Drafting your roadmap to launch',
];

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
  const { onboarding, finishOnboarding, toast } = useApp();
  const [splashGone, setSplashGone] = useState(false);
  const [step, setStep] = useState(0);
  const [data, setData] = useState<ObData>({
    name: '',
    role: '',
    roleLabel: '',
    tech: '',
    proj: '',
    projName: 'Codepet',
    stage: 2,
  });
  const [anShown, setAnShown] = useState(0);
  const [anDone, setAnDone] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // step 6: run the analysis animation
  useEffect(() => {
    if (step !== 6) {
      setAnShown(0);
      setAnDone(false);
      return;
    }
    setAnShown(0);
    setAnDone(false);
    const timers: ReturnType<typeof setTimeout>[] = [];
    AN_LINES.forEach((_, i) => timers.push(setTimeout(() => setAnShown(i + 1), i * 640)));
    timers.push(setTimeout(() => setAnDone(true), AN_LINES.length * 640 + 300));
    return () => timers.forEach(clearTimeout);
  }, [step]);

  // focus the name field on step 1
  useEffect(() => {
    if (step === 1) nameRef.current?.focus();
  }, [step]);

  if (!onboarding) return null;

  const set = (patch: Partial<ObData>) => setData((d) => ({ ...d, ...patch }));
  const enterApp = () => finishOnboarding();
  const finish = () => {
    finishOnboarding();
    setTimeout(
      () => toast('Your roadmap is ready — byte mapped 9 steps across 8 departments.'),
      400,
    );
  };

  const pct = Math.round(((step + 1) / OB_TOTAL) * 100);

  const Foot = ({
    label,
    onClick,
    disabled,
    isFinish,
  }: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    isFinish?: boolean;
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
  if (step === 0) {
    body = (
      <>
        <h2>Hi, I&apos;m byte. Let&apos;s build your company — not just your code.</h2>
        <p>
          Most tools help you ship the product. I help you run the whole company around it,
          department by department — and I do the work <b>with</b> you, so you always understand
          what&apos;s happening.
        </p>
        <div className="val">
          <div className="vrow">
            <div className="vi">1</div>
            <div>
              <b>Tell me about you and what you&apos;re building.</b> Takes about a minute.
            </div>
          </div>
          <div className="vrow">
            <div className="vi">2</div>
            <div>
              <b>I map your roadmap</b> across all eight departments.
            </div>
          </div>
          <div className="vrow">
            <div className="vi">3</div>
            <div>
              <b>Then we work together</b> — I draft &amp; build, you approve every move.
            </div>
          </div>
        </div>
      </>
    );
    foot = <Foot label="Let's go" onClick={() => setStep(1)} />;
  } else if (step === 1) {
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
    body = (
      <>
        <h2>Now — what are you building?</h2>
        <p>A name and one line is plenty. I&apos;ll read the rest.</p>
        <label>Project name</label>
        <input
          className="t"
          placeholder="e.g. Codepet"
          value={data.projName}
          autoComplete="off"
          onChange={(e) => set({ projName: e.target.value })}
        />
        <label>What is it? (or paste a link)</label>
        <textarea
          placeholder="A macOS companion that…"
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
    foot = anDone ? (
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
    ) : null;
  } else {
    const rl = (data.roleLabel || 'founder').toLowerCase();
    body = (
      <>
        <h2>Here&apos;s your company{data.name ? ', ' + data.name : ''}.</h2>
        <p>
          You&apos;re a <b>{rl}</b> at the <b>{OB_STAGES[data.stage].toLowerCase()}</b> stage. I
          built your roadmap and staffed all eight departments — here&apos;s what I&apos;ll take off
          your plate:
        </p>
        <div className="val">
          <div className="vrow">
            <div className="vi">✦</div>
            <div>
              <b>A living roadmap</b> — staged from &quot;{OB_STAGES[data.stage]}&quot; all the way
              to launch.
            </div>
          </div>
          <div className="vrow">
            <div className="vi">✦</div>
            <div>
              <b>Real work, done with you</b> — 11 tasks already prepped across Engineering,
              Marketing, Legal &amp; more.
            </div>
          </div>
          <div className="vrow">
            <div className="vi">✦</div>
            <div>
              <b>You stay in control</b> — I draft &amp; build; you approve. Nothing ships behind
              your back.
            </div>
          </div>
        </div>
      </>
    );
    foot = <Foot label="See my company" isFinish onClick={finish} />;
  }

  return (
    <>
      <div className="ob">
        <button className="skip-pre" onClick={enterApp}>
          Skip onboarding →
        </button>
        <div className="obcard">
          <div className="ob-art">
            <span />
          </div>
          <div className="ob-main" id="obIn">
            <div className="ob-top">
              {step > 0 && step !== 6 && (
                <button className="ob-back" onClick={() => setStep(Math.max(0, step - 1))}>
                  ← Back
                </button>
              )}
            </div>
            <div className="ob-body">{body}</div>
            {foot}
          </div>
        </div>
      </div>
      {!splashGone && (
        <div
          className="splash"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('.skip-pre')) return;
            setSplashGone(true);
          }}
        >
          <button
            className="skip-pre"
            onClick={(e) => {
              e.stopPropagation();
              enterApp();
            }}
          >
            Skip →
          </button>
          <div className="splash-in">
            <h1 className="splash-title pixel">Codepet</h1>
            <p className="splash-sub">Let&apos;s learn how to run your company with AI.</p>
            <button className="splash-btn" onClick={() => setSplashGone(true)}>
              Let&apos;s go
            </button>
          </div>
          <div className="splash-hint">click anywhere to begin</div>
        </div>
      )}
    </>
  );
}
