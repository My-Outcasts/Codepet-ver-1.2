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
import { track } from './analytics';
import { useAuth } from './firebase/auth';
import {
  loadCompanyData,
  persistApproval,
  persistEnv,
  persistRoadmapStage,
  envStateFromCatalog,
  completeOnboarding,
  resetCompanyData,
} from './firebase/companyData';
import { personalizeCompany } from './ai/personalize';
import type { CompanyBrief } from './firebase/schema';

export type View =
  'overview' | 'home' | 'roadmap' | 'dept' | 'tasks' | 'library' | 'env' | 'install';

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
  finishOnboarding: (brief?: CompanyBrief) => void;
  brief: CompanyBrief;
  installed: boolean;
  setInstalled: (value: boolean) => void;
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
  // Onboarding is shown only to users who haven't completed it. It starts false
  // and is flipped true after hydration iff the company has no `onboardedAt`
  // stamp — so returning users go straight to the app.
  const [onboarding, setOnboarding] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem('codepet:installed') === '1') setInstalled(true);
    } catch {}
  }, []);

  // Sign-out reset (Phase 5.5). AppProvider mounts only while signed in (see Gate
  // in AppRoot), so its unmount IS the sign-out boundary. Wipe the shared DEPTS/ENV
  // singletons then, so one account's in-memory edits can never linger into the next
  // account's session on the same browser — belt-and-suspenders alongside the
  // reset-on-load in loadCompanyData.
  useEffect(() => () => resetCompanyData(), []);

  const [modal, setModal] = useState<Modal>(null);
  const [toastMsg, setToastMsg] = useState('');

  // Library + business brief are owned here as state, hydrated from Firestore.
  const [library, setLibrary] = useState<LibItem[]>([]);
  const [brief, setBrief] = useState<CompanyBrief>({});
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
      .then(({ library: lib, brief: b, onboardedAt, roadmapStage }) => {
        if (cancelled) return;
        setLibrary(lib);
        setBrief(b);
        // Restore the last-viewed roadmap stage (drawer stays closed — we restore
        // position, not an open panel). Absent ⇒ keep the UI default.
        if (typeof roadmapStage === 'number') setSelStage(roadmapStage);
        // Show onboarding only to users who haven't done it. A non-empty brief
        // also counts as onboarded, so legacy users (saved a brief before the
        // `onboardedAt` stamp existed) aren't asked again.
        const onboarded = Boolean(onboardedAt) || Object.keys(b).length > 0;
        setOnboarding(!onboarded);
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
  const selectStage = useCallback(
    (n: number) => {
      setSelStage(n);
      setDrawerOpen(true);
      // Persist the position (optimistic, non-blocking — the UI already moved).
      if (companyId) {
        persistRoadmapStage(companyId, n).catch((err) =>
          console.error('[store] persistRoadmapStage failed', err),
        );
      }
    },
    [companyId],
  );
  const closeStage = useCallback(() => setDrawerOpen(false), []);
  const toggleCopilot = useCallback((collapsed?: boolean) => {
    setCopilotCollapsed((c) => (collapsed === undefined ? !c : collapsed));
  }, []);
  const finishOnboarding = useCallback(
    (briefData?: CompanyBrief) => {
      setOnboarding(false);
      if (briefData) setBrief(briefData);
      // Stamp completion (and brief, if any) so onboarding never shows again —
      // runs for both "finish" and "skip".
      if (companyId) {
        completeOnboarding(companyId, briefData)
          .then(() => {
            // One-time seed personalization (Phase 5.3): once the brief is persisted,
            // byte rewrites the department/task text for this company. Best-effort —
            // on any failure the generic seed stays. Skipped when no brief was given.
            if (!briefData) return;
            return personalizeCompany(companyId, briefData).then((changed) => {
              if (changed) bump(); // re-render with the now-personalized DEPTS
            });
          })
          .catch((err) => console.error('[store] completeOnboarding failed', err));
      }
    },
    [companyId, bump],
  );
  const setInstalledFlag = useCallback((value: boolean) => {
    setInstalled(value);
    try {
      if (value) localStorage.setItem('codepet:installed', '1');
      else localStorage.removeItem('codepet:installed');
    } catch {}
  }, []);

  const runTask = useCallback((task: Task, dept: Dept, walk?: boolean) => {
    track('task.run', { dept: dept.k });
    setModal({ kind: 'run', task, dept, walk });
  }, []);
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
      track('task.approved', { dept: d.k, type });
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
      brief,
      installed,
      setInstalled: setInstalledFlag,
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
      brief,
      installed,
      setInstalledFlag,
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
