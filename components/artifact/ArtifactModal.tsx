'use client';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import { DEPTS, reviseText, type Task, type Dept, type LibItem } from '@/lib/data';
import { artType, artMeta, buildLog, RICH_META, type LogStep } from '@/lib/helpers';
import { runByteTask, GenerateError, type RunResult } from '@/lib/ai/runTask';
import { LIVE_TYPES, liveKind, currentDraft, applyResult } from '@/lib/ai/applyResult';
import { ArtifactViewer } from './viewers';

// Scrollable modal body with a soft bottom fade that shows only while there's more
// content below the fold — a scroll cue, since macOS hides the scrollbar. Used by
// every deliverable modal (view / run / result).
function ModalBody({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
    check();
    el.addEventListener('scroll', check, { passive: true });
    // Re-check when the body resizes OR its content changes height (viewer mounts,
    // text types out, a revise swaps the payload).
    const ro = new ResizeObserver(check);
    ro.observe(el);
    const mo = new MutationObserver(check);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      el.removeEventListener('scroll', check);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);
  return (
    <div className={`mbody${more ? ' has-more' : ''}`} ref={ref}>
      {children}
    </div>
  );
}

function Phx({ a }: { a: number }) {
  const ph = (i: number, label: string) => (
    <span className={`ph ${a === i ? 'on' : a > i ? 'done' : ''}`}>
      <span className="pn">{a > i ? '✓' : i + 1}</span>
      {label}
    </span>
  );
  return (
    <div className="phx">
      {ph(0, 'Outline')}
      <span className="pa">→</span>
      {ph(1, 'Execute')}
      <span className="pa">→</span>
      {ph(2, 'Deliver')}
    </div>
  );
}

/* streaming execute log */
function ExecLog({
  steps,
  title,
  onDone,
}: {
  steps: LogStep[];
  title: string;
  onDone: () => void;
}) {
  const [shown, setShown] = useState(0);
  const [complete, setComplete] = useState(false);
  const actions = useRef(0);
  const [actionCount, setActionCount] = useState(0);

  useEffect(() => {
    setShown(0);
    setComplete(false);
    actions.current = 0;
    setActionCount(0);
    let i = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const tick = () => {
      if (i < steps.length) {
        const s = steps[i];
        actions.current += 3 + ((s.t || s.ck || '').length % 6);
        setActionCount(actions.current);
        i++;
        setShown(i);
        timers.push(setTimeout(tick, s.ck ? 700 : s.mono ? 340 : 520));
      } else {
        setComplete(true);
        timers.push(setTimeout(onDone, 320));
      }
    };
    timers.push(setTimeout(tick, 40));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps]);

  return (
    <div className="exec">
      <div className="exec-h">
        <span className="spin" />
        <span>{title}</span>
        <span className="ec">Ran {actionCount} actions</span>
      </div>
      <div className="exec-log">
        {steps.slice(0, shown).map((s, i) => {
          const live = i === shown - 1 && !complete;
          if (s.ck)
            return (
              <div className="exec-ck" key={i}>
                <span className="ckd" />
                <span>{s.ck}</span>
              </div>
            );
          if (s.mono)
            return (
              <div className={`wrow mono${live ? ' live' : ''}`} key={i}>
                <span className="wk tk0">›</span>
                <span className="wm" dangerouslySetInnerHTML={{ __html: s.t || '' }} />
              </div>
            );
          return (
            <div className={`wrow${live ? ' live' : ''}`} key={i}>
              <span className="wk">{live ? '' : '✓'}</span>
              <span>{s.t}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* typewriter for plain-text deliverables */
function TypeOut({ text, onDone }: { text: string; onDone: () => void }) {
  const lines = text.split('\n');
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    let i = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const tick = () => {
      if (i < lines.length) {
        i++;
        setN(i);
        timers.push(setTimeout(tick, 32));
      } else onDone();
    };
    timers.push(setTimeout(tick, 32));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (
    <>
      {lines.slice(0, n).join('\n')}
      {n < lines.length && <span className="cursor" />}
    </>
  );
}

type Stage = 'outline' | 'exec' | 'deliver' | 'revise' | 'result';

// One-line "what byte will make" for the Outline stage, by deliverable type. Pure
// framing (no API call) — the personalized "why" comes from the department/task text.
function planFor(type: string): string {
  switch (type) {
    case 'site':
      return 'A one-page site — hero, how-it-works, feature cards, and a call-to-action. On-brand and shippable.';
    case 'post':
      return 'Three launch-post variants that take different angles, ready to A/B.';
    case 'email':
      return 'A launch email — subject, body, and a short follow-up sequence.';
    case 'legal':
      return 'A real, formatted legal document in plain language, flagged for review.';
    case 'screens':
      return 'Three onboarding screens that get a new user to their first value in under two minutes.';
    case 'sheet':
      return 'An interactive pricing model tuned to your numbers — drag the inputs, watch MRR and LTV move.';
    case 'dms':
      return 'Four personalized 1:1 outreach drafts — a per-person DM, not a broadcast.';
    case 'calendar':
      return 'A two-week content calendar tuned to your product and audience.';
    case 'checklist':
      return 'A concrete setup and launch checklist you can work through step by step.';
    case 'plan':
      return 'A code-change plan — the goal, the approach, and the areas it touches — ready to hand to your coding agent.';
    case 'build':
      return 'A real, working piece wired up and verified.';
    case 'prep':
      return 'A prepared brief you can act on.';
    default:
      return 'A real, ready-to-use deliverable — not a description of one.';
  }
}

export function ArtifactModal() {
  const { modal, closeModal, approveTask, openDeliverable, runTask, toast, brief, toggleCopilot } =
    useApp();
  const [stage, setStage] = useState<Stage>('exec');
  // Run mode docks as a right-hand panel so the map stays visible as context;
  // "Expand" swaps to a full centered card for the rich deliverables that need room.
  const [expanded, setExpanded] = useState(false);
  const [rev, setRev] = useState<string | null>(null);
  const [execKind, setExecKind] = useState<'task' | 'revise'>('task');
  const [deliverReady, setDeliverReady] = useState(false);
  const [approved, setApproved] = useState<{ item: LibItem; next?: Task; built: boolean } | null>(
    null,
  );
  const [reviseNote, setReviseNote] = useState('');
  const [picked, setPicked] = useState('');
  // Live-generation status for plain-text deliverables (Phase 3).
  const [genStatus, setGenStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  // The error code from a failed live pass, so the error line can be specific
  // (e.g. the daily cost cap) rather than the generic "couldn't reach byte".
  const [genError, setGenError] = useState<string>('');

  // (re)initialize when a run modal opens for a task
  const task = modal?.kind === 'run' ? modal.task : null;
  useEffect(() => {
    if (modal?.kind === 'run') {
      // Open on the Outline stage — show why the task matters + what byte will make,
      // and wait for the user to hit "Run it". Nothing executes (and no paid call
      // fires) until they green-light it: comprehension + control before action.
      setStage('outline');
      setRev(null);
      setExecKind('task');
      setDeliverReady(false);
      setApproved(null);
      setReviseNote('');
      setPicked('');
      setGenStatus('idle');
      setGenError('');
      setExpanded(false);
      // The work panel docks where the chat lives — collapse the chat so one thing
      // owns the right at a time (it's a tap away on its floating button).
      toggleCopilot(true);
    }
  }, [modal, task, toggleCopilot]);

  if (!modal) return null;

  /* ---------- VIEW MODE ---------- */
  if (modal.kind === 'view') {
    const item = modal.item;
    return (
      <div className="artmodal on">
        <div className="mcard">
          <div className="mhead">
            <div className={`di c-${item.k}`}>{item.ab}</div>
            <div>
              <div className="mt">{item.title}</div>
              <div className="ms">{item.dept} · in Library</div>
            </div>
            <div className="mx" onClick={closeModal}>
              ✕
            </div>
          </div>
          <ModalBody>
            <ArtifactViewer item={item} />
          </ModalBody>
          <div className="mfoot">
            <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={closeModal}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ---------- RUN MODE ---------- */
  const t = modal.task,
    d = modal.dept,
    walk = modal.walk;
  const type = artType(t, walk);
  const logType = RICH_META[type]?.log || type;

  const reviseChips =
    type === 'site'
      ? ['Punchier hero', 'Warmer tone', 'More technical', 'Lead with privacy']
      : type === 'screens'
        ? ['Fewer words', 'Warmer copy', 'Stronger CTA']
        : type === 'sheet'
          ? ['More conservative', 'Show annual', 'Add a Team case']
          : ['Make it shorter', 'Warmer tone', 'More specific', 'Punchier'];

  const M = (s: string): LogStep => ({ t: s, mono: true });
  const L = (s: string): LogStep => ({ t: s });
  const CK = (s: string): LogStep => ({ ck: s });
  const reviseSteps = (note: string): LogStep[] => [
    L('Re-reading your note and the current draft'),
    M('applying: <span class="ad">' + note + '</span>'),
    CK('Checkpoint — re-checked against the brief'),
    M('<span class="ad">✓</span> revised — opening v2 below'),
  ];

  // "Run it" from the Outline stage: move into Execute and kick off the live pass
  // (the same generation that used to fire on open). On failure the loop falls back
  // to the authored draft so it never dead-ends.
  const startRun = () => {
    setExecKind('task');
    setDeliverReady(false);
    setGenStatus('idle');
    setGenError('');
    setStage('exec');

    const kind = liveKind(type);
    if (kind) {
      setGenStatus('loading');
      runByteTask({
        kind,
        taskTitle: t.t,
        taskHint: t.d || (typeof t.out === 'string' ? t.out.slice(0, 160) : undefined),
        deptName: d.name,
        brief,
      })
        .then((res) => {
          applyResult(t, type, res);
          setGenStatus('done');
        })
        .catch((err) => {
          console.error('[byte] live generation failed', err);
          setGenError(err instanceof GenerateError ? err.code : '');
          setGenStatus('error');
        });
    }
  };

  const sendRevision = () => {
    const note = reviseNote.trim() || picked || 'Tighten it up';
    setRev(note);
    setExecKind('revise');
    setDeliverReady(false);
    setStage('exec');

    const kind = liveKind(type);
    if (kind) {
      // byte runs another live pass, revising the current draft against the note.
      setGenStatus('loading');
      runByteTask({
        kind,
        taskTitle: t.t,
        taskHint: t.d,
        deptName: d.name,
        reviseNote: note,
        current: currentDraft(t, type),
        brief,
      })
        .then((res) => {
          applyResult(t, type, res);
          setGenStatus('done');
        })
        .catch((err) => {
          console.error('[byte] live revise failed', err);
          setGenError(err instanceof GenerateError ? err.code : '');
          setGenStatus('error');
        });
    } else {
      // Non-live types still use the local mock revise.
      t.out = reviseText(t.out, note);
    }
  };

  const onApprove = () => {
    const res = approveTask(t, d, type);
    const built = type === 'build' || type === 'site';
    setApproved({ ...res, built });
    setStage('result');
  };

  // header subtitle
  const ms =
    stage === 'outline'
      ? `${d.name} · Outline`
      : stage === 'exec' && execKind === 'revise'
        ? `${d.name} · Revising`
        : stage === 'deliver'
          ? `${d.name} · Deliver${rev ? ' · v2' : ''}`
          : stage === 'revise'
            ? `${d.name} · Request changes`
            : `${d.name} · Execute`;

  // deliver: vstat text & whether the body is a typed-out plain doc
  const item = { ...t, type, ...artMeta(t, type) };
  const plainDeliver = !(
    type === 'site' ||
    type === 'screens' ||
    type === 'sheet' ||
    RICH_META[type]
  );
  const vstat =
    type === 'site' ? (
      <>
        Built &amp; verified — ran in the sandbox on <span className="vmono">localhost:3001</span>,
        screenshot passed
      </>
    ) : type === 'screens' ? (
      <>Prototype ready — tap through all three screens to feel the first run</>
    ) : type === 'sheet' ? (
      <>Model is live — drag any input to see the price band move</>
    ) : RICH_META[type] ? (
      <>{RICH_META[type].vstat}</>
    ) : type === 'build' ? (
      <>
        Verified — change is live in your project ·{' '}
        <span className="vmono">merged to main · 218 tests pass</span>
      </>
    ) : type === 'prep' ? (
      <>Ready for you to run — every step checked against your roadmap</>
    ) : (
      <>First draft ready — written from your brief, in your voice</>
    );

  // The line shown when a live pass fails. A rate-limit is a friendly, specific
  // message (the account hit today's cap); anything else falls back to the generic
  // "showing the saved draft" note.
  const liveErrorMsg =
    genError === 'rate_limited'
      ? 'You’ve reached today’s generation limit — it resets tomorrow. Showing the saved draft.'
      : 'Couldn’t reach byte just now — showing the saved draft.';

  const olLabel: React.CSSProperties = {
    fontSize: 11,
    letterSpacing: '.08em',
    textTransform: 'uppercase',
    color: 'var(--t-3)',
    marginBottom: 7,
  };

  let bodyContent: React.ReactNode;
  if (stage === 'outline') {
    bodyContent = (
      <>
        <Phx a={0} />
        <div style={{ padding: '4px 2px' }}>
          <div style={{ marginBottom: 20 }}>
            <div style={olLabel}>Why this matters</div>
            <p style={{ margin: 0, color: 'var(--t-1)', lineHeight: 1.55 }}>{d.need}</p>
          </div>
          <div>
            <div style={olLabel}>What byte will make</div>
            <p style={{ margin: 0, color: 'var(--t-1)', lineHeight: 1.55 }}>
              {t.d || planFor(type)}
            </p>
          </div>
        </div>
      </>
    );
  } else if (stage === 'exec') {
    const steps = execKind === 'revise' ? reviseSteps(rev || '') : buildLog(t, logType, d);
    const title =
      execKind === 'revise' ? <>byte is revising — “{rev}”</> : 'byte is doing the work…';
    bodyContent = (
      <>
        <Phx a={1} />
        <ExecLog
          key={execKind}
          steps={steps}
          title={title as unknown as string}
          onDone={() => {
            setDeliverReady(false);
            setStage('deliver');
          }}
        />
      </>
    );
  } else if (stage === 'deliver') {
    bodyContent = (
      <>
        <Phx a={2} />
        {rev && (
          <div
            className="vstat"
            style={{
              background: 'var(--gold-tint)',
              borderColor: 'var(--gold-line)',
              color: 'var(--gold-deep)',
            }}
          >
            <span className="vk" style={{ background: 'var(--gold)' }}>
              ↻
            </span>
            <span>
              Revised — byte applied: <b>{rev}</b>
            </span>
          </div>
        )}
        <div className="vstat">
          <span className="vk">✓</span>
          <span>{vstat}</span>
        </div>
        {plainDeliver ? (
          <div className="artifact">
            <div className={`art-bar ${type}`}>
              <span>{item.head}</span>
              <span className="art-file">{item.file}</span>
              <span dangerouslySetInnerHTML={{ __html: item.tag }} />
            </div>
            <div className="art-body" style={{ whiteSpace: 'pre-wrap' }}>
              {LIVE_TYPES.has(type) && genStatus === 'loading' ? (
                <span style={{ color: 'var(--t-3)' }}>
                  byte is writing this live with Claude…
                  <span className="cursor" />
                </span>
              ) : (
                <>
                  {LIVE_TYPES.has(type) && genStatus === 'done' && (
                    <div style={{ fontSize: 12, color: 'var(--accent-deep)', marginBottom: 10 }}>
                      ✦ Written live by byte · Claude
                    </div>
                  )}
                  {LIVE_TYPES.has(type) && genStatus === 'error' && (
                    <div style={{ fontSize: 12, color: 'var(--clay)', marginBottom: 10 }}>
                      {liveErrorMsg}
                    </div>
                  )}
                  <TypeOut text={t.out} onDone={() => setDeliverReady(true)} />
                </>
              )}
            </div>
          </div>
        ) : LIVE_TYPES.has(type) && genStatus === 'loading' ? (
          <div className="artifact">
            <div className="art-body" style={{ whiteSpace: 'pre-wrap' }}>
              <span style={{ color: 'var(--t-3)' }}>
                byte is writing this live with Claude…
                <span className="cursor" />
              </span>
            </div>
          </div>
        ) : (
          <>
            {LIVE_TYPES.has(type) && genStatus === 'done' && (
              <div style={{ fontSize: 12, color: 'var(--accent-deep)', marginBottom: 10 }}>
                ✦ Written live by byte · Claude
              </div>
            )}
            {LIVE_TYPES.has(type) && genStatus === 'error' && (
              <div style={{ fontSize: 12, color: 'var(--clay)', marginBottom: 10 }}>
                Couldn’t reach byte just now — showing the saved draft.
              </div>
            )}
            <ViewerOnce item={item} onReady={() => setDeliverReady(true)} />
          </>
        )}
      </>
    );
  } else if (stage === 'revise') {
    bodyContent = (
      <div className="revise">
        <div className="rv-h">
          <span className="byte s28" style={{ width: 24, height: 24 }}>
            <img className="bimg" src="/byte.png" alt="byte" />
          </span>
          <div>
            Tell byte what to change — it’ll run another pass and bring back a revised version.
          </div>
        </div>
        <div className="rv-chips">
          {reviseChips.map((c) => (
            <button
              key={c}
              type="button"
              className={`rv-chip${picked === c ? ' on' : ''}`}
              onClick={() => {
                setPicked(c);
                if (!reviseNote.trim()) setReviseNote(c);
              }}
            >
              {c}
            </button>
          ))}
        </div>
        <textarea
          className="rv-in"
          placeholder="e.g. lead with the privacy angle and tighten the hero…"
          value={reviseNote}
          onChange={(e) => setReviseNote(e.target.value)}
        />
      </div>
    );
  } else if (stage === 'result' && approved) {
    bodyContent = <ResultBody t={t} d={d} type={type} info={approved} />;
  }

  // footer per stage
  let footer: React.ReactNode = null;
  if (stage === 'outline') {
    footer = (
      <>
        <button className="btn" onClick={startRun}>
          Run it
        </button>
        <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={closeModal}>
          Not now
        </button>
      </>
    );
  } else if (stage === 'deliver' && deliverReady) {
    const okLabel =
      RICH_META[type]?.ok ||
      (type === 'site'
        ? 'Ship the site'
        : type === 'screens'
          ? 'Approve the flow'
          : type === 'sheet'
            ? 'Save the model'
            : type === 'build'
              ? 'Looks right — log it'
              : 'Approve');
    footer = (
      <>
        <button className="btn" onClick={onApprove}>
          {okLabel}
        </button>
        <button className="btn ghost" onClick={() => setStage('revise')}>
          Request changes
        </button>
        <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={closeModal}>
          Close
        </button>
      </>
    );
  } else if (stage === 'revise') {
    footer = (
      <>
        <button className="btn" onClick={sendRevision}>
          Send to byte
        </button>
        <button className="btn ghost" onClick={() => setStage('deliver')}>
          Back to the draft
        </button>
        <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={closeModal}>
          Close
        </button>
      </>
    );
  } else if (stage === 'result' && approved) {
    const { item: it, next, built } = approved;
    footer = (
      <>
        {/* The deliverable is saved — the useful next move is back to byte, not a
            pointless copy. byte already knows the advanced next step. */}
        <button
          className="btn"
          onClick={() => {
            closeModal();
            toggleCopilot(false);
          }}
        >
          Continue with byte
        </button>
        {next && (
          <button className="btn ghost" onClick={() => runTask(next, d, next.who === 'you')}>
            Do the next one →
          </button>
        )}
        {type === 'site' && (
          <button className="btn ghost" onClick={() => openDeliverable(it)}>
            Open the site ↗
          </button>
        )}
        <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={closeModal}>
          Close
        </button>
      </>
    );
    void built;
    void DEPTS;
  }

  // Run flow docks to the right (map stays as context) unless the user expands it.
  const wrapClass = `artmodal on run${expanded ? '' : ' docked'}`;
  const expandBtn = (
    <button
      className="mexp"
      onClick={() => setExpanded((e) => !e)}
      title={expanded ? 'Dock to the side' : 'Expand to full screen'}
      aria-label={expanded ? 'Dock' : 'Expand'}
    >
      {expanded ? 'Dock' : 'Expand'}
    </button>
  );

  // result mode uses its own header
  if (stage === 'result' && approved) {
    const built = approved.built;
    return (
      <div className={wrapClass}>
        <div className="mcard">
          <div className="mhead">
            <div className={`di c-${d.k}`}>{d.ab}</div>
            <div>
              <div className="mt">
                {built ? 'Shipped' : 'Approved'} · {t.t}
              </div>
              <div className="ms">{d.name}</div>
            </div>
            {expandBtn}
            <div className="mx" onClick={closeModal}>
              ✕
            </div>
          </div>
          <ModalBody>{bodyContent}</ModalBody>
          <div className="mfoot">{footer}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={wrapClass}>
      <div className="mcard">
        <div className="mhead">
          <div className={`di c-${d.k}`}>{d.ab}</div>
          <div>
            <div className="mt">{t.t}</div>
            <div className="ms">{ms}</div>
          </div>
          {expandBtn}
          <div className="mx" onClick={closeModal}>
            ✕
          </div>
        </div>
        <ModalBody>{bodyContent}</ModalBody>
        <div className="mfoot">{footer}</div>
      </div>
    </div>
  );
}

// render a rich viewer and signal readiness once mounted
function ViewerOnce({ item, onReady }: { item: any; onReady: () => void }) {
  useEffect(() => {
    onReady(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);
  return <ArtifactViewer item={item} />;
}

function ResultBody({
  t,
  d,
  type,
  info,
}: {
  t: Task;
  d: Dept;
  type: string;
  info: { item: LibItem; next?: Task; built: boolean };
}) {
  const { item, next, built } = info;
  const hasThumb = type === 'site';
  const prev = t.out.split('\n').slice(0, 5).join('\n');
  const okWord =
    type === 'site'
      ? 'Site shipped'
      : type === 'screens'
        ? 'Flow approved'
        : type === 'sheet'
          ? 'Model saved'
          : type === 'checklist'
            ? 'Added to plan'
            : built
              ? 'Shipped & logged'
              : 'Approved & saved';
  const savedLine =
    type === 'site' ? (
      <>
        The site is live at <b>code-pet.com</b> — open or download it any time.
      </>
    ) : type === 'screens' ? (
      <>
        The prototype is in your <b>Library</b> — tap through it any time.
      </>
    ) : type === 'sheet' ? (
      <>
        The live model is saved to your <b>Library</b> — re-open and adjust it any time.
      </>
    ) : type === 'plan' ? (
      <>
        Saved to your <b>Library</b> — hand it to your coding agent to implement.
      </>
    ) : type === 'checklist' ? (
      <>
        Tracked in your <b>plan</b> — tick items off any time.
      </>
    ) : built ? (
      <>The change is live in your project, verified.</>
    ) : (
      <>
        Saved to your <b>Library</b> — open it any time.
      </>
    );
  return (
    <div className="result">
      <div className="rok">
        <span className="ok">✓</span> {okWord}
      </div>
      {hasThumb ? (
        <div className="rprev site">
          <div className="rp-bar build">
            <span>{item.head}</span>
            <span className="rp-file">{item.file}</span>
          </div>
          <div className="rp-thumb">
            <iframe sandbox="allow-same-origin" scrolling="no" title="thumb" srcDoc={t.site} />
          </div>
        </div>
      ) : (
        <div className="rprev">
          <div className={`rp-bar ${RICH_META[type] ? 'doc' : type}`}>
            <span>{item.head}</span>
            <span className="rp-file">{item.file}</span>
          </div>
          <div className="rp-body">{prev}</div>
        </div>
      )}
      <div className="rwhat">
        <div>• {savedLine}</div>
        <div>
          • <b>{d.name}</b> —{' '}
          {d.pend > 0 ? `${d.pend} task${d.pend > 1 ? 's' : ''} left` : 'all clear ✓'}
        </div>
        <div>
          • Moves <b>Roadmap · Run the closed beta</b> forward.
        </div>
      </div>
      <div className="rnext">
        {next ? (
          <>
            Next up in {d.name}:<br />
            <b>{next.t}</b>
          </>
        ) : (
          <>That clears {d.name}. Nice — pick the next department when you’re ready.</>
        )}
      </div>
    </div>
  );
}
