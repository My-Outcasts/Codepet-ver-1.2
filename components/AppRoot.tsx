'use client';
import { useEffect, useRef, useState } from 'react';
import { AppProvider, useApp } from '@/lib/store';
import { AuthProvider, useAuth } from '@/lib/firebase/auth';
import { SignIn } from './auth/SignIn';
import { Splash } from './Splash';
import { LoadingScreen } from './LoadingScreen';
import { Topbar } from './Topbar';
import { Sidebar } from './Sidebar';
import { Copilot } from './Copilot';
import { Onboarding } from './Onboarding';
import { Toast } from './Toast';
import { Companion } from './Companion';
import { companionById } from '@/lib/companions';
import { ThemeProvider, useTheme, applyCompanionAccent } from '@/lib/theme';
import { ArtifactModal } from './artifact/ArtifactModal';
import { SummaryView } from './views/SummaryView';
import { CompanyView } from './views/CompanyView';
import { DepartmentDetail } from './views/DepartmentDetail';
import { TasksView } from './views/TasksView';
import { LibraryView } from './views/LibraryView';
import { EnvironmentView } from './views/EnvironmentView';
import { InstallModal } from './InstallModal';
import { SettingsView } from './views/SettingsView';
import { BillingView } from './views/BillingView';
import { BuildCoachView } from './views/BuildCoachView';

// Overview tab — the roadmap (default) with the 3D force-graph behind a "Map" sub-tab.
// OverviewSection lazy-loads the three.js map internally, so WebGL is fetched only when
// the map is opened.
import OverviewSection from './views/OverviewSection';

function Shell() {
  const {
    view,
    show,
    buildSessionId,
    copilotCollapsed,
    toggleCopilot,
    sideCollapsed,
    companionId,
  } = useApp();
  // A build session is live once armed (until Start over). Keep its view mounted across
  // navigation so switching tabs doesn't tear down (and kill) the running session.
  const buildActive = buildSessionId != null;
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [view]);
  const c = companionById(companionId);

  // Sync the app's accent to the active companion (in whichever theme). Cleared on unmount so
  // the signed-out splash returns to byte's brand violet.
  const { resolved } = useTheme();
  useEffect(() => {
    applyCompanionAccent(c.accent, resolved);
    return () => applyCompanionAccent(null, resolved);
  }, [c.accent, resolved]);

  const ActiveView =
    view === 'summary' ? (
      <SummaryView />
    ) : view === 'overview' ? (
      <OverviewSection />
    ) : view === 'home' ? (
      <CompanyView />
    ) : view === 'dept' ? (
      <DepartmentDetail />
    ) : view === 'tasks' ? (
      <TasksView />
    ) : view === 'build' ? null : view === 'library' ? ( // Rendered by the persistent keep-alive slot below, not here.
      <LibraryView />
    ) : view === 'settings' ? (
      <SettingsView />
    ) : view === 'billing' ? (
      <BillingView />
    ) : (
      <EnvironmentView />
    );

  return (
    <div className="app">
      <Topbar />
      <div
        className={`shell${copilotCollapsed ? ' cop-collapsed' : ''}${sideCollapsed ? ' side-collapsed' : ''}`}
      >
        <Sidebar />
        <main className="main" id="main" ref={mainRef}>
          {ActiveView}
          {(buildActive || view === 'build') && (
            <div style={view === 'build' ? undefined : { display: 'none' }}>
              <BuildCoachView />
            </div>
          )}
        </main>
        <Copilot />
      </div>
      {/* The floating "Ask" launcher opens the companion chat on demand. */}
      <button
        className={`cop-open${copilotCollapsed ? ' show' : ''}`}
        aria-label={`Open ${c.name} chat`}
        onClick={() => toggleCopilot(false)}
      >
        <Companion id={companionId} size="s28" />
        Ask {c.name}
      </button>
      {buildActive && view !== 'build' && (
        <button className="build-return" onClick={() => show('build')}>
          🔨 Back to your build
        </button>
      )}
      <Onboarding />
      <Toast />
      <ArtifactModal />
      <InstallModal />
    </div>
  );
}

// Gates the app on auth. A signed-out visitor sees the brand splash first, then
// the sign-in screen. Once signed in and bootstrapped, the app mounts; onboarding
// (inside Shell) shows only for users who haven't completed it.
function Gate() {
  const { user, loading, bootstrapping } = useAuth();
  const [splashSeen, setSplashSeen] = useState(false);
  // After a deliberate sign-out (authed → not authed), return to the splash
  // rather than the bare sign-in screen.
  const wasAuthed = useRef(false);
  useEffect(() => {
    if (user) {
      wasAuthed.current = true;
    } else if (wasAuthed.current) {
      wasAuthed.current = false;
      setSplashSeen(false);
    }
  }, [user]);
  if (loading) return <LoadingScreen label="Loading…" />;
  if (!user) return splashSeen ? <SignIn /> : <Splash onContinue={() => setSplashSeen(true)} />;
  if (bootstrapping) return <LoadingScreen label="Setting up your company…" />;
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

export default function AppRoot() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </ThemeProvider>
  );
}
