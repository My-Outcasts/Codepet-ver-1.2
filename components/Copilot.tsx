'use client';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import { track } from '@/lib/analytics';
import { DEPTS } from '@/lib/data';
import { Byte } from './Byte';
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
  // Latches true once a revise pass fires, so the spinner reads "Revising…" rather
  // than "Producing…". A card's spinner only re-shows via revise (the initial produce
  // is a separate card), so the flag never needs resetting.
  const [reviseBusy, setReviseBusy] = useState(false);
  const r = m.result!;
  const d = DEPTS.find((x) => x.k === r.deptK);
  const t = d?.tasks.find((x) => x.t === r.taskTitle);
  const noun = TYPE_NOUN[r.type] || 'Deliverable';
  const preview = (t?.out || '').trim().replace(/\s+/g, ' ').slice(0, 120);

  const revise = (text: string) => {
    reviseTaskInChat(m.id, r.deptK, r.taskTitle, text);
    setRevising(false);
    setReviseBusy(true);
    setNote('');
  };

  return (
    <div className="cres">
      <div className="cres-h">
        <span className="cres-t">{r.taskTitle}</span>
        <span className="cres-tag">
          {d?.name ? `${d.name} · ` : ''}
          {noun}
        </span>
      </div>
      {m.running ? (
        <div className="cres-run">
          <span className="cres-spin" />
          {reviseBusy ? 'Revising…' : 'Producing…'}
        </div>
      ) : (
        <>
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
                {r.type === 'site' ? 'Open' : 'Copy'}
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

  // Keep the latest message in view as the conversation grows / byte streams.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessages]);

  const submit = () => {
    if (!draft.trim() || chatStreaming) return;
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
      <div className="cop-body" ref={bodyRef}>
        <div className="bub">
          Welcome back{founder ? `, ${founder}` : ''}. Ask me anything about <b>{company}</b> —
          where to focus, what&apos;s blocking you, or what to build next.
        </div>

        {chatMessages.map((m) => {
          if (m.result) return <ResultCard key={m.id} m={m} />;
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
