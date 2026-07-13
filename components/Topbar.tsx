'use client';
import { useApp, type View } from '@/lib/store';
import { DEPTS, ENV } from '@/lib/data';
import { companionById } from '@/lib/companions';
import { AccountMenu } from './AccountMenu';

// Primary navigation now lives in the topbar as horizontal tabs (the sidebar was
// retired to hand its whole column to the roadmap + chat). Counts are computed the
// same way the old sidebar did.
const NAV: { view: View; label: string; count?: () => number }[] = [
  { view: 'overview', label: 'Overview' },
  { view: 'home', label: 'Company' },
  {
    view: 'tasks',
    label: 'Tasks',
    count: () =>
      DEPTS.reduce(
        (a, d) =>
          a + d.tasks.filter((t) => !t.done && (t.who === 'you' || t.who === 'draft')).length,
        0,
      ),
  },
  { view: 'library', label: 'Library' },
  { view: 'env', label: 'Environment' },
];

export function Topbar() {
  const { view, show, installed, openInstallPrompt, companionId, library, tick } = useApp();
  void tick; // re-read mutable DEPTS/ENV on each store change
  const companionName = companionById(companionId).name;
  const envPending = ['skills', 'connectors', 'agents'].reduce(
    (a, k) => a + ENV[k].filter((x) => !x.s).length,
    0,
  );
  // Library and Environment counts come from live store/derived values, not the
  // static NAV entry; the rest use their own count fn.
  const countFor = (n: (typeof NAV)[number]): number =>
    n.view === 'library' ? library.length : n.view === 'env' ? envPending : n.count ? n.count() : 0;

  return (
    <div className="topbar">
      <div className="tb-brand">
        <span className="nm pixel">Codepet</span>
      </div>
      <AccountMenu />
      <nav className="tb-nav" aria-label="Primary">
        {NAV.map((n) => {
          const c = countFor(n);
          return (
            <button
              key={n.view}
              className={`tb-tab${view === n.view ? ' on' : ''}`}
              aria-current={view === n.view ? 'page' : undefined}
              onClick={() => show(n.view)}
            >
              {n.label}
              {c ? <span className="ct">{c}</span> : null}
            </button>
          );
        })}
      </nav>
      <span className="right">
        {/* Install-later path for the one-time popup: stays until the toolkit is actually
            installed, then disappears. */}
        {!installed && (
          <button
            className="tb-install"
            onClick={() => {
              openInstallPrompt();
            }}
          >
            <span className="tb-install-dot" />⚡ Wake {companionName} up
          </button>
        )}
        <button className="upg" onClick={() => show('billing')}>
          Upgrade
        </button>
      </span>
    </div>
  );
}
