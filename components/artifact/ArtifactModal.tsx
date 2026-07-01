'use client';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import { DEPTS, reviseText, type Task, type Dept, type LibItem } from '@/lib/data';
import { artType, artMeta, buildLog, RICH_META, type LogStep } from '@/lib/helpers';
import { runByteTask, type DeliverableKind, type RunResult } from '@/lib/ai/runTask';
import { buildSheetInputs } from '@/lib/ai/sheetModel';
import { renderSiteHtml } from '@/lib/ai/siteTemplate';
import { ArtifactViewer } from './viewers';

// Deliverable types byte generates live via the Claude API. Plain-text
// (doc/prep) come back as text; post/email/legal/screens/sheet/site come back as
// structured payloads. The remaining types (calendar/dms/checklist/pr) still use
// their authored payloads.
const LIVE_TYPES = new Set(['doc', 'prep', 'post', 'email', 'legal', 'screens', 'sheet', 'site']);

function liveKind(type: string): DeliverableKind | null {
  if (type === 'doc' || type === 'prep') return 'text';
  if (
    type === 'post' ||
    type === 'email' ||
    type === 'legal' ||
    type === 'screens' ||
    type === 'sheet' ||
    type === 'site'
  )
    return type;
  return null;
}

// The current draft byte revises against (structured payloads serialized to JSON).
function currentDraft(t: Task, type: string): string {
  if (type === 'post') return JSON.stringify(t.post ?? {});
  if (type === 'email') return JSON.stringify(t.email ?? {});
  if (type === 'legal') return JSON.stringify(t.legal ?? {});
  if (type === 'screens') return JSON.stringify(t.screens ?? []);
  if (type === 'sheet') return JSON.stringify(t.sheet ?? {});
  // Site revises against the structured spec (small), not the rendered HTML.
  if (type === 'site') return JSON.stringify(t.siteSpec ?? {});
  return typeof t.out === 'string' ? t.out : '';
}

// Apply byte's result onto the task, merging structured payloads with the
// presentational defaults the viewers expect (author/stats/from/updated).
function applyResult(t: Task, type: string, res: RunResult): void {
  if (type === 'post' && res.payload) {
    const p = res.payload as { variants?: Array<{ label: string; body: string }> };
    if (p.variants?.length) {
      t.post = {
        author: t.post?.author ?? 'byte',
        handle: t.post?.handle ?? '@codepet',
        stats: t.post?.stats ?? { replies: 18, reposts: 34, likes: 210 },
        variants: p.variants,
      };
    }
  } else if (type === 'email' && res.payload) {
    // Only apply when the arrays the viewer maps over (body, seq) are present —
    // otherwise keep the seed rather than hand EmailViewer an undefined .map().
    const e = res.payload as Record<string, unknown>;
    if (Array.isArray(e.body) && Array.isArray(e.seq)) {
      t.email = {
        from: t.email?.from ?? 'byte',
        fromAddr: t.email?.fromAddr ?? 'hello@code-pet.com',
        subject: e.subject,
        preheader: e.preheader,
        body: e.body,
        cta: e.cta,
        seq: e.seq,
      };
    }
  } else if (type === 'legal' && res.payload) {
    // Same guard: sections is what LegalViewer maps over.
    const l = res.payload as Record<string, unknown>;
    if (Array.isArray(l.sections)) {
      t.legal = {
        docTitle: l.docTitle,
        updated: t.legal?.updated ?? 'Draft · for your review',
        sections: l.sections,
        flag: l.flag,
      };
    }
  } else if (type === 'screens' && res.payload) {
    const s = res.payload as { screens?: unknown[] };
    if (Array.isArray(s.screens) && s.screens.length) t.screens = s.screens;
  } else if (type === 'sheet' && res.payload) {
    // Rebuild the fixed 4-input array (clamped/finite) from byte's values; keep the
    // seed if the payload is unusable. The summary becomes the library `out` text.
    const inputs = buildSheetInputs(res.payload);
    if (inputs) {
      t.sheet = { inputs };
      const summary = (res.payload as { summary?: unknown }).summary;
      if (typeof summary === 'string' && summary.trim()) t.out = summary;
    }
  } else if (type === 'site' && res.payload) {
    // Render byte's structured spec into the fixed HTML template (code owns the
    // markup). Keep the seed if the payload can't make a real page. Stash the spec
    // so a later revise pass edits the spec, not the HTML; sub becomes library text.
    const html = renderSiteHtml(res.payload);
    if (html) {
      t.site = html;
      t.siteSpec = res.payload as Record<string, unknown>;
      const sub = (res.payload as { sub?: unknown }).sub;
      if (typeof sub === 'string' && sub.trim()) t.out = sub;
    }
  } else if (typeof res.text === 'string' && res.text) {
    t.out = res.text;
  }
}

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
      {ph(0, 'Execute')}
      <span className="pa">→</span>
      {ph(1, 'Deliver')}
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

type Stage = 'exec' | 'deliver' | 'revise' | 'result';

export function ArtifactModal() {
  const { modal, closeModal, approveTask, viewItem, runTask, show, toast, brief } = useApp();
  const [stage, setStage] = useState<Stage>('exec');
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

  // (re)initialize when a run modal opens for a task
  const task = modal?.kind === 'run' ? modal.task : null;
  useEffect(() => {
    if (modal?.kind === 'run') {
      setStage('exec');
      setRev(null);
      setExecKind('task');
      setDeliverReady(false);
      setApproved(null);
      setReviseNote('');
      setPicked('');
      setGenStatus('idle');

      // byte generates the real deliverable via the Claude API while the execute
      // log animates. On failure we fall back to the authored draft so the loop
      // never dead-ends.
      const tk = modal.task;
      const dp = modal.dept;
      const ty = artType(tk, modal.walk);
      const kind = liveKind(ty);
      if (kind) {
        setGenStatus('loading');
        runByteTask({
          kind,
          taskTitle: tk.t,
          taskHint: tk.d || (typeof tk.out === 'string' ? tk.out.slice(0, 160) : undefined),
          deptName: dp.name,
          brief,
        })
          .then((res) => {
            applyResult(tk, ty, res);
            setGenStatus('done');
          })
          .catch((err) => {
            console.error('[byte] live generation failed', err);
            setGenStatus('error');
          });
      }
    }
  }, [modal, task]);

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
          setGenStatus('error');
        });
    } else {
      // Non-live types (calendar/dms/checklist/pr) still use the local mock revise.
      t.out = reviseText(t.out, note);
    }
  };

  const onApprove = () => {
    const res = approveTask(t, d, type);
    const built = type === 'build' || type === 'site' || type === 'pr';
    setApproved({ ...res, built });
    setStage('result');
  };

  // header subtitle
  const ms =
    stage === 'exec' && execKind === 'revise'
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

  let bodyContent: React.ReactNode;
  if (stage === 'exec') {
    const steps = execKind === 'revise' ? reviseSteps(rev || '') : buildLog(t, logType, d);
    const title =
      execKind === 'revise' ? <>byte is revising — “{rev}”</> : 'byte is doing the work…';
    bodyContent = (
      <>
        <Phx a={0} />
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
        <Phx a={1} />
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
                      Couldn’t reach byte just now — showing the saved draft.
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
  if (stage === 'deliver' && deliverReady) {
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
        <button className="btn ghost" onClick={() => viewItem(it)}>
          {type === 'site'
            ? 'Open the site'
            : type === 'screens'
              ? 'Open the screens'
              : type === 'sheet'
                ? 'Open the model'
                : 'Open the file'}
        </button>
        {next ? (
          <button className="btn" onClick={() => runTask(next, d, next.who === 'you')}>
            Do the next one →
          </button>
        ) : (
          <button
            className="btn"
            onClick={() => {
              closeModal();
              show('home');
            }}
          >
            Back to company
          </button>
        )}
        <button
          className="btn ghost"
          style={{ marginLeft: 'auto' }}
          onClick={() => {
            closeModal();
          }}
        >
          Close
        </button>
      </>
    );
    void built;
    void DEPTS;
  }

  // result mode uses its own header
  if (stage === 'result' && approved) {
    const built = approved.built;
    return (
      <div className="artmodal on">
        <div className="mcard">
          <div className="mhead">
            <div className={`di c-${d.k}`}>{d.ab}</div>
            <div>
              <div className="mt">
                {built ? 'Shipped' : 'Approved'} · {t.t}
              </div>
              <div className="ms">{d.name}</div>
            </div>
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
    <div className="artmodal on">
      <div className="mcard">
        <div className="mhead">
          <div className={`di c-${d.k}`}>{d.ab}</div>
          <div>
            <div className="mt">{t.t}</div>
            <div className="ms">{ms}</div>
          </div>
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
    ) : type === 'pr' ? (
      <>The change is live in your project, verified.</>
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
