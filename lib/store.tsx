'use client';
// Central app store. Mirrors the draft's mutate-then-rerender model: DEPTS / ENV
// are mutated in place and a `tick` counter forces consumers to re-read. LIBRARY
// lives here as the single source of shipped/approved deliverables.
import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEPTS, type Dept, type Task, type LibItem } from './data';
import { artMeta } from './helpers';

export type View = 'home' | 'roadmap' | 'dept' | 'tasks' | 'library' | 'env' | 'install';

export type Modal =
  | { kind: 'run'; task: Task; dept: Dept; walk?: boolean }
  | { kind: 'view'; item: LibItem }
  | null;

interface AppState {
  tick: number;
  bump: () => void;
  view: View;
  show: (v: View) => void;
  deptKey: string | null;
  openDept: (k: string) => void;
  selStage: number;
  drawerOpen: boolean;
  selectStage: (n: number) => void;
  closeStage: () => void;
  copilotCollapsed: boolean;
  toggleCopilot: (collapsed?: boolean) => void;
  onboarding: boolean;
  finishOnboarding: () => void;
  installed: boolean;
  markInstalled: () => void;
  library: LibItem[];
  modal: Modal;
  runTask: (task: Task, dept: Dept, walk?: boolean) => void;
  viewItem: (item: LibItem) => void;
  closeModal: () => void;
  approveTask: (task: Task, dept: Dept, type: string) => { item: LibItem; next?: Task };
  toastMsg: string;
  toast: (msg: string) => void;
}

const Ctx = createContext<AppState | null>(null);
export const useApp = (): AppState => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used within <AppProvider>');
  return v;
};

// seed a few pre-approved deliverables so the populated Library is visible
function seedLibrary(): LibItem[] {
  const out: LibItem[] = [];
  ['Build the Codepet landing page', 'Write the launch announcement post', 'Build the waitlist conversion email', 'Instrument the dual go/no-go signal', 'Set up the TestFlight beta']
    .forEach((title) => {
      let t: Task | undefined, d: Dept | undefined;
      DEPTS.forEach((dep) => dep.tasks.forEach((x) => { if (x.t === title) { t = x; d = dep; } }));
      if (!t || !d) return;
      // mirror artType for the seeded item
      const tt = t;
      const type = tt.site ? 'site' : tt.screens ? 'screens' : tt.sheet ? 'sheet'
        : tt.pr ? 'pr' : tt.post ? 'post' : tt.email ? 'email' : tt.calendar ? 'calendar'
        : tt.legal ? 'legal' : tt.dms ? 'dms' : tt.checklist ? 'checklist'
        : tt.run === 'route' ? 'build' : tt.who === 'you' ? 'prep' : 'doc';
      const { file, head, tag } = artMeta(tt, type);
      out.push({
        title: tt.t, dept: d.name, k: d.k, ab: d.ab, type, out: tt.out, file, head, tag,
        site: tt.site, screens: tt.screens, sheet: tt.sheet, post: tt.post, email: tt.email,
        calendar: tt.calendar, legal: tt.legal, dms: tt.dms, checklist: tt.checklist, pr: tt.pr,
      });
    });
  return out;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);

  const [view, setView] = useState<View>('home');
  const [deptKey, setDeptKey] = useState<string | null>(null);
  const [selStage, setSelStage] = useState(6);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [copilotCollapsed, setCopilotCollapsed] = useState(false);
  const [onboarding, setOnboarding] = useState(true); // always show on load
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    try { if (localStorage.getItem('codepet:installed') === '1') setInstalled(true); } catch {}
  }, []);

  const [modal, setModal] = useState<Modal>(null);
  const [toastMsg, setToastMsg] = useState('');

  const libRef = useRef<LibItem[] | null>(null);
  if (libRef.current === null) libRef.current = seedLibrary();
  const library = libRef.current;

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 3400);
  }, []);

  const show = useCallback((v: View) => { setView(v); }, []);
  const openDept = useCallback((k: string) => { setDeptKey(k); setView('dept'); }, []);
  const selectStage = useCallback((n: number) => { setSelStage(n); setDrawerOpen(true); }, []);
  const closeStage = useCallback(() => setDrawerOpen(false), []);
  const toggleCopilot = useCallback((collapsed?: boolean) => {
    setCopilotCollapsed((c) => (collapsed === undefined ? !c : collapsed));
  }, []);
  const finishOnboarding = useCallback(() => setOnboarding(false), []);
  const markInstalled = useCallback(() => {
    setInstalled(true);
    try { localStorage.setItem('codepet:installed', '1'); } catch {}
  }, []);

  const runTask = useCallback((task: Task, dept: Dept, walk?: boolean) => setModal({ kind: 'run', task, dept, walk }), []);
  const viewItem = useCallback((item: LibItem) => setModal({ kind: 'view', item }), []);
  const closeModal = useCallback(() => setModal(null), []);

  const approveTask = useCallback((t: Task, d: Dept, type: string) => {
    t.done = true;
    d.pend = Math.max(0, (d.pend || 0) - 1);
    if (d.pend === 0 && d.status === 'attention') d.status = 'ready';
    const { file, head, tag } = artMeta(t, type);
    const item: LibItem = {
      title: t.t, dept: d.name, k: d.k, ab: d.ab, type, out: t.out, file, head, tag,
      site: t.site, screens: t.screens, sheet: t.sheet, post: t.post, email: t.email,
      calendar: t.calendar, legal: t.legal, dms: t.dms, checklist: t.checklist, pr: t.pr,
    };
    t._item = item;
    library.unshift(item);
    const next = d.tasks.find((x) => !x.done);
    bump();
    toast((type === 'build' || type === 'site' || type === 'pr' ? 'Shipped' : 'Saved') + ' · ' + t.t);
    return { item, next };
  }, [library, bump, toast]);

  const value = useMemo<AppState>(() => ({
    tick, bump, view, show, deptKey, openDept, selStage, drawerOpen, selectStage, closeStage,
    copilotCollapsed, toggleCopilot, onboarding, finishOnboarding, installed, markInstalled, library, modal, runTask,
    viewItem, closeModal, approveTask, toastMsg, toast,
  }), [tick, bump, view, show, deptKey, openDept, selStage, drawerOpen, selectStage, closeStage,
    copilotCollapsed, toggleCopilot, onboarding, finishOnboarding, installed, markInstalled, library, modal, runTask,
    viewItem, closeModal, approveTask, toastMsg, toast]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
