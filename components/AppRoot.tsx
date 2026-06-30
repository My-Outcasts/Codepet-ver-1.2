'use client';
import { useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { AppProvider, useApp } from '@/lib/store';
import { Topbar } from './Topbar';
import { Sidebar } from './Sidebar';
import { Copilot } from './Copilot';
import { Onboarding } from './Onboarding';
import { Toast } from './Toast';
import { Byte } from './Byte';
import { ArtifactModal } from './artifact/ArtifactModal';
import { CompanyView } from './views/CompanyView';
import { RoadmapView } from './views/RoadmapView';
import { DepartmentDetail } from './views/DepartmentDetail';
import { TasksView } from './views/TasksView';
import { LibraryView } from './views/LibraryView';
import { EnvironmentView } from './views/EnvironmentView';

// 3D graph view — client-only (three.js / WebGL), lazy-loaded so three.js
// is fetched only when the Overview tab is opened.
const OverviewView = dynamic(() => import('./views/OverviewView'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: '#0c0a17',
        display: 'grid',
        placeItems: 'center',
        color: 'rgba(245,243,255,.5)',
        fontSize: 13,
      }}
    >
      Building your company map…
    </div>
  ),
});

function Shell() {
  const { view, copilotCollapsed, toggleCopilot } = useApp();
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [view]);

  const ActiveView =
    view === 'overview' ? (
      <OverviewView />
    ) : view === 'home' ? (
      <CompanyView />
    ) : view === 'roadmap' ? (
      <RoadmapView />
    ) : view === 'dept' ? (
      <DepartmentDetail />
    ) : view === 'tasks' ? (
      <TasksView />
    ) : view === 'library' ? (
      <LibraryView />
    ) : (
      <EnvironmentView />
    );

  return (
    <div className="app">
      <Topbar />
      <div className={`shell${copilotCollapsed ? ' cop-collapsed' : ''}`}>
        <Sidebar />
        <main className="main" id="main" ref={mainRef}>
          {ActiveView}
        </main>
        <Copilot />
      </div>
      <button
        className={`cop-open${copilotCollapsed ? ' show' : ''}`}
        aria-label="Open byte chat"
        onClick={() => toggleCopilot(false)}
      >
        <Byte size="s28" />
        Ask byte
      </button>
      <Onboarding />
      <Toast />
      <ArtifactModal />
    </div>
  );
}

export default function AppRoot() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
