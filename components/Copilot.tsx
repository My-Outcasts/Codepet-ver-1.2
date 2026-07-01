'use client';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/store';
import { Byte } from './Byte';

// Quick-start prompts shown only before the first message — they send to byte.
const CHIPS = [
  'What should I focus on first?',
  'Summarize where my company is',
  'What’s blocking my launch?',
];

export function Copilot() {
  const { toggleCopilot, brief, chatMessages, chatStreaming, sendChat } = useApp();
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
              {m.text}
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
