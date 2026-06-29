'use client';
import { useApp } from '@/lib/store';
import { Byte } from './Byte';

const CHIPS = ['Start with Engineering', 'Draft my launch post', 'Open the roadmap'];

export function Copilot() {
  const { toggleCopilot, openDept, show } = useApp();

  const onChip = (t: string) => {
    if (t.includes('Engineering')) openDept('eng');
    else if (t.includes('launch')) openDept('mkt');
    else show('roadmap');
  };

  return (
    <aside className="copilot">
      <div className="cop-h">
        <Byte size="s28" />
        <div><div className="pn">byte</div><div className="st"><span className="d" />guiding · Codepet</div></div>
        <button className="cop-collapse" title="Collapse chat" aria-label="Collapse chat" onClick={() => toggleCopilot(true)}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4M2 4v8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      <div className="cop-body">
        <div className="bub">Welcome back, Nguyen. The brief&apos;s set — now we <b>activate the departments that move Codepet fastest.</b> You&apos;re in the closed-beta stretch.</div>
        <div className="bub">Three need you: <b>Engineering</b> (instrument the beta signal), <b>Marketing</b> (the waitlist), and <b>Operations</b> (TestFlight). I can take the first pass on most of it.</div>
        <div className="chips">
          {CHIPS.map((t) => <button key={t} className="sug" onClick={() => onChip(t)}>{t}</button>)}
        </div>
      </div>
      <div className="cop-foot">
        <div className="composer">
          <input placeholder="Ask byte anything about your company…" />
          <button className="send"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8h11M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
        </div>
      </div>
    </aside>
  );
}
