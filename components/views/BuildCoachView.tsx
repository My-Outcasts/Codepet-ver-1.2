'use client';
import { useEffect, useState } from 'react';
import { Byte } from '../Byte';
import { budgetState, byteDuringLine, DANGER_PCT } from '@/lib/buildCoach';
import { stopBuildSession } from '@/lib/liveSession/stopClient';
import { LiveChat } from './build/LiveChat';
import type { BytePlan } from '@/lib/ai/plan';
import type { LiveState } from '@/lib/liveBuild';
import type { TrackEvent } from '@/lib/tracking';
import { useApp } from '@/lib/store';
import { useAuth } from '@/lib/firebase/auth';
import { loadTrackEventForSession, writeNotebookNote } from '@/lib/firebase/companyData';
import { buildChangeSummary } from '@/app/actions/checkpoint';

// "Let's build" — the Build Coach flow, adapted to the app's light theme. It
// brackets one real Claude Code session: think first (START, now in the byte
// chat) → auto-launch `claude` and watch real activity live (DURING) → check
// + remember real results (END). This view renders only DURING/END, reading
// all build-flow state from the store. The live loop runs in local mode
// (hooks + Terminal open); remote/web falls back to a copy-paste command +
// the SessionEnd rollup. See
// docs/superpowers/specs/2026-07-02-build-coach-live-session-design.md.

type Step = 'during' | 'end';
const RAIL: Array<{ key: Step; label: string }> = [
  { key: 'during', label: 'DURING' },
  { key: 'end', label: 'END' },
];
const NEXT_LABEL: Record<Step, string> = {
  during: 'Wrap up →',
  end: 'Start over ↺',
};

const DEFAULT_BUDGET_ACTIONS = 12;

// Byte's coaching bubble — sprite + a line, a "lens" chip, and an expandable
// "a little tip from Byte" panel. Reused across both steps.
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

function DuringStep({
  plan,
  live,
  unlocked,
  launchCommand,
  local,
  buildSessionId,
  projectDir,
  brief,
  mode,
  resume,
  onLive,
  onStatus,
}: {
  plan: BytePlan | null;
  live: LiveState | null;
  unlocked: boolean;
  launchCommand: string | null;
  local: boolean;
  buildSessionId: string | null;
  projectDir: string;
  brief: string;
  mode: 'suggest' | 'copilot' | 'autopilot';
  resume: boolean;
  onLive: (s: LiveState) => void;
  onStatus: (status: string) => void;
}) {
  const target = plan?.budgetActions ?? DEFAULT_BUDGET_ACTIONS;
  const actions = live?.actionCount ?? 0;
  const pct = Math.min(100, Math.round((actions / target) * 100));
  const bs = budgetState(pct);
  const recent = live?.recentTools ?? [];
  const line = byteDuringLine(live, bs.warn);
  const [copied, setCopied] = useState(false);

  return (
    <div>
      <div className="bc-panel-h">Step 2 · building now</div>
      {local && plan && projectDir && buildSessionId && (
        <LiveChat
          buildSessionId={buildSessionId}
          projectDir={projectDir}
          plan={plan}
          brief={brief}
          mode={mode}
          resume={resume}
          onLive={onLive}
          onStatus={onStatus}
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
          Byte couldn&rsquo;t open a Terminal here (needs the local app). Two quick steps and Byte
          will follow along:
          <ol className="bc-cmd-steps">
            <li>Open the Terminal app on your computer.</li>
            <li>Paste this command and press Enter:</li>
          </ol>
          <pre className="bc-cmd">{launchCommand}</pre>
          <button
            className="bc-copy"
            onClick={() => {
              navigator.clipboard?.writeText(launchCommand).then(
                () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                },
                () => {},
              );
            }}
          >
            {copied ? 'Copied ✓' : 'Copy the command'}
          </button>
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
            {actions} actions · {target} planned
            {plan && plan.steps.length > 0 && (
              <span className="bc-plan-size"> · {plan.steps.length}-step plan</span>
            )}
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
  checkpoint,
  projectDir,
  onRewind,
}: {
  companyId: string | null;
  sessionId: string | null;
  plan: BytePlan | null;
  brief: string;
  actions: number;
  checkpoint: { ref: string } | null;
  projectDir: string;
  onRewind: () => void;
}) {
  const [ev, setEv] = useState<TrackEvent | null>(null);
  const [fetched, setFetched] = useState(false);
  const [saved, setSaved] = useState(false);
  // Two-step confirm — rewinding throws the build's changes away.
  const [confirmRewind, setConfirmRewind] = useState(false);
  // Which recap checklist items the founder has personally ticked off.
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [rewound, setRewound] = useState(false);
  // Plain "here's what Byte changed" — the files touched since the pre-build snapshot.
  const [changes, setChanges] = useState<{ files: string[]; count: number } | null>(null);

  useEffect(() => {
    const ref = checkpoint?.ref;
    if (!ref || !projectDir) return;
    let cancelled = false;
    buildChangeSummary(projectDir, ref).then((c) => {
      if (!cancelled) setChanges(c);
    });
    return () => {
      cancelled = true;
    };
  }, [checkpoint, projectDir]);
  const noSession = !companyId || !sessionId;
  const loaded = noSession || fetched;

  // The SessionEnd rollup often lands a few seconds after the session closes, so a
  // one-shot fetch would show commits "—" forever. Poll briefly until it appears;
  // the UI unblocks after the first attempt either way.
  useEffect(() => {
    if (noSession) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attempt = (remaining: number) => {
      loadTrackEventForSession(companyId, sessionId).then((e) => {
        if (cancelled) return;
        setFetched(true);
        if (e) {
          setEv(e);
        } else if (remaining > 0) {
          timer = setTimeout(() => attempt(remaining - 1), 2500);
        }
      });
    };
    attempt(5);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
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
            {/* Modifier classes are bc- prefixed: a bare `ok` collides with the
                global ✓-disc rule (Toast/doneflag) and paints a violet dot here. */}
            <div className="bc-rc">
              <label>spent</label>
              <div className={`v${underBudget ? ' bc-ok' : ' bc-warn'}`}>
                {actions} of {target} planned
              </div>
            </div>
            <div className="bc-rc">
              <label>committed</label>
              <div className={`v${commits >= 1 ? ' bc-ok' : ''}`}>
                {commits >= 1 ? `${commits} ✓` : '—'}
              </div>
            </div>
          </div>
          {/* The founder ticks each item — Byte never claims a step is verified for
              them. That IS the "Double-check" habit this screen teaches. */}
          <div className="bc-check-hint">Look at the result, then tick what checks out:</div>
          <ul className="bc-checklist">
            {[...(plan?.steps ?? []), `Matches what you asked for: ${brief}`].map((label, i) => (
              <li key={i}>
                <button
                  className={`c${checked.has(i) ? ' on' : ''}`}
                  aria-pressed={checked.has(i)}
                  onClick={() =>
                    setChecked((prev) => {
                      const next = new Set(prev);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      return next;
                    })
                  }
                >
                  {checked.has(i) ? '✓' : ''}
                </button>{' '}
                {label}
              </li>
            ))}
          </ul>
          <div className={`bc-unlock${earned ? ' live' : ''}`}>
            <div className="bc-unlock-top">
              <span className="bc-u-tag">{earned ? 'earned! ✨' : 'not yet'}</span>
              <b>The &ldquo;Double-check&rdquo; habit</b>
            </div>
            <p>
              {earned
                ? 'You finished under budget with something committed — Byte earned the Double-check habit for you!'
                : 'Your build still counts! This badge just tracks how it went: wrap up under budget with at least one commit and Byte earns it next time.'}
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
          {changes && changes.count > 0 && !rewound && (
            <div className="bc-changes">
              <div className="bc-changes-h">
                📝 Byte changed <b>{changes.count}</b> file{changes.count === 1 ? '' : 's'}
              </div>
              <div className="bc-changes-list">
                {changes.files.slice(0, 12).map((f) => (
                  <span key={f} className="bc-file">
                    {f}
                  </span>
                ))}
                {changes.count > 12 && (
                  <span className="bc-file more">+{changes.count - 12} more</span>
                )}
              </div>
            </div>
          )}
          {checkpoint && !rewound && (
            <div className="bc-rewind">
              {!confirmRewind ? (
                <button className="bc-rewind-btn" onClick={() => setConfirmRewind(true)}>
                  ↩ Rewind to before this build
                </button>
              ) : (
                <div className="bc-rewind-confirm">
                  <span>
                    This undoes <b>everything</b> this build changed in your project — it can’t be
                    reversed. Rewind?
                  </span>
                  <div className="bc-rewind-row">
                    <button
                      className="bc-rewind-yes"
                      onClick={() => {
                        onRewind();
                        setRewound(true);
                      }}
                    >
                      Yes, rewind
                    </button>
                    <button className="bc-rewind-no" onClick={() => setConfirmRewind(false)}>
                      Keep the changes
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {rewound && <div className="bc-ctx">↩ Rewound to your save point.</div>}
        </>
      )}
    </div>
  );
}

export function BuildCoachView() {
  const { companyId } = useAuth();
  const {
    buildStep,
    buildPlan,
    buildLive,
    buildLaunchCommand,
    buildLocal,
    buildSessionId,
    buildProjectDir,
    buildBrief,
    buildCheckpoint,
    rewindBuild,
    endBuild,
    buildAutonomy,
    buildResumed,
    applyLocalLive,
    resetBuildFlow,
  } = useApp();

  const step = buildStep;
  const actions = buildLive?.actionCount ?? 0;
  const sessionId = buildLive?.sessionId ?? null;
  const target = buildPlan?.budgetActions ?? DEFAULT_BUDGET_ACTIONS;
  const unlocked = budgetState(Math.min(100, Math.round((actions / target) * 100))).unlock;

  // Live session status (reported by LiveChat) + a two-step confirm for "Wrap up":
  // wrapping up tears the session down, so a mid-work click needs a second look.
  const [liveStatus, setLiveStatus] = useState<string>('');
  const [confirmWrap, setConfirmWrap] = useState(false);
  const busy = liveStatus === 'running' || liveStatus === 'awaiting-permission';

  // Wrap up is the explicit teardown now (unmount only detaches the stream, so
  // hot-reloads can't kill a build) — stop the server child, then flip to END.
  const wrapUp = () => {
    if (buildLocal && buildSessionId) stopBuildSession(buildSessionId);
    endBuild();
  };

  const idx = step === 'during' ? 0 : 1;

  return (
    <section className="view on bc-view" id="v-build">
      <div className="vhead">
        <h1>Let&rsquo;s build</h1>
        <div className="sub">
          Byte watches your real Claude Code session, then helps you check &amp; remember what you
          built.
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

        {step === 'during' && (
          <DuringStep
            plan={buildPlan}
            live={buildLive}
            unlocked={unlocked}
            launchCommand={buildLaunchCommand}
            local={buildLocal}
            buildSessionId={buildSessionId}
            projectDir={buildProjectDir}
            brief={buildBrief}
            mode={buildAutonomy}
            resume={buildResumed}
            onLive={applyLocalLive}
            onStatus={setLiveStatus}
          />
        )}
        {step === 'end' && (
          <EndStep
            companyId={companyId}
            sessionId={sessionId}
            plan={buildPlan}
            brief={buildBrief}
            actions={actions}
            checkpoint={buildCheckpoint}
            projectDir={buildProjectDir}
            onRewind={rewindBuild}
          />
        )}

        <div className="bc-nav">
          {step === 'during' &&
            (confirmWrap ? (
              <div className="bc-wrap-confirm">
                <span>
                  Byte is still working — wrapping up <b>stops the session</b> mid-task. Wrap up
                  anyway?
                </span>
                <div className="bc-wrap-row">
                  <button className="bc-wrap-yes" onClick={wrapUp}>
                    Yes, wrap up
                  </button>
                  <button className="bc-wrap-no" onClick={() => setConfirmWrap(false)}>
                    Keep building
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="bc-next"
                onClick={() => {
                  // A busy local session deserves a second look; an idle (or remote)
                  // one wraps up immediately.
                  if (buildLocal && busy) setConfirmWrap(true);
                  else wrapUp();
                }}
              >
                {NEXT_LABEL.during}
              </button>
            ))}
          {step === 'end' && (
            <button
              className="bc-next"
              onClick={() => {
                setConfirmWrap(false);
                setLiveStatus('');
                resetBuildFlow();
              }}
            >
              {NEXT_LABEL.end}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
