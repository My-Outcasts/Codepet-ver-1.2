'use client';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import { track } from '@/lib/analytics';
import { DEPTS, ENV, ENV_META } from '@/lib/data';
import { cleanCompanyName } from '@/lib/companyName';
import { resolveEnvIndex } from '@/lib/ai/envSetup';
import { QUESTION_FOR } from '@/lib/ai/enrichInterview';
import { Companion } from './Companion';
import { companionById, companionForDept } from '@/lib/companions';
import { ExecLog, StaticLog } from './artifact/ExecLog';
import { stepCountLabel } from '@/lib/helpers';
import type { ChatMessage } from '@/lib/store';
import { sortThreadsByRecent, relativeTime } from '@/lib/chat/threads';

// GitHub-backed cloud build (Task 12/13): when on, the start-building block offers a
// repo picker instead of a local project picker. Mirrors the same public flag read in
// lib/store.tsx's armBuild — gated so demo-only/local/self-hosted installs are untouched.
const cloudRepoBuild = process.env.NEXT_PUBLIC_CLOUD_REPO_BUILD === '1';

// Quick-start prompts shown only before the first message — they send to byte.
const CHIPS = [
  'What should I focus on first?',
  'Summarize where my company is',
  'What’s blocking my launch?',
];

// byte is told to write plain text, but strip stray markdown emphasis as a safety
// net so a leftover **…**, `code`, or __…__ never renders as literal punctuation.
function plain(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`]+?)`/g, '$1')
    .replace(/(^|\s)\*(\S.*?\S)\*(?=\s|$)/g, '$1$2');
}

// Friendly noun for each deliverable type, shown on the inline result card.
const TYPE_NOUN: Record<string, string> = {
  doc: 'Doc',
  prep: 'Prep',
  build: 'Build',
  post: 'Post',
  email: 'Email',
  legal: 'Doc',
  screens: 'Screens',
  sheet: 'Model',
  site: 'Landing page',
  dms: 'Messages',
  calendar: 'Calendar',
  checklist: 'Checklist',
  plan: 'Plan',
};

// Quick revise directions offered on a produced card — one tap re-runs with that note.
const REVISE_CHIPS = ['Shorter', 'More detail', 'Punchier'];

// An inline deliverable byte produced in chat — the "run it from here" result.
// Reads the live task so the preview reflects the fresh output; Approve / Open /
// Revise keep the founder in the conversation. Revise re-runs the task against a
// typed or chip note (empty = plain regenerate) and updates this card in place.
function ResultCard({ m }: { m: ChatMessage }) {
  const { reviseTaskInChat, approveChatResult, openChatResult } = useApp();
  // A deliverable is voiced by the pet of the task's own department, not the current focus.
  const companionName = companionById(companionForDept(m.result?.deptK).id).name;
  const [revising, setRevising] = useState(false);
  const [note, setNote] = useState('');
  const [reviseBusy, setReviseBusy] = useState(false);
  // Dual-gate: the card leaves the run view only when the produce is done (m.running=false)
  // AND the log has played through (logDone). Reset whenever a new run/revise starts.
  const [logDone, setLogDone] = useState(false);
  // Latches true only once this card has actually been in flight, so a card that first
  // mounts already-done (ran=false) shows its result immediately instead of replaying the
  // log. (Inline result cards are session-only today; this keeps the gate correct if they
  // ever start rehydrating.)
  const [ran, setRan] = useState(false);
  // The persistent "What byte did" record is collapsed by default.
  const [showRecord, setShowRecord] = useState(false);
  useEffect(() => {
    if (m.running) {
      setRan(true);
      setLogDone(false);
    }
  }, [m.running]);

  const r = m.result!;
  const d = DEPTS.find((x) => x.k === r.deptK);
  const t = d?.tasks.find((x) => x.t === r.taskTitle);
  const noun = TYPE_NOUN[r.type] || 'Deliverable';
  const preview = (t?.out || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const steps = m.steps;
  const hasSteps = !!steps?.length;

  const revise = (text: string) => {
    reviseTaskInChat(m.id, r.deptK, r.taskTitle, text);
    setRevising(false);
    setReviseBusy(true);
    setNote('');
  };

  // Show the run view while producing, or — once a run has started — until the log
  // finishes playing. A card that mounts already-done (ran=false) skips straight to the
  // result, so a finished log never replays.
  const running = m.running || (ran && hasSteps && !logDone);

  return (
    <div className="cres">
      <div className="cres-h">
        <span className="cres-t">{r.taskTitle}</span>
        <span className="cres-tag">
          {d?.name ? `${d.name} · ` : ''}
          {noun}
        </span>
      </div>
      {running ? (
        hasSteps ? (
          <ExecLog
            steps={steps!}
            title={
              reviseBusy ? `${companionName} is revising…` : `${companionName} is doing the work…`
            }
            onDone={() => setLogDone(true)}
          />
        ) : (
          <div className="cres-run">
            <span className="cres-spin" />
            {reviseBusy ? 'Revising…' : 'Producing…'}
          </div>
        )
      ) : (
        <>
          {hasSteps && (
            <div className="cres-rec">
              <button
                className="cres-rec-t"
                onClick={() => setShowRecord((v) => !v)}
                aria-expanded={showRecord}
              >
                {showRecord ? '▾' : '▸'} What {companionName} did · {stepCountLabel(steps!)}
              </button>
              {showRecord && <StaticLog steps={steps!} />}
            </div>
          )}
          {preview && <div className="cres-prev">{preview}</div>}
          {r.approved ? (
            <button
              type="button"
              className="cres-saved"
              onClick={() => openChatResult(r.deptK, r.taskTitle)}
              title="Open this in your library"
              style={{
                fontFamily: 'inherit',
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                textDecoration: 'underline',
                textUnderlineOffset: 2,
              }}
            >
              Saved to your library — open it
            </button>
          ) : revising ? (
            <div className="cres-rev">
              <div className="cres-rev-chips">
                {REVISE_CHIPS.map((c) => (
                  <button key={c} className="cres-chip" onClick={() => revise(c)}>
                    {c}
                  </button>
                ))}
              </div>
              <div className="cres-rev-row">
                <input
                  className="cres-rev-in"
                  autoFocus
                  placeholder={`Tell ${companionName} what to change…`}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      revise(note);
                    } else if (e.key === 'Escape') {
                      setRevising(false);
                      setNote('');
                    }
                  }}
                />
                <button
                  className="cres-rev-go"
                  aria-label="Send revision"
                  onClick={() => revise(note)}
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M2 8h11M9 4l4 4-4 4"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            </div>
          ) : (
            <div className="cres-acts">
              <button
                className="cres-b primary"
                onClick={() => approveChatResult(r.deptK, r.taskTitle)}
              >
                Approve
              </button>
              <button className="cres-b" onClick={() => openChatResult(r.deptK, r.taskTitle)}>
                {r.type === 'site' ? 'Open' : 'Read'}
              </button>
              <button className="cres-b" onClick={() => setRevising(true)}>
                Revise
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// A one-tap card byte offers to turn on an off toolkit item. Reads the LIVE ENV item so
// a flip (setupCapability → bump) re-renders this card into its confirmed state.
function SetupCard({ m }: { m: ChatMessage }) {
  const { setupCapability } = useApp();
  const s = m.setup!;
  const idx = resolveEnvIndex(ENV, s.category, s.name);
  if (idx === -1) return null; // stale/unknown item — drop quietly
  const item = ENV[s.category][idx];
  const meta = ENV_META[s.category];
  return (
    <div className="cset">
      <div className="cset-h">
        <span className="cset-ic">{item.ab}</span>
        <span className="cset-cat">{meta.label}</span>
      </div>
      <div className="cset-n">{item.n}</div>
      <div className="cset-why">{item.why || item.d}</div>
      {item.s ? (
        <div className="cset-done">
          <span className="ck">✓</span>
          {meta.on}
        </div>
      ) : (
        <button className="cset-b" onClick={() => setupCapability(s.category, s.name)}>
          {meta.add}
        </button>
      )}
    </div>
  );
}

// A first-run enrichment question (goal / traction / problem). While unanswered it shows
// byte's question, a why-line, and an answer input + Skip; once the founder answers or
// skips, it collapses to a plain past question (the affordance is gone).
function InterviewCard({ m }: { m: ChatMessage }) {
  const { answerInterview } = useApp();
  const [text, setText] = useState('');
  const iv = m.interview!;
  const q = QUESTION_FOR[iv.gap];
  const send = () => answerInterview(m.id, iv.gap, text.trim() || null);
  if (iv.answered) {
    return <div className="bub">{q.ask}</div>;
  }
  return (
    <div className="bub civ">
      <div className="civ-q">{q.ask}</div>
      <div className="civ-why">{q.why}</div>
      <input
        className="civ-in"
        placeholder="Type your answer…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        autoFocus
      />
      <div className="civ-row">
        <button className="civ-send" onClick={send} disabled={!text.trim()}>
          Send
        </button>
        <button className="civ-skip" onClick={() => answerInterview(m.id, iv.gap, null)}>
          Skip
        </button>
      </div>
    </div>
  );
}

// Assisted founder task: a generated how-to (why-now + steps + optional provider options) plus a
// capture form for the task's non-sensitive OUTPUT. Submitting saves those values to company
// memory (decisions) and marks the task done. Self-contained inline styles so it doesn't depend on
// the concurrently-evolving globals.css. Accent-token driven, so it follows the active companion.
function TaskHelpCard({ m }: { m: ChatMessage }) {
  const { captureTaskInput, markTaskDone } = useApp();
  const h = m.help!;
  const { guide, capture } = h.data;
  const [vals, setVals] = useState<Record<string, string>>({});
  const submit = () => {
    if (capture) {
      captureTaskInput(
        h.deptK,
        h.taskTitle,
        capture.fields.map((f) => ({ key: f.key, label: f.label, value: vals[f.key] || '' })),
      );
    } else {
      markTaskDone(h.deptK, h.taskTitle);
    }
  };
  const label = { fontSize: 11, fontWeight: 700, color: 'var(--t-2)', marginBottom: 4 } as const;
  return (
    <div className="bub" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {m.text ? <div style={{ lineHeight: 1.45 }}>{plain(m.text)}</div> : null}

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 650, color: 'var(--t-1)' }}>{guide.call}</span>
        {guide.est ? (
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              color: 'var(--accent)',
              background: 'var(--accent-tint)',
              border: '1px solid var(--accent-line)',
              borderRadius: 999,
              padding: '1px 8px',
              whiteSpace: 'nowrap',
            }}
          >
            {guide.est}
          </span>
        ) : null}
      </div>

      {guide.steps.length > 0 && (
        <ol
          style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 7 }}
        >
          {guide.steps.map((s, i) => (
            <li key={i} style={{ fontSize: 12.5, lineHeight: 1.4 }}>
              <span style={{ fontWeight: 650, color: 'var(--t-1)' }}>{s.h}</span>
              {s.p ? <span style={{ color: 'var(--t-2)' }}> — {s.p}</span> : null}
            </li>
          ))}
        </ol>
      )}

      {guide.options && guide.options.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={label}>Options</div>
          {guide.options.map((o, i) => (
            <div key={i} style={{ fontSize: 12, lineHeight: 1.4 }}>
              <span style={{ fontWeight: 650, color: 'var(--t-1)' }}>{o.name}</span>
              <span style={{ color: 'var(--t-2)' }}> — {o.why}</span>
            </div>
          ))}
        </div>
      )}

      {capture && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 9,
            padding: '11px 12px',
            borderRadius: 10,
            background: 'var(--well)',
            border: '1px solid var(--hairline)',
          }}
        >
          <div style={label}>Save what you decide</div>
          {capture.fields.map((f) => (
            <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 11.5, color: 'var(--t-2)' }}>{f.label}</span>
              <input
                value={vals[f.key] || ''}
                placeholder={f.placeholder}
                onChange={(e) => setVals((p) => ({ ...p, [f.key]: e.target.value }))}
                style={{
                  fontFamily: 'var(--sans)',
                  fontSize: 12.5,
                  padding: '7px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--hairline)',
                  background: 'var(--surface)',
                  color: 'var(--t-1)',
                }}
              />
            </label>
          ))}
          {capture.note ? (
            <div style={{ fontSize: 10.5, color: 'var(--t-3)', lineHeight: 1.35 }}>
              {capture.note}
            </div>
          ) : null}
        </div>
      )}

      <button
        onClick={submit}
        style={{
          alignSelf: 'flex-start',
          fontFamily: 'var(--sans)',
          fontSize: 12.5,
          fontWeight: 700,
          color: 'var(--on-accent)',
          background: 'var(--accent)',
          border: 'none',
          borderRadius: 9,
          padding: '8px 16px',
          cursor: 'pointer',
        }}
      >
        {capture ? 'Save & mark done' : "I've done this"}
      </button>
    </div>
  );
}

// A "Noted" chip: a durable fact/decision byte captured from the founder's last message
// into company memory. Subtle by design (byte quietly got smarter), with an undo so the
// founder stays in control of what byte remembers. Strikes to "Removed" once undone.
function NotedChip({ m }: { m: ChatMessage }) {
  const { undoNoted } = useApp();
  const n = m.noted!;
  if (n.undone) {
    return <div className="cnote cnote-off">Removed from memory</div>;
  }
  return (
    <div className="cnote">
      <span className="cnote-txt">
        <span className="cnote-k">Noted · {n.topic}</span> — {n.statement}
      </span>
      <button className="cnote-undo" onClick={() => undoNoted(m.id, n.topic)}>
        undo
      </button>
    </div>
  );
}

// One-time, subtle nudge to add your own Anthropic key. Honest framing: it powers byte's lighter
// background work only. "Add my key" opens Billing & Usage; "Not now" dismisses it for good.
function ByokNudgeCard({ m }: { m: ChatMessage }) {
  const { show, dismissByokNudge } = useApp();
  return (
    <div className="bub" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ lineHeight: 1.45 }}>{plain(m.text)}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => {
            show('billing');
            dismissByokNudge(m.id);
          }}
          style={{
            fontFamily: 'var(--sans)',
            fontSize: 12.5,
            fontWeight: 700,
            color: 'var(--on-accent)',
            background: 'var(--accent)',
            border: 'none',
            borderRadius: 8,
            padding: '7px 14px',
            cursor: 'pointer',
          }}
        >
          Add my key
        </button>
        <button
          type="button"
          onClick={() => dismissByokNudge(m.id)}
          style={{
            fontFamily: 'var(--sans)',
            fontSize: 12.5,
            fontWeight: 600,
            color: 'var(--t-2)',
            background: 'transparent',
            border: '1px solid var(--hairline)',
            borderRadius: 8,
            padding: '7px 14px',
            cursor: 'pointer',
          }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}

// GitHub-backed cloud build's repo picker: fetches the connected GitHub App
// installation's repos on mount and renders either a "Connect GitHub" button (not
// connected yet) or a "Build into: owner/name" dropdown, defaulting to the first repo
// once loaded so armBuild always has a target. Replaces the demo notice / local project
// picker for a repo-cloud build (see the start-building block below).
function RepoPicker() {
  const { buildRepo, setBuildRepo, connectGithub, loadRepos } = useApp();
  const [repos, setRepos] = useState<{ owner: string; name: string }[] | null>(null);
  const [notConnected, setNotConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadRepos().then((res) => {
      if (cancelled) return;
      if ('notConnected' in res) {
        setNotConnected(true);
        return;
      }
      setRepos(res.repos);
      // Default to the first repo so the arm button has a target without forcing a
      // choice — the founder can still switch via the dropdown before arming.
      if (!buildRepo && res.repos.length > 0) setBuildRepo(res.repos[0]);
    });
    return () => {
      cancelled = true;
    };
    // Mount-only fetch — buildRepo is read for its value at fetch time (no interaction
    // is possible before the dropdown renders), not tracked as a re-fetch trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (notConnected) {
    return (
      <div className="cop-proj">
        <span>Connect GitHub to build into your own repo</span>
        <button className="bub-act" onClick={connectGithub}>
          Connect GitHub
        </button>
      </div>
    );
  }

  if (!repos) {
    return (
      <div className="cop-proj">
        <span>Loading your repos…</span>
      </div>
    );
  }

  return (
    <label className="cop-proj">
      <span>Build into:</span>
      {repos.length > 0 ? (
        <select
          value={buildRepo ? `${buildRepo.owner}/${buildRepo.name}` : ''}
          onChange={(e) => {
            const found = repos.find((r) => `${r.owner}/${r.name}` === e.target.value);
            if (found) setBuildRepo(found);
          }}
        >
          <option value="" disabled>
            Choose a repo…
          </option>
          {repos.map((r) => (
            <option key={`${r.owner}/${r.name}`} value={`${r.owner}/${r.name}`}>
              {r.owner}/{r.name}
            </option>
          ))}
        </select>
      ) : (
        <span>No repos found — grant Codepet access to a repo on GitHub first.</span>
      )}
    </label>
  );
}

function ThreadList() {
  const {
    threads,
    activeThreadId,
    newChat,
    openThread,
    renameThread,
    deleteThread,
    clearAllChats,
  } = useApp();
  // Stamp "now" once at mount via a lazy initializer — calling Date.now() directly in
  // render is an impure call the React Compiler lint rejects. The list remounts each
  // time History opens, so the relative times refresh then.
  const [now] = useState(() => Date.now());
  const rows = sortThreadsByRecent(threads);
  return (
    <div className="cthreads">
      <div className="cthreads-actions">
        <button className="cthreads-new" onClick={newChat}>
          + New chat
        </button>
        {rows.length > 0 && (
          <button
            className="cthreads-clear"
            title="Delete every chat"
            onClick={() => {
              if (window.confirm('Delete all chats? This cannot be undone.')) clearAllChats();
            }}
          >
            Clear all
          </button>
        )}
      </div>
      <ul className="cthreads-list">
        {rows.map((t) => (
          <li key={t.id} className={`cthreads-row${t.id === activeThreadId ? ' is-active' : ''}`}>
            <button className="cthreads-open" onClick={() => openThread(t.id)}>
              <span className="cthreads-title">{t.title}</span>
              <span className="cthreads-time">{relativeTime(t.updatedAt, now)}</span>
            </button>
            <button
              className="cthreads-rename"
              title="Rename"
              onClick={() => {
                const next = window.prompt('Rename chat', t.title);
                if (next != null) renameThread(t.id, next);
              }}
            >
              Rename
            </button>
            <button
              className="cthreads-del"
              title="Delete"
              onClick={() => {
                if (window.confirm('Delete this chat?')) deleteThread(t.id);
              }}
            >
              Delete
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="cthreads-empty">No chats yet.</li>}
      </ul>
    </div>
  );
}

export function Copilot({ inline = false }: { inline?: boolean } = {}) {
  const {
    toggleCopilot,
    brief,
    chatMessages,
    chatStreaming,
    sendChat,
    retryChat,
    runBriefedTask,
    runTaskInChat,
    markTaskDone,
    dismissChatAction,
    advanceStage,
    buildIntakeActive,
    startBuildIntake,
    cancelBuildIntake,
    addIntakeTurn,
    generateBuildPlan,
    armBuild,
    buildArming,
    projects,
    buildProject,
    setBuildProject,
    buildRepo,
    demoLetsBuild,
    buildPlan,
    setBuildPlanSteps,
    buildAutonomy,
    setBuildAutonomy,
    navigateTo,
    focusCompanionId,
    chatHistoryOpen,
    toggleChatHistory,
  } = useApp();
  // Speak to THIS account, from its own brief — never the hardcoded demo founder/company.
  const founder = brief.founderName?.trim();
  const company = cleanCompanyName(brief.projectName) ?? 'your company';
  // The current focus pet — used for live/streaming states (thinking, input placeholder).
  const c = companionById(focusCompanionId);
  // Which pet a given turn belongs to: its own stamp, else the task's department pet (for
  // deliverables/actions), else the current focus. Drives the per-message avatar + name.
  const whoFor = (m: ChatMessage): string =>
    m.companionId ??
    (m.result
      ? companionForDept(m.result.deptK).id
      : m.help
        ? companionForDept(m.help.deptK).id
        : m.action
          ? companionForDept(m.action.deptK).id
          : focusCompanionId);

  const [draft, setDraft] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  // Whether the reader is pinned to the bottom — a ref, so scroll checks never trigger a
  // re-render or re-run the follow effect. `showPill` surfaces the "New" jump button when
  // fresh content arrives while they're scrolled up reading earlier history.
  const pinnedRef = useRef(true);
  const [showPill, setShowPill] = useState(false);

  const scrollToBottom = (smooth = false) => {
    const el = bodyRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  // Follow new content (including each streamed token) ONLY when pinned to the bottom. If
  // the reader has scrolled up, leave their position untouched and flag that there's new
  // content — so byte streaming no longer yanks them away from what they're reading.
  useEffect(() => {
    if (pinnedRef.current) scrollToBottom();
    else setShowPill(true);
  }, [chatMessages]);

  // Re-evaluate bottom-ness as they scroll; scrolling back down clears the pill.
  const onBodyScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    pinnedRef.current = atBottom;
    if (atBottom) setShowPill(false);
  };

  const jumpToLatest = () => {
    pinnedRef.current = true;
    setShowPill(false);
    scrollToBottom(true);
  };

  const submit = () => {
    if (!draft.trim()) return;
    if (buildIntakeActive) {
      addIntakeTurn(draft);
    } else {
      if (chatStreaming) return;
      // Sending your own turn always re-pins — you expect to follow your message.
      pinnedRef.current = true;
      setShowPill(false);
      sendChat(draft);
    }
    setDraft('');
  };

  const empty = chatMessages.length === 0;

  return (
    <aside className={`copilot${inline ? ' inline' : ''}`}>
      <div className="cop-h">
        <div>
          <div className="pn">Your team</div>
          <div className="st">
            <span className="d" />
            guiding · {company}
          </div>
        </div>
        <button
          className="ccopilot-history"
          title={chatHistoryOpen ? 'Back to chat' : 'Chat history'}
          aria-label={chatHistoryOpen ? 'Back to chat' : 'Chat history'}
          onClick={() => toggleChatHistory()}
        >
          {chatHistoryOpen ? '‹ Back' : '☰ History'}
        </button>
        <button
          className="cop-collapse"
          title="Collapse chat"
          aria-label="Collapse chat"
          onClick={() => toggleCopilot(true)}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <path
              d="M6 4l4 4-4 4M2 4v8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {chatHistoryOpen ? (
        <ThreadList />
      ) : (
        <>
          <div className="cop-body" ref={bodyRef} onScroll={onBodyScroll}>
            {/* Greeting is an empty-state opener, not a permanent fixture — once the thread has
            messages, byte's own turns are the presence, so it's hidden. */}
            {empty && (
              <div className="bub">
                Welcome{founder ? `, ${founder}` : ''}. Ask me anything about <b>{company}</b> —
                where to focus, what&apos;s blocking you, or what to build next.
              </div>
            )}

            {chatMessages.map((m, msgIdx) => {
              const node = (() => {
                if (m.result) return <ResultCard key={m.id} m={m} />;
                if (m.interview) return <InterviewCard key={m.id} m={m} />;
                if (m.help) return <TaskHelpCard key={m.id} m={m} />;
                if (m.byokNudge) return <ByokNudgeCard key={m.id} m={m} />;
                if (m.noted) return <NotedChip key={m.id} m={m} />;
                if (m.setup)
                  return (
                    <div key={m.id}>
                      {m.text ? <div className="bub">{plain(m.text)}</div> : null}
                      <SetupCard m={m} />
                    </div>
                  );
                if (m.advance) {
                  return (
                    <div key={m.id} className="bub">
                      {plain(m.text)}
                      <button className="bub-adv" onClick={advanceStage}>
                        Advance to {m.advance.toStage}
                      </button>
                    </div>
                  );
                }
                const streamingByte =
                  chatStreaming && m.role === 'byte' && m === chatMessages.at(-1);
                if (streamingByte && !m.text) {
                  return (
                    <div key={m.id} className="bub byte-thinking">
                      {c.name} is thinking…
                    </div>
                  );
                }
                if (m.buildPlan) {
                  // While this is the live plan card (before arming), edit the store's plan so
                  // the founder can refine the steps; older/armed cards read as static history.
                  const editable = m.buildAction?.kind === 'start-building' && !!buildPlan;
                  const plan = editable ? buildPlan! : m.buildPlan;
                  const steps = plan.steps;
                  const unsure = new Set<number>(plan.uncertain ?? []);
                  return (
                    <div key={m.id} className="bub">
                      {plain(m.text)}
                      <div className="cop-plan">
                        <div className="cop-plan-h">{plan.title}</div>
                        {editable ? (
                          <div className="cop-steps">
                            {steps.map((s, i) => (
                              <div
                                className={`cop-step${unsure.has(i) ? ' unsure' : ''}`}
                                key={i}
                                title={
                                  unsure.has(i)
                                    ? `${c.name} isn't fully sure here — tweak it if needed`
                                    : undefined
                                }
                              >
                                <span className="cop-step-n">{i + 1}</span>
                                <textarea
                                  className="cop-step-in"
                                  rows={1}
                                  value={s}
                                  onChange={(e) =>
                                    setBuildPlanSteps(
                                      steps.map((x, j) => (j === i ? e.target.value : x)),
                                    )
                                  }
                                />
                                <button
                                  className="cop-step-x"
                                  title="Remove this step"
                                  aria-label="Remove this step"
                                  onClick={() => setBuildPlanSteps(steps.filter((_, j) => j !== i))}
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                            <button
                              className="cop-step-add"
                              onClick={() => setBuildPlanSteps([...steps, ''])}
                            >
                              + Add a step
                            </button>
                          </div>
                        ) : (
                          <ol>
                            {steps.map((s, i) => (
                              <li key={i} className={unsure.has(i) ? 'unsure' : undefined}>
                                {s}
                                {unsure.has(i) && <span className="cop-unsure"> 🤔 not sure</span>}
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                      {m.buildAction?.kind === 'start-building' &&
                        (() => {
                          // A repo-cloud build boots into the founder's own connected GitHub
                          // repo instead of a demo dir or a local project — see armBuild's
                          // cloudRepoBuild branch in lib/store.tsx.
                          const isRepoCloudBuild = cloudRepoBuild && !demoLetsBuild;
                          const needsProject = !demoLetsBuild && !isRepoCloudBuild;
                          const needsRepo = isRepoCloudBuild && !buildRepo;
                          return (
                            <>
                              {demoLetsBuild ? (
                                // Demo mode targets a throwaway ~/codepet-demo, so no project
                                // pick — showing one would confuse internal testers.
                                <div className="cop-proj">
                                  <span>
                                    Demo — builds a throwaway page in <code>~/codepet-demo</code>
                                  </span>
                                </div>
                              ) : isRepoCloudBuild ? (
                                <RepoPicker />
                              ) : (
                                <label className="cop-proj">
                                  <span>Which project?</span>
                                  {projects.length > 0 ? (
                                    <select
                                      value={buildProject}
                                      onChange={(e) => setBuildProject(e.target.value)}
                                    >
                                      {/* A project is required — building "nowhere" would land
                                        in the app server's own folder. */}
                                      <option value="" disabled>
                                        Choose a project…
                                      </option>
                                      {projects.map((name) => (
                                        <option key={name} value={name}>
                                          {name}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <input
                                      value={buildProject}
                                      onChange={(e) => setBuildProject(e.target.value)}
                                      placeholder="Type a project folder path (or run the project scan)…"
                                    />
                                  )}
                                </label>
                              )}
                              <div className="cop-auto">
                                <span>How hands-on?</span>
                                <div className="cop-auto-opts">
                                  {(
                                    [
                                      ['suggest', 'Ask me', 'Approve each risky step'],
                                      [
                                        'copilot',
                                        'Co-pilot',
                                        'Auto-approve safe work, ask on risky',
                                      ],
                                      ['autopilot', 'Autopilot', 'Run everything without asking'],
                                    ] as const
                                  ).map(([mode, label, hint]) => (
                                    <button
                                      key={mode}
                                      className={`cop-auto-opt${buildAutonomy === mode ? ' on' : ''}`}
                                      onClick={() => setBuildAutonomy(mode)}
                                      title={hint}
                                    >
                                      {label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <button
                                className="bub-act"
                                onClick={armBuild}
                                disabled={
                                  buildArming ||
                                  steps.every((s) => !s.trim()) ||
                                  (needsProject && !buildProject.trim()) ||
                                  needsRepo
                                }
                                title={
                                  needsProject && !buildProject.trim()
                                    ? 'Pick a project first'
                                    : needsRepo
                                      ? 'Pick a repo first'
                                      : undefined
                                }
                              >
                                {buildArming
                                  ? 'Opening your session…'
                                  : needsProject && !buildProject.trim()
                                    ? 'Pick a project to start'
                                    : needsRepo
                                      ? 'Pick a repo to start'
                                      : m.buildAction.label}
                              </button>
                            </>
                          );
                        })()}
                    </div>
                  );
                }
                if (m.buildAction?.kind === 'to-plan') {
                  return (
                    <div key={m.id} className="bub">
                      {plain(m.text)}
                      <button className="bub-act" onClick={generateBuildPlan}>
                        {m.buildAction.label}
                      </button>
                    </div>
                  );
                }
                if (m.buildAction?.kind === 'begin-intake') {
                  return (
                    <div key={m.id} className="bub">
                      {plain(m.text)}
                      <button className="bub-act" onClick={startBuildIntake}>
                        {m.buildAction.label}
                      </button>
                    </div>
                  );
                }
                return (
                  <div key={m.id} className={m.role === 'me' ? 'bub me' : 'bub'}>
                    {m.role === 'byte' ? plain(m.text) : m.text}
                    {m.action && (
                      <button
                        className="bub-act"
                        onClick={() => {
                          if (m.action!.done) {
                            markTaskDone(m.action!.deptK, m.action!.taskTitle);
                            dismissChatAction(m.id);
                          } else if (m.action!.inline) {
                            track('firstrun.action_clicked', { dept: m.action!.deptK });
                            runTaskInChat(m.action!.deptK, m.action!.taskTitle);
                            dismissChatAction(m.id);
                          } else {
                            runBriefedTask(m.action!.deptK, m.action!.taskTitle);
                          }
                        }}
                      >
                        {m.action.label}
                      </button>
                    )}
                    {m.nav && (
                      <button
                        className="bub-act"
                        onClick={() => navigateTo(m.nav!.dest, m.nav!.target)}
                      >
                        {m.nav.label}
                      </button>
                    )}
                    {m.error && (
                      <button
                        className="bub-retry"
                        onClick={() => retryChat(m.id)}
                        disabled={chatStreaming}
                      >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
                          <path
                            d="M13 8a5 5 0 1 1-1.46-3.54M13 2v3h-3"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        Retry
                      </button>
                    )}
                  </div>
                );
              })();
              // 'me' turns render as-is (right-aligned bubble). byte turns get the speaking
              // pet's avatar + name, collapsed when the same pet speaks twice in a row.
              if (m.role !== 'byte') return node;
              const who = whoFor(m);
              const prev = chatMessages[msgIdx - 1];
              const showWho = !prev || prev.role !== 'byte' || whoFor(prev) !== who;
              return (
                <div key={m.id} className="cop-turn">
                  {showWho && (
                    <div className="cop-who">
                      <Companion id={who} size="s28" />
                      <span>{companionById(who).name}</span>
                    </div>
                  )}
                  {node}
                </div>
              );
            })}

            {empty && (
              <div className="chips">
                {CHIPS.map((t) => (
                  <button
                    key={t}
                    className="sug"
                    onClick={() => sendChat(t)}
                    disabled={chatStreaming}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
          {showPill && (
            <button className="cop-new" onClick={jumpToLatest} aria-label="Jump to latest messages">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M4 6l4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              New
            </button>
          )}
          <div className="cop-foot">
            {!buildIntakeActive ? (
              <button className="cop-build-cta" onClick={startBuildIntake}>
                🔨 Let&apos;s build
              </button>
            ) : (
              <div className="cop-intake-bar">
                <span className="cop-intake-hint">Describing your build…</span>
                <button className="cop-intake-cancel" onClick={cancelBuildIntake}>
                  ✕ Never mind
                </button>
              </div>
            )}
            <div className="composer">
              <textarea
                className="composer-in"
                rows={1}
                placeholder={
                  buildIntakeActive
                    ? 'Tell Byte what to build — every message adds to the brief…'
                    : `Ask ${c.name} anything about your company…`
                }
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  // Enter sends; Shift+Enter inserts a newline so a longer message can
                  // wrap and stay fully visible (the box grows via CSS field-sizing).
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              <button className="send" onClick={submit} disabled={chatStreaming || !draft.trim()}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M2 8h11M9 4l4 4-4 4"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
