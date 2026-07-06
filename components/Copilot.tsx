'use client';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import { track } from '@/lib/analytics';
import { DEPTS, ENV, ENV_META } from '@/lib/data';
import { resolveEnvIndex } from '@/lib/ai/envSetup';
import { QUESTION_FOR } from '@/lib/ai/enrichInterview';
import { Byte } from './Byte';
import { ExecLog, StaticLog } from './artifact/ExecLog';
import { stepCountLabel } from '@/lib/helpers';
import type { ChatMessage } from '@/lib/store';

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
            title={reviseBusy ? 'byte is revising…' : 'byte is doing the work…'}
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
                {showRecord ? '▾' : '▸'} What byte did · {stepCountLabel(steps!)}
              </button>
              {showRecord && <StaticLog steps={steps!} />}
            </div>
          )}
          {preview && <div className="cres-prev">{preview}</div>}
          {r.approved ? (
            <div className="cres-saved">Saved to your library</div>
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
                  placeholder="Tell byte what to change…"
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

export function Copilot() {
  const {
    toggleCopilot,
    brief,
    chatMessages,
    chatStreaming,
    sendChat,
    runBriefedTask,
    runTaskInChat,
    dismissChatAction,
    advanceStage,
    navigateTo,
  } = useApp();
  // Speak to THIS account, from its own brief — never the hardcoded demo founder/company.
  const founder = brief.founderName?.trim();
  const company = brief.projectName?.trim() || 'your company';

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
    if (!draft.trim() || chatStreaming) return;
    // Sending your own turn always re-pins — you expect to follow your message.
    pinnedRef.current = true;
    setShowPill(false);
    sendChat(draft);
    setDraft('');
  };

  const empty = chatMessages.length === 0;

  return (
    <aside className="copilot">
      <div className="cop-h">
        <Byte size="s28" />
        <div>
          <div className="pn">byte</div>
          <div className="st">
            <span className="d" />
            guiding · {company}
          </div>
        </div>
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
      <div className="cop-body" ref={bodyRef} onScroll={onBodyScroll}>
        <div className="bub">
          Welcome back{founder ? `, ${founder}` : ''}. Ask me anything about <b>{company}</b> —
          where to focus, what&apos;s blocking you, or what to build next.
        </div>

        {chatMessages.map((m) => {
          if (m.result) return <ResultCard key={m.id} m={m} />;
          if (m.interview) return <InterviewCard key={m.id} m={m} />;
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
          const streamingByte = chatStreaming && m.role === 'byte' && m === chatMessages.at(-1);
          if (streamingByte && !m.text) {
            return (
              <div key={m.id} className="bub byte-thinking">
                byte is thinking…
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
                    if (m.action!.inline) {
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
                <button className="bub-act" onClick={() => navigateTo(m.nav!.dest, m.nav!.target)}>
                  {m.nav.label}
                </button>
              )}
            </div>
          );
        })}

        {empty && (
          <div className="chips">
            {CHIPS.map((t) => (
              <button key={t} className="sug" onClick={() => sendChat(t)} disabled={chatStreaming}>
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
        <div className="composer">
          <input
            placeholder="Ask byte anything about your company…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
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
    </aside>
  );
}
