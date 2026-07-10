'use client';
import { useApp } from '@/lib/store';

// The topbar now carries the Codepet brand (logo + wordmark) and the sidebar collapse toggle on
// the left, plus the install/upgrade actions on the right. Identity moved to the sidebar top
// (see AccountMenu), so the brand no longer disappears when the sidebar is collapsed.
export function Topbar() {
  const { installed, openInstallPrompt, show, sideCollapsed, toggleSide } = useApp();

  return (
    <div className="topbar">
      <div className="tb-brand">
        <span className="logo" aria-hidden />
        <span className="nm pixel">Codepet</span>
      </div>
      <button
        className={`brand-toggle${sideCollapsed ? ' collapsed' : ''}`}
        title={sideCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={sideCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        onClick={() => toggleSide()}
      >
        <svg viewBox="0 0 16 16" fill="none">
          <path
            d="M10 4L6 8l4 4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
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
            <span className="tb-install-dot" />⚡ Wake byte up
          </button>
        )}
        <button className="upg" onClick={() => show('billing')}>
          Upgrade
        </button>
      </span>
    </div>
  );
}
