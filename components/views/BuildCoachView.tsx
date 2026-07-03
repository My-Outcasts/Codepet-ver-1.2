'use client';
import { useCallback, useEffect, useState } from 'react';
import { Byte } from '../Byte';
import { budgetState, byteDuringLine, DANGER_PCT } from '@/lib/buildCoach';
import { requestBuildPlan } from '@/lib/ai/buildPlan';
import { buildOpeningPrompt, terminalCommand } from '@/lib/armSession';
import { armBuildSession } from '@/app/actions/build';
import { getCapability } from '@/app/actions/install';
import { LiveChat } from './build/LiveChat';
import type { BytePlan } from '@/lib/ai/plan';
import type { LiveState } from '@/lib/liveBuild';
import type { TrackEvent } from '@/lib/tracking';
import { useApp } from '@/lib/store';
import { useAuth } from '@/lib/firebase/auth';
import {
  ensureIngestToken,
  loadProjectDirs,
  loadTrackEventForSession,
  subscribeLiveBuild,
  writeNotebookNote,
} from '@/lib/firebase/companyData';

// "Let's build" — the Build Coach flow, adapted to the app's light theme. It now
// brackets one real Claude Code session: think first (START) → auto-launch `claude`
// and watch real activity live (DURING) → check + remember real results (END).
// The live loop runs in local mode (hooks + Terminal open); remote/web falls back
// to a copy-paste command + the SessionEnd rollup. See
// docs/superpowers/specs/2026-07-02-build-coach-live-session-design.md.

type Step = 'start' | 'during' | 'end';
const STEPS: Step[] = ['start', 'during', 'end'];
const RAIL: Array<{ key: Step; label: string }> = [
  { key: 'start', label: 'START' },
  { key: 'during', label: 'DURING' },
  { key: 'end', label: 'END' },
];
const NEXT_LABEL: Record<Step, string> = {
  start: 'Keep going →',
  during: 'Wrap up →',
  end: 'Start over ↺',
};

const DEFAULT_BUDGET_ACTIONS = 12;

// Byte's coaching bubble — sprite + a line, a "lens" chip, and an expandable
// "a little tip from Byte" panel. Reused across all three steps.
function CoachBubble({
  say,
  lens,
  learn,
  mood = 'idle',
}: {
  say: React.ReactNode;
  lens: string;
  learn: React.ReactNode;
  mood?: 'idle' | 'worried';
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bc-coach">
      <Byte size="s40" className={`bc-pet ${mood}`} />
      <div className="bc-bubble">
        <div className="bc-say">{say}</div>
        <span className="bc-lens">{lens}</span>
        <div className="bc-learn-toggle" onClick={() => setOpen((o) => !o)}>
          {open ? '－' : '＋'} A little tip from Byte
        </div>
        {open && <div className="bc-learn">{learn}</div>}
      </div>
    </div>
  );
}

function StartStep({
  project,
  setProject,
  brief,
  setBrief,
  plan,
  setPlan,
  onStart,
  arming,
}: {
  project: string;
  setProject: (v: string) => void;
  brief: string;
  setBrief: (v: string) => void;
  plan: BytePlan | null;
  setPlan: (p: BytePlan | null) => void;
  onStart: () => void;
  arming: boolean;
}) {
  const { projects } = useApp();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    if (loading || !brief.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setPlan(
        await requestBuildPlan({
          brief: brief.trim(),
          project: project || undefined,
        }),
      );
    } catch {
      setError("Byte couldn't put the plan together just now. Give it another go?");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="bc-panel-h">Step 1 · think before you build</div>
      <CoachBubble
        say="Hold on a sec! Who are we building this for, and what does it look like when it's done? Let's think it through together! 💭"
        lens="🏪 Right now you're thinking like a shop owner"
        learn={
          <>
            If you ask the AI to build something without being clear, it easily goes off track and
            wastes tokens! A good shop owner always asks <b>&ldquo;who&rsquo;s it for&rdquo;</b> and{' '}
            <b>&ldquo;what does done look like&rdquo;</b> first. That&rsquo;s exactly what
            you&rsquo;re learning — nice! 😎
          </>
        }
      />
      <label className="bc-field">
        <span>Which project?</span>
        {projects.length > 0 ? (
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">No project — just this build</option>
            {projects.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={project}
            onChange={(e) => setProject(e.target.value)}
            placeholder="Type a project name (or run the project scan to list your local repos)"
          />
        )}
      </label>
      <label className="bc-field">
        <span>What do you want to build?</span>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={3}
          placeholder="Type anything — who it's for, what it should do, what done looks like…"
        />
      </label>
      <div className={`bc-gen${loading ? ' busy' : ''}`} onClick={generate}>
        {loading ? '· Byte is thinking…' : '▸ Let Byte turn this into a plan!'}
      </div>
      {error && <div className="bc-plan-err">{error}</div>}
      {plan && (
        <>
          <div className="bc-plan">
            <div className="bc-plan-h">
              {plan.title} · aim for ~{plan.budgetActions} actions
            </div>
            <ol>
              {plan.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>
          <div className={`bc-gen primary${arming ? ' busy' : ''}`} onClick={onStart}>
            {arming ? '· Opening your session…' : '▸ Start building — Byte opens Claude Code'}
          </div>
        </>
      )}
    </div>
  );
}

function DuringStep({
  plan,
  live,
  unlocked,
  launchCommand,
  local,
  buildSessionId,
  projectDir,
  brief,
}: {
  plan: BytePlan | null;
  live: LiveState | null;
  unlocked: boolean;
  launchCommand: string | null;
  local: boolean;
  buildSessionId: string | null;
  projectDir: string;
  brief: string;
}) {
  const target = plan?.budgetActions ?? DEFAULT_BUDGET_ACTIONS;
  const actions = live?.actionCount ?? 0;
  const pct = Math.min(100, Math.round((actions / target) * 100));
  const bs = budgetState(pct);
  const recent = live?.recentTools ?? [];
  const line = byteDuringLine(live, bs.warn);

  return (
    <div>
      <div className="bc-panel-h">Step 2 · building now</div>
      {local && plan && projectDir && buildSessionId && (
        <LiveChat
          buildSessionId={buildSessionId}
          projectDir={projectDir}
          plan={plan}
          brief={brief}
        />
      )}
      <CoachBubble
        mood={line?.mood ?? (bs.warn ? 'worried' : 'idle')}
        say={
          line?.say ??
          (bs.warn
            ? "Whoa, we're using a lot of steps! Let's slow down and double-check before we go further 😟"
            : live
              ? "Byte's watching your session — every step lands here in real time 👀"
              : 'Byte is waiting to see your session start…')
        }
        lens="🐷 It's like feeding a piggy bank"
        learn={
          <>
            Every action the AI takes is a coin in the piggy bank. Good builders break work into
            small pieces and use just enough. Byte fills the bank as your real session works, and
            shouts if it&rsquo;s about to overflow! 🔔
          </>
        }
      />

      {launchCommand && (
        <div className="bc-plan-err">
          Byte couldn&rsquo;t open a Terminal here (needs the local app). Run this yourself, then
          Byte will follow along:
          <pre className="bc-cmd">{launchCommand}</pre>
        </div>
      )}

      <div className="bc-meter">
        <div className="bc-meter-top">
          <b>Byte&rsquo;s action piggy bank</b>
          <span>{live ? bs.label : 'waiting…'}</span>
        </div>
        <div className="bc-track">
          <div className={`bc-fill${bs.warn ? ' warn' : ''}`} style={{ width: `${pct}%` }} />
          <div className="bc-budget-mark" style={{ left: `${DANGER_PCT}%` }} />
        </div>
        <div className="bc-slide-row">
          <span className="bc-pct">
            {actions} / {target} actions
          </span>
        </div>
        {recent.length > 0 && <div className="bc-live-feed">Byte sees: {recent.join(' · ')}</div>}
      </div>

      <div className={`bc-unlock${unlocked ? ' live' : ''}`}>
        <div className="bc-unlock-top">
          <span className="bc-u-tag">{unlocked ? 'Byte woke up! ✨' : 'asleep 😴'}</span>
          <b>The &ldquo;Double-check&rdquo; habit</b>
        </div>
        <p>
          {unlocked ? (
            <>
              Right when you need it! Byte is reminding you to <b>&ldquo;Double-check&rdquo;</b>{' '}
              before finishing. Earn it by wrapping up under budget with something committed!
            </>
          ) : (
            "Byte is sleeping on this one. When you're about to finish without checking, Byte will wake up and remind you!"
          )}
        </p>
      </div>
    </div>
  );
}

function EndStep({
  companyId,
  sessionId,
  plan,
  brief,
  actions,
}: {
  companyId: string | null;
  sessionId: string | null;
  plan: BytePlan | null;
  brief: string;
  actions: number;
}) {
  const [ev, setEv] = useState<TrackEvent | null>(null);
  const [fetched, setFetched] = useState(false);
  const [saved, setSaved] = useState(false);
  const noSession = !companyId || !sessionId;
  const loaded = noSession || fetched;

  useEffect(() => {
    if (noSession) return;
    let cancelled = false;
    loadTrackEventForSession(companyId, sessionId).then((e) => {
      if (cancelled) return;
      setEv(e);
      setFetched(true);
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, sessionId, noSession]);

  const target = plan?.budgetActions ?? DEFAULT_BUDGET_ACTIONS;
  const underBudget = actions <= target;
  const commits = ev?.commits ?? 0;
  const earned = underBudget && commits >= 1;
  const built = ev?.wins?.[0] ?? brief;

  const save = async () => {
    if (!companyId || saved) return;
    await writeNotebookNote(companyId, {
      buildSessionId: sessionId ?? '',
      doneLooks: brief,
      wins: ev?.wins ?? [],
    });
    setSaved(true);
  };

  return (
    <div>
      <div className="bc-panel-h">Step 3 · almost there!</div>
      <CoachBubble
        say="Hold on, let Byte review before we call it done! Good builders never finish without a second look 🔍"
        lens="🩺 Like a doctor's check-up before you go home"
        learn={
          <>
            If you just nod along to the AI&rsquo;s changes, when something breaks you won&rsquo;t
            know where! This habit trains you to review + take notes. That way you save yourself
            painful cleanup later! 💪
          </>
        }
      />
      {!loaded ? (
        <div className="bc-plan-err">Byte is still tidying up the session…</div>
      ) : (
        <>
          <div className="bc-recap">
            <div className="bc-rc">
              <label>built</label>
              <div className="v">{built}</div>
            </div>
            <div className="bc-rc">
              <label>spent</label>
              <div className={`v${underBudget ? ' ok' : ' warn'}`}>
                {actions}/{target} actions
              </div>
            </div>
            <div className="bc-rc">
              <label>committed</label>
              <div className={`v${commits >= 1 ? ' ok' : ''}`}>
                {commits >= 1 ? `${commits} ✓` : '—'}
              </div>
            </div>
          </div>
          <ul className="bc-checklist">
            {(plan?.steps ?? []).map((step, i) => (
              <li key={i}>
                <span className="c">✓</span> {step}
              </li>
            ))}
            <li>
              <span className="c">✓</span> Matches what you asked for: {brief}
            </li>
          </ul>
          <div className={`bc-unlock${earned ? ' live' : ''}`}>
            <div className="bc-unlock-top">
              <span className="bc-u-tag">{earned ? 'earned! ✨' : 'not yet'}</span>
              <b>The &ldquo;Double-check&rdquo; habit</b>
            </div>
            <p>
              {earned
                ? 'You finished under budget with something committed — Byte earned the Double-check habit for you!'
                : 'Next time, wrap up under budget with at least one commit and Byte will earn this habit.'}
            </p>
          </div>
          {ev?.wins && ev.wins.length > 0 && (
            <div className="bc-ctx">📒 Recent wins: {ev.wins.join(' · ')}</div>
          )}
          <div
            className={`bc-gen${saved ? ' busy' : ''}`}
            onClick={save}
            aria-disabled={saved || !companyId}
          >
            {saved ? '· Saved to Byte’s notebook ✓' : '▸ Write it down in Byte’s notebook'}
          </div>
        </>
      )}
    </div>
  );
}

export function BuildCoachView() {
  const { companyId } = useAuth();
  const [step, setStep] = useState<Step>('start');

  // Lifted flow state (shared across steps + arming).
  const [project, setProject] = useState('');
  const [brief, setBrief] = useState('');
  const [plan, setPlan] = useState<BytePlan | null>(null);

  // Live session state.
  const [buildSessionId, setBuildSessionId] = useState<string | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);
  const [launchCommand, setLaunchCommand] = useState<string | null>(null);
  const [arming, setArming] = useState(false);
  const [projectDir, setProjectDir] = useState('');
  const [local, setLocal] = useState(false);

  const idx = STEPS.indexOf(step);
  const actions = live?.actionCount ?? 0;
  const sessionId = live?.sessionId ?? null;
  // actionCount only grows within a session, so the Double-check reminder derives
  // (and effectively latches) from the current reading — no separate state needed.
  const target = plan?.budgetActions ?? DEFAULT_BUDGET_ACTIONS;
  const unlocked = budgetState(Math.min(100, Math.round((actions / target) * 100))).unlock;

  // Subscribe to the live build doc once a session is armed. Updating state from
  // the subscription callback is the intended pattern; when the session ends
  // (its rollup marks the doc ended) we advance to the recap.
  useEffect(() => {
    if (!companyId || !buildSessionId) return;
    return subscribeLiveBuild(companyId, buildSessionId, (s) => {
      setLive(s);
      if (s?.ended) setStep('end');
    });
  }, [companyId, buildSessionId]);

  const startBuild = useCallback(async () => {
    if (!plan || !companyId || arming) return;
    setArming(true);
    try {
      const id = crypto.randomUUID();
      const dirs = await loadProjectDirs(companyId);
      const projectDir = dirs.find((p) => p.name === project)?.path ?? (project.trim() || '.');
      setProjectDir(projectDir);
      const cap = await getCapability();
      if (cap.mode === 'local') {
        // Local: LiveChat will POST /api/build-session/start and stream the real
        // claude session into the UI — no Terminal, no arm-file.
        setLocal(true);
        setLaunchCommand(null);
        setBuildSessionId(id);
        setLive(null);
        setStep('during');
      } else {
        // Remote: fall back to the copy-paste command + hook meter.
        setLocal(false);
        const command = terminalCommand(projectDir, buildOpeningPrompt(plan, brief));
        const token = await ensureIngestToken(companyId);
        const res = await armBuildSession({
          buildSessionId: id,
          projectDir,
          plan,
          brief,
          companyId,
          token,
          apiUrl: window.location.origin,
        });
        const launched = res.ok && res.launched;
        setLaunchCommand(launched ? null : command);
        setBuildSessionId(id);
        setLive(null);
        setStep('during');
      }
    } finally {
      setArming(false);
    }
  }, [plan, companyId, arming, project, brief]);

  const goNext = () => {
    if (step === 'end') {
      // Restart the flow for a fresh build.
      setStep('start');
      setPlan(null);
      setBuildSessionId(null);
      setLive(null);
      setLaunchCommand(null);
      setProjectDir('');
      setLocal(false);
      return;
    }
    setStep(STEPS[idx + 1]);
  };
  const goBack = () => {
    if (idx > 0) setStep(STEPS[idx - 1]);
  };

  return (
    <section className="view on bc-view" id="v-build">
      <div className="vhead">
        <h1>Let&rsquo;s build</h1>
        <div className="sub">
          Byte walks you through it step by step: think first → build with a real Claude Code
          session → check &amp; remember.
        </div>
      </div>

      <div className="bc-body">
        <div className="bc-rail">
          {RAIL.map((r, i) => (
            <div
              key={r.key}
              className={`bc-step${i === idx ? ' active' : ''}${i < idx ? ' done' : ''}`}
            >
              <div className="bc-rail-lbl">{r.label}</div>
              <div className="bc-rail-bar" />
            </div>
          ))}
        </div>

        {step === 'start' && (
          <StartStep
            project={project}
            setProject={setProject}
            brief={brief}
            setBrief={setBrief}
            plan={plan}
            setPlan={setPlan}
            onStart={startBuild}
            arming={arming}
          />
        )}
        {step === 'during' && (
          <DuringStep
            plan={plan}
            live={live}
            unlocked={unlocked}
            launchCommand={launchCommand}
            local={local}
            buildSessionId={buildSessionId}
            projectDir={projectDir}
            brief={brief}
          />
        )}
        {step === 'end' && (
          <EndStep
            companyId={companyId}
            sessionId={sessionId}
            plan={plan}
            brief={brief}
            actions={actions}
          />
        )}

        <div className="bc-nav">
          {idx > 0 && (
            <button className="bc-back" onClick={goBack}>
              ← Back a step
            </button>
          )}
          <button className="bc-next" onClick={goNext}>
            {NEXT_LABEL[step]}
          </button>
        </div>
      </div>
    </section>
  );
}
