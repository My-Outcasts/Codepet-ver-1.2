'use client';
// Central app store. Keeps the draft's mutate-then-rerender model: DEPTS / ENV are
// mutated in place and a `tick` counter forces consumers to re-read. Phase 2 adds
// persistence: on load the DEPTS/ENV singletons are HYDRATED from Firestore and the
// library is read into state; mutations (task approval, env toggle) write through to
// Firestore. The useApp() API is unchanged except for the added toggleEnv action.
import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ENV, type Dept, type Task, type LibItem } from './data';
import { artMeta } from './helpers';
import { useAuth } from './firebase/auth';
import {
  loadCompanyData,
  persistApproval,
  persistEnv,
  envStateFromCatalog,
} from './firebase/companyData';

export type View = 'overview' | 'home' | 'roadmap' | 'dept' | 'tasks' | 'library' | 'env';

export type Modal =
  { kind: 'run'; task: Task; dept: Dept; walk?: boolean } | { kind: 'view'; item: LibItem } | null;

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
  library: LibItem[];
  modal: Modal;
  runTask: (task: Task, dept: Dept, walk?: boolean) => void;
  viewItem: (item: LibItem) => void;
  closeModal: () => void;
  approveTask: (task: Task, dept: Dept, type: string) => { item: LibItem; next?: Task };
  toggleEnv: (category: string, index: number) => void;
  toastMsg: string;
  toast: (msg: string) => void;
}

const Ctx = createContext<AppState | null>(null);
export const useApp = (): AppState => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used within <AppProvider>');
  return v;
};

// Full-screen status panel shown while the company state hydrates from Firestore.
function HydrateScreen() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        background: 'var(--page)',
        color: 'var(--t-3)',
        fontSize: 13,
      }}
    >
      Loading your company…
    </div>
  );
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { companyId } = useAuth();

  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);

  const [view, setView] = useState<View>('home');
  const [deptKey, setDeptKey] = useState<string | null>(null);
  const [selStage, setSelStage] = useState(6);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [copilotCollapsed, setCopilotCollapsed] = useState(false);
  const [onboarding, setOnboarding] = useState(true); // always show on load
  const [modal, setModal] = useState<Modal>(null);
  const [toastMsg, setToastMsg] = useState('');

  // Library is owned here as state, hydrated from Firestore.
  const [library, setLibrary] = useState<LibItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 3400);
  }, []);

  // Hydrate DEPTS/ENV (in place) + library from Firestore once the company is known.
  // `hydrated` starts false and companyId only transitions null→uid once per session,
  // so there's no need to reset it synchronously here.
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    loadCompanyData(companyId)
      .then(({ library: lib }) => {
        if (cancelled) return;
        setLibrary(lib);
        bump(); // force consumers to re-read the now-hydrated DEPTS/ENV singletons
        setHydrated(true);
      })
      .catch((err) => {
        console.error('[store] hydrate failed', err);
        if (!cancelled) setHydrated(true); // fail open to the seed rather than hang
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, bump]);

  const show = useCallback((v: View) => {
    setView(v);
  }, []);
  const openDept = useCallback((k: string) => {
    setDeptKey(k);
    setView('dept');
  }, []);
  const selectStage = useCallback((n: number) => {
    setSelStage(n);
    setDrawerOpen(true);
  }, []);
  const closeStage = useCallback(() => setDrawerOpen(false), []);
  const toggleCopilot = useCallback((collapsed?: boolean) => {
    setCopilotCollapsed((c) => (collapsed === undefined ? !c : collapsed));
  }, []);
  const finishOnboarding = useCallback(() => setOnboarding(false), []);

  const runTask = useCallback(
    (task: Task, dept: Dept, walk?: boolean) => setModal({ kind: 'run', task, dept, walk }),
    [],
  );
  const viewItem = useCallback((item: LibItem) => setModal({ kind: 'view', item }), []);
  const closeModal = useCallback(() => setModal(null), []);

  const approveTask = useCallback(
    (t: Task, d: Dept, type: string) => {
      t.done = true;
      d.pend = Math.max(0, (d.pend || 0) - 1);
      if (d.pend === 0 && d.status === 'attention') d.status = 'ready';
      const { file, head, tag } = artMeta(t, type);
      const item: LibItem = {
        title: t.t,
        dept: d.name,
        k: d.k,
        ab: d.ab,
        type,
        out: t.out,
        file,
        head,
        tag,
        site: t.site,
        screens: t.screens,
        sheet: t.sheet,
        post: t.post,
        email: t.email,
        calendar: t.calendar,
        legal: t.legal,
        dms: t.dms,
        checklist: t.checklist,
        pr: t.pr,
      };
      t._item = item;
      setLibrary((prev) => [item, ...prev]);
      const next = d.tasks.find((x) => !x.done);
      bump();
      toast(
        (type === 'build' || type === 'site' || type === 'pr' ? 'Shipped' : 'Saved') + ' · ' + t.t,
      );
      // Write-through (optimistic — the in-memory update already happened).
      if (companyId) {
        persistApproval(companyId, d, item, Date.now()).catch((err) => {
          console.error('[store] persistApproval failed', err);
          toast('Saved locally — sync failed');
        });
      }
      return { item, next };
    },
    [companyId, bump, toast],
  );

  const toggleEnv = useCallback(
    (category: string, index: number) => {
      const item = ENV[category]?.[index];
      if (!item) return;
      item.s = item.s ? 0 : 1;
      bump();
      if (companyId) {
        persistEnv(companyId, envStateFromCatalog()).catch((err) => {
          console.error('[store] persistEnv failed', err);
        });
      }
    },
    [companyId, bump],
  );

  const value = useMemo<AppState>(
    () => ({
      tick,
      bump,
      view,
      show,
      deptKey,
      openDept,
      selStage,
      drawerOpen,
      selectStage,
      closeStage,
      copilotCollapsed,
      toggleCopilot,
      onboarding,
      finishOnboarding,
      library,
      modal,
      runTask,
      viewItem,
      closeModal,
      approveTask,
      toggleEnv,
      toastMsg,
      toast,
    }),
    [
      tick,
      bump,
      view,
      show,
      deptKey,
      openDept,
      selStage,
      drawerOpen,
      selectStage,
      closeStage,
      copilotCollapsed,
      toggleCopilot,
      onboarding,
      finishOnboarding,
      library,
      modal,
      runTask,
      viewItem,
      closeModal,
      approveTask,
      toggleEnv,
      toastMsg,
      toast,
    ],
  );

  return <Ctx.Provider value={value}>{hydrated ? children : <HydrateScreen />}</Ctx.Provider>;
}
