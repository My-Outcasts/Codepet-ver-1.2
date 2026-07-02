'use client';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
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

// An inline deliverable byte produced in chat — the "run it from here" result.
// Reads the live task so the preview reflects the fresh output; Approve / Open /
// Redo keep the founder in the conversation.
function ResultCard({ m }: { m: ChatMessage }) {
  const { runTaskInChat, approveChatResult, openChatResult } = useApp();
  const r = m.result!;
  const d = DEPTS.find((x) => x.k === r.deptK);
  const t = d?.tasks.find((x) => x.t === r.taskTitle);
  const noun = TYPE_NOUN[r.type] || 'Deliverable';
  const preview = (t?.out || '').trim().replace(/\s+/g, ' ').slice(0, 120);

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
          Producing…
        </div>
      ) : (
        <>
          {preview && <div className="cres-prev">{preview}</div>}
          {r.approved ? (
            <div className="cres-saved">Saved to your library</div>
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
              <button className="cres-b" onClick={() => runTaskInChat(r.deptK, r.taskTitle)}>
                Redo
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function Copilot() {
  const { toggleCopilot, brief, chatMessages, chatStreaming, sendChat, runBriefedTask } = useApp();
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
                  onClick={() => runBriefedTask(m.action!.deptK, m.action!.taskTitle)}
                >
                  {m.action.label}
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
