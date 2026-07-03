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
import { DEPTS, ENV, type Dept, type Task, type LibItem } from './data';
import { artMeta, artType } from './helpers';
import { runByteTask, GenerateError } from './ai/runTask';
import { rememberApproval } from './ai/remember';
import { applyResult, liveKind, currentDraft } from './ai/applyResult';
import { track } from './analytics';
import { useAuth } from './firebase/auth';
import {
  loadCompanyData,
  loadTrackingSummary,
  loadProjects,
  persistApproval,
  persistEnv,
  persistRoadmapStage,
  persistBrief,
  persistChatMessage,
  envStateFromCatalog,
  completeOnboarding,
  resetCompanyData,
} from './firebase/companyData';
import { scaffoldCompany } from './ai/scaffold';
import { LoadingScreen } from '../components/LoadingScreen';
import { streamByteChat, ChatError } from './ai/chat';
import { fetchNextStep, type NextStep } from './ai/nextStep';
import { nextAction, setStageWatermark } from './roadmap';
import { roadmapWatermarkFor, nextStageOf, stageComplete } from './stages';

/** One byte-chat message in the UI. 'me' = the founder, 'byte' = the companion. */
export interface ChatMessage {
  id: string;
  role: 'me' | 'byte';
  text: string;
  ts: number;
  /** An optional one-tap action byte offers in-chat (e.g. "Start: <task>").
   * `inline: true` ⇒ produce the deliverable in-thread (runTaskInChat) instead of
   * opening the department run modal (runBriefedTask). */
  action?: { label: string; deptK: string; taskTitle: string; inline?: boolean };
  /** Transient arrival briefing (not persisted; only the latest is kept in the thread). */
  brief?: boolean;
  /** byte is producing a deliverable for this message right now (inline run). */
  running?: boolean;
  /** An inline deliverable byte produced in chat, awaiting approval (reads the live task). */
  result?: { deptK: string; taskTitle: string; type: string; approved?: boolean };
  /** A "stage complete — advance?" prompt: the rung the founder can move up to. */
  advance?: { toStage: string };
}

const newId = (): string =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
import type { CompanyBrief } from './firebase/schema';
import {
  buildRevealSummary,
  buildFirstRunGreeting,
  type RevealSummary,
} from './onboarding/firstRun';
import { EMPTY_TRACKING, type TrackingSummary } from './tracking';

export type View =
  | 'summary'
  | 'overview'
  | 'home'
  | 'roadmap'
  | 'dept'
  | 'tasks'
  | 'library'
  | 'env'
  | 'install'
  | 'settings'
  | 'build';

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
  /** Sidebar collapsed to an icon-only rail (persisted) — frees width for the main + chat. */
  sideCollapsed: boolean;
  toggleSide: (collapsed?: boolean) => void;
  onboarding: boolean;
  finishOnboarding: (brief?: CompanyBrief) => void;
  /** Run the real scaffold during onboarding's analysis step; returns the reveal summary. */
  scaffoldFromOnboarding: (brief: CompanyBrief) => Promise<RevealSummary>;
  /** Re-generate the stage-aware company for the current account (manual re-plan). */
  regenerateCompany: () => void;
  /** Advance to the next product stage (confirmed): move the map + re-plan the company. */
  advanceStage: () => void;
  brief: CompanyBrief;
  installed: boolean;
  setInstalled: (value: boolean) => void;
  library: LibItem[];
  /** Real Claude Code activity rolled up for the Summary (empty until events arrive). */
  tracking: TrackingSummary;
  /** Distinct local projects the tracker has reported (empty until events arrive). */
  projects: string[];
  modal: Modal;
  runTask: (task: Task, dept: Dept, walk?: boolean) => void;
  /** byte "arrives" in a department: fly there, open chat, drop an orientation + start chip. */
  briefDepartment: (dept: Dept, task: Task | null) => void;
  /** Camera-fly signal the Overview map consumes to glide to a department node (bumped per portal). */
  portalSignal: { deptK: string; n: number } | null;
  /** Portal into a task from anywhere (e.g. the Roadmap): go to the map, byte arrives in chat, camera flies to its dept. */
  portalToTask: (deptK: string, taskTitle: string) => void;
  /** Run a task named by an in-chat action chip (deptK + taskTitle). */
  runBriefedTask: (deptK: string, taskTitle: string) => void;
  viewItem: (item: LibItem) => void;
  closeModal: () => void;
  /** A deliverable opened into the "Your company" section (in-context, not a modal). */
  /** Open a delivered artifact externally: a site in a new tab, everything else copied. */
  openDeliverable: (item: LibItem) => void;
  approveTask: (task: Task, dept: Dept, type: string) => { item: LibItem; next?: Task };
  toggleEnv: (category: string, index: number) => void;
  chatMessages: ChatMessage[];
  chatStreaming: boolean;
  sendChat: (text: string) => void;
  /** Produce a task's deliverable inline in chat (byte's "run it from here"). */
  runTaskInChat: (deptK: string, taskTitle: string) => void;
  /** Revise an inline chat result against byte's feedback, updating the card in place.
   * An empty note is a plain regenerate. */
  reviseTaskInChat: (msgId: string, deptK: string, taskTitle: string, note: string) => void;
  /** Approve an inline chat result — saves to the Library + marks the task done. */
  approveChatResult: (deptK: string, taskTitle: string) => void;
  /** Open an inline chat result the minimal way (site → new tab, else copy). */
  openChatResult: (deptK: string, taskTitle: string) => void;
  /** Drop a chat message's one-tap action once it has been used. */
  dismissChatAction: (msgId: string) => void;
  /** byte's single next step — the one value the beacon AND chat both read. */
  nextStep: NextStep | null;
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
  return <LoadingScreen label="Loading your company…" />;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { companyId } = useAuth();

  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);

  const [view, setView] = useState<View>('home');
  const [deptKey, setDeptKey] = useState<string | null>(null);
  const [selStage, setSelStage] = useState(6);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Bumped whenever something requests the map to fly to a department (the portal).
  const [portalSignal, setPortalSignal] = useState<{ deptK: string; n: number } | null>(null);
  // Chat starts closed by default; the floating button opens it on demand.
  const [copilotCollapsed, setCopilotCollapsed] = useState(true);
  const [sideCollapsed, setSideCollapsed] = useState(false);
  // Onboarding is shown only to users who haven't completed it. It starts false
  // and is flipped true after hydration iff the company has no `onboardedAt`
  // stamp — so returning users go straight to the app.
  const [onboarding, setOnboarding] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem('codepet:installed') === '1') setInstalled(true);
      if (localStorage.getItem('codepet:sidecollapsed') === '1') setSideCollapsed(true);
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
  const [tracking, setTracking] = useState<TrackingSummary>(EMPTY_TRACKING);
  const [projects, setProjects] = useState<string[]>([]);
  const [brief, setBrief] = useState<CompanyBrief>({});
  const [hydrated, setHydrated] = useState(false);

  // byte chat: messages (hydrated from Firestore) + a streaming guard.
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatStreaming, setChatStreaming] = useState(false);

  // byte's single next step — the one value the beacon AND chat read, so they can
  // never disagree. Set instantly to the authored golden path (so nothing is ever
  // blank), then swapped to byte's own pick when /api/next-step resolves. Recomputed
  // on hydrate and after every approval. On failure the authored fallback stands.
  const [nextStep, setNextStep] = useState<NextStep | null>(null);
  const computeNextStep = useCallback(() => {
    const fb = nextAction();
    const fallback: NextStep | null = fb
      ? { deptK: fb.dept.k, taskTitle: fb.task.t, why: '' }
      : null;
    setNextStep(fallback);
    if (!fallback) return; // nothing open
    fetchNextStep()
      .then((pick) => {
        if (pick) setNextStep(pick);
      })
      .catch((err) => console.error('[store] next-step failed — keeping authored fallback', err));
  }, []);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstApproveTracked = useRef(false);
  const scaffoldedInWizard = useRef(false);
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
      .then(({ library: lib, brief: b, onboardedAt, roadmapStage, chat }) => {
        if (cancelled) return;
        setLibrary(lib);
        setBrief(b);
        setStageWatermark(roadmapWatermarkFor(b.stage)); // position the roadmap at their stage
        setChatMessages(
          chat.map((m) => ({ id: m.id, role: m.role, text: m.text, ts: m.createdAt })),
        );
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
        computeNextStep(); // DEPTS is hydrated now — pick the next step
      })
      .catch((err) => {
        console.error('[store] hydrate failed', err);
        if (!cancelled) setHydrated(true); // fail open to the seed rather than hang
      });
    // Tracking loads independently — never block hydration on it, and a failure
    // just leaves the empty summary (Summary falls back to its DEPTS-derived view).
    loadTrackingSummary(companyId)
      .then((t) => {
        if (!cancelled) setTracking(t);
      })
      .catch(() => {});
    // Projects load independently too — a failure just leaves the picker empty.
    loadProjects(companyId)
      .then((p) => {
        if (!cancelled) setProjects(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [companyId, bump, computeNextStep]);

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
  const toggleSide = useCallback((collapsed?: boolean) => {
    setSideCollapsed((c) => {
      const next = collapsed === undefined ? !c : collapsed;
      try {
        if (next) localStorage.setItem('codepet:sidecollapsed', '1');
        else localStorage.removeItem('codepet:sidecollapsed');
      } catch {}
      return next;
    });
  }, []);

  // First-run only: byte opens chat and greets the founder by name with the single best
  // first move as a one-tap INLINE action (produces the deliverable in-thread). Seeds
  // immediately from the authored fallback, then upgrades to byte's own pick when
  // /api/next-step resolves — the greeting message updates in place (stable id).
  const greetFirstRun = useCallback(
    (briefData: CompanyBrief) => {
      toggleCopilot(false); // open the chat panel so the greeting is seen
      const gid = newId();
      // Fire firstrun.action_offered at most once — when an action first appears,
      // whether it came from the synchronous authored fallback or the async byte pick.
      let offered = false;
      const seed = (ns: NextStep | null) => {
        const g = buildFirstRunGreeting(briefData, ns);
        setChatMessages((prev) => {
          const msg: ChatMessage = {
            id: gid,
            role: 'byte',
            text: g.text,
            ts: Date.now(),
            action: g.action,
          };
          const i = prev.findIndex((m) => m.id === gid);
          return i === -1 ? [...prev, msg] : prev.map((m) => (m.id === gid ? msg : m));
        });
        if (g.action && !offered) {
          offered = true;
          track('firstrun.action_offered', { dept: g.action.deptK });
        }
      };
      const fb = nextAction();
      const fallback: NextStep | null = fb
        ? { deptK: fb.dept.k, taskTitle: fb.task.t, why: '' }
        : null;
      setNextStep(fallback);
      seed(fallback);
      // Always ask byte for the best first move — even when the synchronous authored
      // fallback is momentarily null (e.g. the roadmap isn't settled the instant
      // onboarding finishes). Recovering the action here keeps the greeting's
      // "Do it with me" — the whole B→C bridge — from silently vanishing.
      // fetchNextStep resolves to null when nothing is open, leaving a correct nudge.
      fetchNextStep()
        .then((pick) => {
          if (pick) {
            setNextStep(pick);
            seed(pick);
          }
        })
        .catch((err) => console.error('[store] greetFirstRun next-step failed', err));
    },
    [toggleCopilot],
  );

  // Run the real stage-aware scaffold DURING onboarding (the wizard's "analysis" step),
  // so the founder watches byte build their actual company instead of a fake animation.
  // Marks scaffoldedInWizard so finishOnboarding won't run it a second time. Returns a
  // reveal summary read from the now-live DEPTS (ok=false ⇒ generation failed, seed kept).
  const scaffoldFromOnboarding = useCallback(
    async (briefData: CompanyBrief): Promise<RevealSummary> => {
      scaffoldedInWizard.current = true; // we attempted it here; don't double-run in finish
      if (!companyId) return buildRevealSummary(DEPTS, false);
      const changed = await scaffoldCompany(companyId, briefData);
      if (changed > 0) bump();
      return buildRevealSummary(DEPTS, changed > 0);
    },
    [companyId, bump],
  );

  const finishOnboarding = useCallback(
    (briefData?: CompanyBrief) => {
      setOnboarding(false);
      if (briefData) {
        setBrief(briefData);
        setStageWatermark(roadmapWatermarkFor(briefData.stage));
      }
      // Stamp completion (and brief, if any) so onboarding never shows again —
      // runs for both "finish" and "skip".
      if (companyId) {
        completeOnboarding(companyId, briefData)
          .then(() => {
            // The wizard's analysis step already scaffolded (the real reveal). Only
            // scaffold here as a fallback when it didn't (e.g. a "skip" with a brief).
            if (!briefData || scaffoldedInWizard.current) return;
            return scaffoldCompany(companyId, briefData).then((changed) => {
              if (changed) bump();
            });
          })
          .catch((err) => console.error('[store] completeOnboarding failed', err));
      }
      if (briefData) greetFirstRun(briefData);
    },
    [companyId, bump, greetFirstRun],
  );

  // Manual re-plan: regenerate the stage-aware company for the current account
  // (existing companies aren't scaffolded automatically). Used to test/refresh.
  const regenerateCompany = useCallback(() => {
    if (!companyId) return;
    toast('Re-planning your company for your stage…');
    scaffoldCompany(companyId, brief).then((changed) => {
      if (changed) {
        bump();
        computeNextStep();
        toast('Company re-planned for your stage');
      } else {
        toast('Couldn’t re-plan just now — try again');
      }
    });
  }, [companyId, brief, bump, toast, computeNextStep]);

  // Advance to the next product stage (confirmed from the "stage complete" prompt).
  // Optimistically bumps brief.stage so the map moves at once, then re-plans the company
  // for the NEW stage so its tasks appear. The finished tasks already live in the Library.
  // No-op at the top rung. Uses the freshly-computed `updated` brief for the re-plan
  // (state setters are async, so we can't rely on `brief` here yet).
  //
  // The stage is persisted ONLY after the re-plan succeeds — and rolled back in memory if
  // it fails — so a failed re-plan can never strand the founder at a new stage that still
  // shows the previous stage's tasks (a half-state that would survive reload). The retry
  // affordance (the advance button) is restored on the note so they can try again.
  const advanceStage = useCallback(() => {
    const next = nextStageOf(brief.stage);
    if (!next) return;
    const prevBrief = brief;
    const company = brief.projectName?.trim() || 'your company';
    const updated = { ...brief, stage: next };
    const noteId = newId();
    setBrief(updated);
    setStageWatermark(roadmapWatermarkFor(next));
    bump(); // move the map now (overlay phase + roadmap "you are here")
    // Clear the advance prompt(s), then post a "re-planning…" note (updated on settle).
    setChatMessages((prev) => [
      ...prev.map((m) => (m.advance ? { ...m, advance: undefined } : m)),
      {
        id: noteId,
        role: 'byte',
        text: `You're in ${next} now. Re-planning ${company} for this stage…`,
        ts: Date.now(),
      },
    ]);
    if (!companyId) return;
    scaffoldCompany(companyId, updated).then((changed) => {
      if (changed) {
        // Re-plan took — now it's safe to persist the new stage.
        persistBrief(companyId, updated).catch((err) =>
          console.error('[store] persistBrief failed', err),
        );
        bump();
        computeNextStep();
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === noteId
              ? {
                  ...m,
                  text: `You're in ${next} now — I've re-planned ${company} for this stage. Here's what's next.`,
                }
              : m,
          ),
        );
      } else {
        // Re-plan failed and nothing was persisted — roll the stage back so the founder
        // stays consistent (current stage + current tasks), and offer a retry.
        setBrief(prevBrief);
        setStageWatermark(roadmapWatermarkFor(prevBrief.stage));
        bump();
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === noteId
              ? {
                  ...m,
                  text: `I couldn't re-plan just now, so I've kept you on your current stage — nothing changed. Want to try again?`,
                  advance: { toStage: next },
                }
              : m,
          ),
        );
      }
    });
  }, [brief, companyId, bump, computeNextStep]);
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

  // Open a delivered artifact the minimal way — no modal, no inline takeover:
  // a site opens in a new browser tab; everything else copies to the clipboard.
  const openDeliverable = useCallback(
    (item: LibItem) => {
      setModal(null);
      if (item.type === 'site' && typeof item.site === 'string' && item.site) {
        try {
          const url = URL.createObjectURL(new Blob([item.site], { type: 'text/html' }));
          window.open(url, '_blank', 'noopener');
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch {
          toast('Couldn’t open the site');
        }
        return;
      }
      const text = typeof item.out === 'string' ? item.out.trim() : '';
      if (text && navigator.clipboard?.writeText) {
        navigator.clipboard
          .writeText(text)
          .then(() => toast('Copied to clipboard'))
          .catch(() => toast('Copy failed'));
      } else {
        toast('Nothing to copy');
      }
    },
    [toast],
  );

  // Arrival briefing: when the founder starts the next step, byte "arrives" in that
  // department — the map flies there, chat opens, and byte drops a short orientation
  // (where you are, why, what's open) with a one-tap chip to start the task. The
  // briefing is transient (not persisted) — it's guidance for this moment.
  const briefDepartment = useCallback(
    (d: Dept, t: Task | null) => {
      toggleCopilot(false);
      const open = d.tasks.filter((x) => !x.done).length;
      const need = (d.need || '').trim();
      const text = `You're in ${d.name}.${need ? ` ${need}` : ''} ${open} task${open === 1 ? '' : 's'} open here${t ? ` — I'd start with “${t.t}”` : ''}.`;
      const msg: ChatMessage = {
        id: newId(),
        role: 'byte',
        text,
        ts: Date.now(),
        action: t ? { label: `Start: ${t.t}`, deptK: d.k, taskTitle: t.t } : undefined,
        brief: true,
      };
      // Keep only the latest briefing — drop any prior one so the thread never
      // fills with repeated "You're in …" arrivals.
      setChatMessages((prev) => [...prev.filter((m) => !m.brief), msg]);
    },
    [toggleCopilot],
  );

  // Portal into a task from anywhere in the app (e.g. the Roadmap's "now" stage):
  // switch to the map, have byte arrive + orient in chat, and bump the fly signal so
  // the Overview glides the camera to that department. This is the SAME arrival the
  // beacon's Start runs — one shared entry point, so every surface routes into the
  // work the same way.
  const portalToTask = useCallback(
    (deptK: string, taskTitle: string) => {
      const d = DEPTS.find((x) => x.k === deptK);
      if (!d) return;
      const t = d.tasks.find((x) => x.t === taskTitle) || null;
      setView('overview');
      briefDepartment(d, t);
      setPortalSignal({ deptK, n: Date.now() });
    },
    [briefDepartment],
  );

  // Open the run loop for a task named by an in-chat action chip.
  const runBriefedTask = useCallback(
    (deptK: string, taskTitle: string) => {
      const d = DEPTS.find((x) => x.k === deptK);
      const t = d?.tasks.find((x) => x.t === taskTitle);
      if (d && t) runTask(t, d, t.who === 'you');
    },
    [runTask],
  );

  // After an approval, if the founder has now finished every active task for their
  // current stage, surface a one-tap "advance to the next stage?" prompt in chat (and
  // open the chat so they see the moment). Confirm-first — advancing re-plans the whole
  // company, so it's the founder's call. No-op unless the stage just completed, and it
  // never stacks a second prompt.
  const maybeOfferAdvance = useCallback(() => {
    if (!stageComplete()) return;
    const next = nextStageOf(brief.stage);
    const stageName = brief.stage?.trim();
    const company = brief.projectName?.trim() || 'your company';
    setChatMessages((prev) => {
      if (prev.some((m) => m.advance)) return prev; // one prompt at a time
      const text = next
        ? `That's every task done${stageName ? ` for your ${stageName} stage` : ''} — real progress. Ready to move to ${next}? I'll re-plan ${company} for it.`
        : `That's everything done — you've taken ${company} all the way to Growing. That's the whole journey. Huge milestone.`;
      return [
        ...prev,
        {
          id: newId(),
          role: 'byte',
          text,
          ts: Date.now(),
          advance: next ? { toStage: next } : undefined,
        },
      ];
    });
    toggleCopilot(false);
  }, [brief, toggleCopilot]);

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
        plan: t.plan,
      };
      t._item = item;
      setLibrary((prev) => [item, ...prev]);
      const next = d.tasks.find((x) => !x.done);
      bump();
      track('task.approved', { dept: d.k, type });
      toast((type === 'build' || type === 'site' ? 'Shipped' : 'Saved') + ' · ' + t.t);
      // Write-through (optimistic — the in-memory update already happened).
      if (companyId) {
        persistApproval(companyId, d, item, Date.now()).catch((err) => {
          console.error('[store] persistApproval failed', err);
          toast('Saved locally — sync failed');
        });
        // Fire-and-forget: let byte extract any durable decision this deliverable locks
        // in (server-gated by AI_MEMORY_ENABLED; never blocks or surfaces errors).
        rememberApproval({
          title: item.title,
          dept: item.dept,
          type,
          out: typeof item.out === 'string' ? item.out : '',
        });
      }
      computeNextStep(); // this task is done now — advance the next step
      maybeOfferAdvance(); // …and if that was the last one, offer to move up a stage
      return { item, next };
    },
    [companyId, bump, toast, computeNextStep, maybeOfferAdvance],
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

  // Produce a task's deliverable INLINE in chat — byte's "run it from here." Runs the
  // exact same generation the department panel uses (runByteTask → applyResult), then
  // leaves a result card in the thread for the founder to approve. Reads live DEPTS, so
  // the card renders the fresh deliverable after bump().
  const runTaskInChat = useCallback(
    async (deptK: string, taskTitle: string) => {
      const d = DEPTS.find((x) => x.k === deptK);
      const t = d?.tasks.find((x) => x.t === taskTitle);
      if (!d || !t) return;
      const type = artType(t);
      const kind = liveKind(type);
      const msgId = newId();
      if (!kind) {
        // Not something byte can produce here — say so plainly instead of failing.
        setChatMessages((prev) => [
          ...prev,
          {
            id: msgId,
            role: 'byte',
            text: `“${t.t}” isn’t one I can produce right here — open it in ${d.name} and I’ll help you finish it.`,
            ts: Date.now(),
          },
        ]);
        return;
      }
      // Drop a "producing…" card, then swap it for the finished deliverable.
      setChatMessages((prev) => [
        ...prev,
        {
          id: msgId,
          role: 'byte',
          text: '',
          ts: Date.now(),
          running: true,
          result: { deptK, taskTitle, type },
        },
      ]);
      try {
        const res = await runByteTask({
          kind,
          taskTitle: t.t,
          taskHint: t.d,
          deptName: d.name,
          brief,
        });
        applyResult(t, type, res);
        bump();
        track('chat.run_task', { dept: d.k, type });
        setChatMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, running: false } : m)));
      } catch (err) {
        const code = err instanceof GenerateError ? err.code : '';
        const limited = code === 'rate_limited' || code === 'http_429';
        const msg = limited
          ? 'We’ve hit today’s usage limit — it resets tomorrow. Let’s pick this up then.'
          : 'I hit a snag producing that — want me to try again?';
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === msgId ? { ...m, running: false, result: undefined, text: msg } : m,
          ),
        );
      }
    },
    [brief, bump],
  );

  // Revise an inline chat result against the founder's feedback — the same revise pass
  // the department panel runs (runByteTask with reviseNote + the current draft), but the
  // result updates the SAME card in place instead of opening "v2" elsewhere. An empty
  // note is a plain regenerate (so this subsumes the old blind Redo). On failure the
  // existing draft is kept untouched — a bad revise never destroys good output.
  const reviseTaskInChat = useCallback(
    async (msgId: string, deptK: string, taskTitle: string, note: string) => {
      const d = DEPTS.find((x) => x.k === deptK);
      const t = d?.tasks.find((x) => x.t === taskTitle);
      if (!d || !t) return;
      const type = artType(t);
      const kind = liveKind(type);
      if (!kind) return;
      const trimmed = note.trim();
      setChatMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, running: true } : m)));
      try {
        const res = await runByteTask({
          kind,
          taskTitle: t.t,
          taskHint: t.d,
          deptName: d.name,
          brief,
          reviseNote: trimmed || undefined,
          current: trimmed ? currentDraft(t, type) : undefined,
        });
        applyResult(t, type, res);
        bump();
        track('chat.revise_task', { dept: d.k, type });
        setChatMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, running: false } : m)));
      } catch (err) {
        const code = err instanceof GenerateError ? err.code : '';
        const limited = code === 'rate_limited' || code === 'http_429';
        toast(
          limited
            ? 'We’ve hit today’s usage limit — it resets tomorrow.'
            : 'I hit a snag revising that — want to try again?',
        );
        setChatMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, running: false } : m)));
      }
    },
    [brief, bump, toast],
  );

  // Approve an inline chat result: same as approving from the panel (Library + done),
  // then flip the card to its saved state.
  const approveChatResult = useCallback(
    (deptK: string, taskTitle: string) => {
      const d = DEPTS.find((x) => x.k === deptK);
      const t = d?.tasks.find((x) => x.t === taskTitle);
      if (!d || !t) return;
      const type = artType(t);
      approveTask(t, d, type);
      if (!firstApproveTracked.current) {
        firstApproveTracked.current = true;
        track('firstrun.first_approve', { dept: deptK });
      }
      setChatMessages((prev) =>
        prev.map((m) =>
          m.result && m.result.deptK === deptK && m.result.taskTitle === taskTitle
            ? { ...m, result: { ...m.result, approved: true } }
            : m,
        ),
      );
    },
    [approveTask],
  );

  // Drop a chat message's one-tap action once it's been used (e.g. after the
  // first-run greeting's "Do it with me" is tapped) so it can't be re-run.
  const dismissChatAction = useCallback((msgId: string) => {
    setChatMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, action: undefined } : m)));
  }, []);

  // Open an inline chat result the minimal way (site → new tab, else copy) — reuses
  // the shared openDeliverable behavior, built from the live task.
  const openChatResult = useCallback(
    (deptK: string, taskTitle: string) => {
      const d = DEPTS.find((x) => x.k === deptK);
      const t = d?.tasks.find((x) => x.t === taskTitle);
      if (!d || !t) return;
      const type = artType(t);
      const { file, head, tag } = artMeta(t, type);
      openDeliverable({
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
        plan: t.plan,
      });
    },
    [openDeliverable],
  );

  // byte chat. Appends the founder's message, streams byte's reply in place, and
  // persists both. One turn at a time — guarded by chatStreaming.
  const sendChat = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text || chatStreaming) return;

      const now = Date.now();
      const userMsg: ChatMessage = { id: newId(), role: 'me', text, ts: now };
      const byteMsg: ChatMessage = { id: newId(), role: 'byte', text: '', ts: now + 1 };

      // Build the history to send BEFORE the empty byte placeholder is added.
      const history = [...chatMessages, userMsg].map((m) => ({ role: m.role, text: m.text }));
      setChatMessages((prev) => [...prev, userMsg, byteMsg]);
      setChatStreaming(true);
      track('chat.send', {});

      if (companyId) {
        persistChatMessage(companyId, {
          id: userMsg.id,
          role: 'me',
          text,
          createdAt: userMsg.ts,
        }).catch((err) => console.error('[store] persist user message failed', err));
      }

      // A compact snapshot of the departments so byte talks about THIS company —
      // plus the single next step byte already picked, so chat and the map beacon
      // never disagree about what's next.
      const deptLines = DEPTS.map(
        (d) => `- ${d.name} (${d.status}, ${d.pend} to do): ${d.need}`,
      ).join('\n');
      const focusDept = nextStep ? DEPTS.find((d) => d.k === nextStep.deptK)?.name : undefined;
      const focus =
        nextStep && focusDept
          ? `\n\nCURRENT NEXT STEP (the founder's single focus right now): "${nextStep.taskTitle}" in ${focusDept}${nextStep.why ? ` — ${nextStep.why}` : ''}. If they ask what to do next, this is the answer; you may sequence or add detail, but do not contradict it.`
          : '';
      const deptSummary = deptLines + focus;

      // The tasks byte may run from chat: every open task with a live deliverable type.
      const openTasks = DEPTS.flatMap((d) =>
        d.tasks
          .filter((t) => !t.done && liveKind(artType(t)) !== null)
          .map((t) => ({ deptK: d.k, deptName: d.name, taskTitle: t.t, hint: t.d ?? '' })),
      );

      (async () => {
        let acc = '';
        let errCode = '';
        let pending: { deptK: string; taskTitle: string } | null = null;
        try {
          for await (const ev of streamByteChat(history, deptSummary, openTasks)) {
            if (ev.type === 'action') {
              pending = { deptK: ev.deptK, taskTitle: ev.taskTitle };
              continue;
            }
            acc += ev.text;
            setChatMessages((prev) =>
              prev.map((m) => (m.id === byteMsg.id ? { ...m, text: acc } : m)),
            );
          }
        } catch (err) {
          console.error('[store] chat stream failed', err);
          errCode = err instanceof ChatError ? err.code : '';
        }
        const fallback =
          errCode === 'rate_limited'
            ? 'We’ve hit today’s usage limit — it resets tomorrow. Let’s pick this back up then.'
            : 'I hit a snag reaching the model — give it another try.';
        // If byte chose to run a task but said nothing, synthesize a short lead-in so
        // the run never appears out of nowhere.
        const finalText =
          acc.trim() || (pending ? `On it — running “${pending.taskTitle}”.` : fallback);
        setChatMessages((prev) =>
          prev.map((m) => (m.id === byteMsg.id ? { ...m, text: finalText } : m)),
        );
        setChatStreaming(false);
        // Persist byte's reply if it's a real answer or a run lead-in (not the error
        // fallback). The inline result card itself is transient, like the briefings.
        if (companyId && (acc.trim() || pending)) {
          persistChatMessage(companyId, {
            id: byteMsg.id,
            role: 'byte',
            text: finalText,
            createdAt: byteMsg.ts,
          }).catch((err) => console.error('[store] persist byte message failed', err));
        }
        // byte decided to run a task — produce it inline now.
        if (pending) runTaskInChat(pending.deptK, pending.taskTitle);
      })();
    },
    [companyId, chatMessages, chatStreaming, nextStep, runTaskInChat],
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
      sideCollapsed,
      toggleSide,
      onboarding,
      finishOnboarding,
      scaffoldFromOnboarding,
      regenerateCompany,
      advanceStage,
      brief,
      installed,
      setInstalled: setInstalledFlag,
      library,
      tracking,
      projects,
      modal,
      runTask,
      briefDepartment,
      portalSignal,
      portalToTask,
      runBriefedTask,
      viewItem,
      closeModal,
      openDeliverable,
      approveTask,
      toggleEnv,
      chatMessages,
      chatStreaming,
      sendChat,
      runTaskInChat,
      reviseTaskInChat,
      approveChatResult,
      openChatResult,
      dismissChatAction,
      nextStep,
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
      sideCollapsed,
      toggleSide,
      onboarding,
      finishOnboarding,
      scaffoldFromOnboarding,
      regenerateCompany,
      advanceStage,
      brief,
      installed,
      setInstalledFlag,
      library,
      tracking,
      projects,
      modal,
      runTask,
      briefDepartment,
      portalSignal,
      portalToTask,
      runBriefedTask,
      viewItem,
      closeModal,
      openDeliverable,
      approveTask,
      toggleEnv,
      chatMessages,
      chatStreaming,
      sendChat,
      runTaskInChat,
      reviseTaskInChat,
      approveChatResult,
      openChatResult,
      dismissChatAction,
      nextStep,
      toastMsg,
      toast,
    ],
  );

  return <Ctx.Provider value={value}>{hydrated ? children : <HydrateScreen />}</Ctx.Provider>;
}
