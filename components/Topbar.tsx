'use client';
import { useEffect, useRef, useState } from 'react';

export function Topbar() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onDoc = () => setOpen(false);
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  return (
    <div className="topbar">
      <span className="traffic"><i className="r" /><i className="y" /><i className="g" /></span>
      <span className="proj">Codepet <span className="badge">macOS</span></span>
      <button
        ref={ref}
        className={`tb-prof${open ? ' open' : ''}`}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        <span className="av">M</span>Mona
        <svg className="cv" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <div className="tb-menu" onClick={(e) => e.stopPropagation()}>
          <div className="who"><b>Mona</b><span>nguyen@murror.app</span></div>
          <a>Account</a><a>Preferences</a><a>Sign out</a>
        </div>
      </button>
      <span className="right">
        <button className="tb-ic" title="Search"><svg viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.7" /><path d="M14 14l3.5 3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg></button>
        <button className="tb-ic dot" title="Notifications"><svg viewBox="0 0 20 20" fill="none"><path d="M6 8.5a4 4 0 0 1 8 0c0 2.8 1.1 4 1.7 4.7H4.3C4.9 12.5 6 11.3 6 8.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M8.4 16a1.7 1.7 0 0 0 3.2 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg></button>
        <button className="tb-ic" title="Settings"><svg viewBox="0 0 20 20" fill="none"><path d="M3 6.5h14M3 13.5h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><circle cx="8" cy="6.5" r="2.1" fill="var(--surface-2)" stroke="currentColor" strokeWidth="1.6" /><circle cx="12.5" cy="13.5" r="2.1" fill="var(--surface-2)" stroke="currentColor" strokeWidth="1.6" /></svg></button>
        <span className="upg">Upgrade</span>
      </span>
    </div>
  );
}
