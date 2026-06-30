'use client';
import { useApp, type View } from '@/lib/store';
import { DEPTS, ENV } from '@/lib/data';
import { Byte } from './Byte';

const NAV: Array<{ view: View; label: string; icon: React.ReactNode; count?: () => number }> = [
  { view: 'home', label: 'Company', icon: <svg className="ic" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7.2" stroke="currentColor" strokeWidth="1.6" /><circle cx="10" cy="10" r="2.2" fill="currentColor" /></svg> },
  { view: 'roadmap', label: 'Roadmap', icon: <svg className="ic" viewBox="0 0 20 20" fill="none"><path d="M4 15l4-3 4 2 4-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /><circle cx="4" cy="15" r="1.4" fill="currentColor" /><circle cx="16" cy="9" r="1.4" fill="currentColor" /></svg> },
  { view: 'tasks', label: 'Tasks', icon: <svg className="ic" viewBox="0 0 20 20" fill="none"><rect x="4" y="4" width="12" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.6" /><path d="M7 10l2 2 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>, count: () => DEPTS.reduce((a, d) => a + d.tasks.filter((t) => !t.done && (t.who === 'you' || t.who === 'draft')).length, 0) },
  { view: 'library', label: 'Library', icon: <svg className="ic" viewBox="0 0 20 20" fill="none"><path d="M5 4h7l3 3v9H5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M8 9h4M8 12h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg> },
];

export function Sidebar() {
  const { view, show, library, tick, installed } = useApp();
  void tick; // re-read mutable DEPTS/ENV on each store change
  const envPending = ['skills', 'connectors', 'agents'].reduce((a, k) => a + ENV[k].filter((x) => !x.s).length, 0);

  const item = (view_: View, label: string, icon: React.ReactNode, count?: number) => (
    <div key={view_} className={`nav${view === view_ ? ' on' : ''}`} onClick={() => show(view_)}>
      {icon}<span>{label}</span>{count ? <span className="ct">{count}</span> : null}
    </div>
  );

  return (
    <aside className="side">
      <div className="brand"><div className="logo" /><div className="nm pixel">Codepet</div></div>
      {NAV.map((n) => {
        const c = n.view === 'library' ? library.length : n.count ? n.count() : 0;
        return item(n.view, n.label, n.icon, c || undefined);
      })}
      <div className="grp">Your setup</div>
      <div className={`nav${view === 'install' ? ' on' : ''}`} onClick={() => show('install')}>
        <svg className="ic" viewBox="0 0 20 20" fill="none"><path d="M11 2L4 11h5l-1 7 7-9h-5l1-7z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
        <span>First install</span>
        {installed ? <span className="nav-ck">✓</span> : <span className="nav-dot" />}
      </div>
      {item('env', 'Environment',
        <svg className="ic" viewBox="0 0 20 20" fill="none"><path d="M3 6h14M3 14h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><circle cx="8" cy="6" r="2.3" fill="var(--surface)" stroke="currentColor" strokeWidth="1.6" /><circle cx="12" cy="14" r="2.3" fill="var(--surface)" stroke="currentColor" strokeWidth="1.6" /></svg>,
        envPending || undefined)}
      <div className="petcard">
        <Byte size="s28" />
        <div className="meta" style={{ flex: 1 }}><div className="pn">byte</div><div className="lvl">Companion · Lv.3</div><div className="petbar"><i /></div></div>
      </div>
    </aside>
  );
}
