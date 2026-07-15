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
import { artMeta, artType, buildLog, type LogStep } from './helpers';
import { runByteTask, GenerateError, postEnrichAnswer, fetchTaskHelp } from './ai/runTask';
import { getByok } from './ai/byokClient';
import { mergeDecisions } from './ai/decisions';
import type { TaskHelp } from './ai/taskHelp';
import { detectGaps, QUESTION_FOR, type Gap } from './ai/enrichInterview';
import { rememberApproval } from './ai/remember';
import { applyResult, liveKind, currentDraft } from './ai/applyResult';
import { track } from './analytics';
import { useAuth } from './firebase/auth';
import { fetchProjectAnalysis } from './ai/analyzeProject';
import { isUsableAnalysis, type ProjectAnalysis } from './ai/projectAnalysis';
import {
  loadCompanyData,
  loadTrackingSummary,
  loadProjects,
  persistApproval,
  persistDepartmentTasks,
  persistEnv,
  persistRoadmapStage,
  persistIntroSeen,
  persistBrief,
  persistChatMessage,
  persistDecisions,
  persistProjectAnalysis,
  envStateFromCatalog,
  completeOnboarding,
  resetCompanyData,
  subscribeLiveBuild,
  ensureIngestToken,
  loadProjectDirs,
  envUsageFromCatalog,
  persistEnvUsage,
  loadThreadMessages,
  persistThread,
  updateThreadTitle,
  deleteThreadAndMessages,
  appendEvent,
} from './firebase/companyData';
import { eventFromLibItem, eventFromDecision, eventFromStageAdvance } from './overview/ledger';
import { persistWithRetry } from '@/lib/firebase/persistWithRetry';
import { cleanCompanyName, normalizeBrief } from '@/lib/companyName';
import { deriveThreadTitle, pickFallbackThreadId } from './chat/threads';
import type { ThreadMeta, LedgerEvent } from './firebase/schema';
import { toolkitUsedFor, appendTaskUse } from './ai/toolkitUse';
import { DEFAULT_COMPANION_ID, companionForDept } from './companions';
import { type DecisionEntry } from './ai/projectModel';
import { scaffoldCompany } from './ai/scaffold';
import { unlockedKeys, type GrowthSignal } from './overview/growth';
import { LoadingScreen } from '../components/LoadingScreen';
import { streamByteChat, summarizeThread, ChatError } from './ai/chat';
import { planThreadSummary } from './ai/threadSummary';
import { resolveNavChip, type NavChip, type NavDest } from './ai/navChip';
import { collectSetupItems, resolveEnvIndex } from './ai/envSetup';
import { type NextStep } from './ai/nextStep';
import { setStageWatermark } from './roadmap';
import { roadmapWatermarkFor, nextStageOf, stageComplete } from './stages';
import { loadSavedRoadmap, generateRoadmap } from './ai/generateRoadmap';
import { ROADMAP_TEMPLATE } from './overview/roadmapTemplate';
import { stageToPhase } from './overview/roadmapProgress';
import { selectRoadmap } from './overview/roadmapSelector';
import type { RoadmapTaskDef } from './overview/roadmapModel';
import {
  appendBrief,
  stepForLive,
  INTAKE_OPENING,
  decideIntakeStep,
  stripBuildTriggers,
  type BuildStep,
} from './buildFlow';
import { requestBuildPlan } from './ai/buildPlan';
import { requestBuildBrainstorm } from './ai/buildBrainstorm';
import type { BrainstormTurn } from './ai/brainstorm';
import {
  buildOpeningPrompt,
  terminalCommand,
  demoTerminalCommand,
  tokenReportSuffix,
  DEMO_DIR,
} from './armSession';
import { armBuildSession, scaffoldDemoProject } from '@/app/actions/build';
import { createCheckpoint, rewindToCheckpoint } from '@/app/actions/checkpoint';
import { getCapability, getStatus } from '@/app/actions/install';
import { shouldPromptInstall, INSTALL_PROMPTED_KEY } from './installPrompt';
import { ACTIVE_BUILD_KEY, serializeActiveBuild, parseActiveBuild } from './buildPersist';
import type { BytePlan } from './ai/plan';
import type { LiveState } from './liveBuild';

/** One byte-chat message in the UI. 'me' = the founder, 'byte' = the companion. */
export interface ChatMessage {
  id: string;
  role: 'me' | 'byte';
  text: string;
  ts: number;
  /** Which pet spoke this turn — stamped at creation so a past reply keeps its voice's face
   *  even after the founder navigates elsewhere. Absent on older/system turns → the renderer
   *  falls back to the task's department pet (for deliverables) or the current focus pet. */
  companionId?: string;
  /** An optional one-tap action byte offers in-chat (e.g. "Start: <task>").
   * `inline: true` ⇒ produce the deliverable in-thread (runTaskInChat) instead of
   * opening the department run modal (runBriefedTask). */
  action?: { label: string; deptK: string; taskTitle: string; inline?: boolean; done?: boolean };
  /** A one-tap "take me there" chip byte offers when the founder asks where an app
   * function is. Tapping it navigates (never auto-navigates). */
  nav?: NavChip;
  /** Transient arrival briefing (not persisted; only the latest is kept in the thread). */
  brief?: boolean;
  /** byte is producing a deliverable for this message right now (inline run). */
  running?: boolean;
  /** An inline deliverable byte produced in chat, awaiting approval (reads the live task). */
  result?: { deptK: string; taskTitle: string; type: string; approved?: boolean };
  /** A "stage complete — advance?" prompt: the rung the founder can move up to. */
  advance?: { toStage: string };
  /** A build plan Byte generated in chat — rendered as a plan card + "Start building". */
  buildPlan?: BytePlan;
  /** A build-flow button Byte offers in chat (turn intake into a plan, or start the session). */
  buildAction?: { kind: 'begin-intake' | 'to-plan' | 'start-building'; label: string };
  /** A one-tap "turn this on" card byte offers for an off toolkit item (reads live ENV). */
  setup?: { category: string; name: string };
  /** A first-run enrichment question (goal / traction / problem). While `answered` is
   * falsy, the chat renders an answer input + Skip; once answered/skipped it's a plain
   * past question. See lib/ai/enrichInterview. */
  interview?: { gap: Gap; answered?: boolean };
  /** Assisted founder task: a generated how-to + optional capture form for a "needs your input"
   * task. Rendered as a rich card; submitting the capture writes decisions + marks it done. */
  help?: { deptK: string; taskTitle: string; nodeId?: string; data: TaskHelp; captured?: boolean };
  /** A one-time, subtle nudge to add your own Anthropic key (Add my key / Not now). Transient —
   * never persisted — and shown at most once per account (see maybeNudgeByok). */
  byokNudge?: boolean;
  /** The execute-log steps for this run — streamed live in the card, then kept as the
   * "What byte did" record. Generated once (buildLog) when the run starts. */
  steps?: LogStep[];
  /** A "Noted" chip: a durable fact/decision byte captured from the founder's last message
   * into company memory, with an undo. `undone` strikes it once the founder undoes. */
  noted?: { topic: string; statement: string; undone?: boolean };
  /** byte's reply failed (network / model / auth). Renders the fallback text + a Retry
   * that re-runs the turn. Cleared when a retry succeeds. */
  error?: boolean;
}

const newId = (): string =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Strip the one-shot build TRIGGER buttons ("Turn this into a plan", "Let's build it")
// from past messages, so the thread never accumulates a trail of live buttons a stray
// tap could re-fire. See isTransientBuildTrigger for which kinds are consumed.
const stripBuildButtons = (msgs: ChatMessage[]): ChatMessage[] => stripBuildTriggers(msgs);
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
  | 'dept'
  | 'tasks'
  | 'library'
  | 'env'
  | 'settings'
  | 'billing'
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
  /** Guide the founder to an app function from byte's chat "take me there" chip. */
  navigateTo: (dest: NavDest, target?: string) => void;
  selStage: number;
  drawerOpen: boolean;
  selectStage: (n: number) => void;
  closeStage: () => void;
  copilotCollapsed: boolean;
  toggleCopilot: (collapsed?: boolean) => void;
  onboarding: boolean;
  finishOnboarding: (brief?: CompanyBrief) => void;
  /** Reopen the onboarding wizard (e.g. to add a brief after skipping). */
  openOnboarding: () => void;
  /** Run the real scaffold during onboarding's analysis step; returns the reveal summary. */
  scaffoldFromOnboarding: (brief: CompanyBrief) => Promise<RevealSummary>;
  /** Re-generate the stage-aware company for the current account (manual re-plan). */
  regenerateCompany: () => void;
  /** True while a manual re-plan is in flight — guards the "Re-plan" button against
   *  being mashed (e.g. during an outage) so it can't fire overlapping scaffolds. */
  regenerating: boolean;
  /** The most recent graph-growth event (branches that unlocked on a re-scaffold), or null. */
  growthSignal: GrowthSignal | null;
  /** Consume the current growth signal (clears it) so the unlock reveal can't replay
   * on a later Overview remount. */
  clearGrowthSignal: () => void;
  /** True once the map reflects a plan byte generated from this founder's product; false
   *  while it's still the built-in example seed. */
  planTailored: boolean;
  /** Set when a scaffold attempt this session couldn't complete, to the failure cause
   *  (e.g. 'refused', 'rate_limited', 'network'); null when nothing failed, so the
   *  example-plan banner can name the actual cause rather than just "not generated yet". */
  scaffoldFailure: string | null;
  /** byte's model availability — the failure code ('ai_unavailable' = out of credits,
   *  'rate_limited' = daily cap) when a chat/run last failed that way, else null. Drives the
   *  hub's single honest "byte is offline" banner. */
  aiOffline: { code: string; at: number } | null;
  /** Advance to the next product stage (confirmed): move the map + re-plan the company. */
  advanceStage: () => void;
  brief: CompanyBrief;
  /** byte's one-time project analysis; null until generated. */
  projectAnalysis: ProjectAnalysis | null;
  /** True while the one-time analysis call is in flight (drives the intro placeholder). */
  analysisLoading: boolean;
  /** Idempotent: generate + persist the analysis once if missing. No-op otherwise. */
  ensureProjectAnalysis: () => void;
  /** Durable decisions byte maintains about the company — the founder-curatable memory. */
  decisions: DecisionEntry[];
  /** Edit a decision in place (e.g. correct a wrong extraction). */
  updateDecision: (index: number, patch: Partial<DecisionEntry>) => void;
  /** Remove a decision byte is holding. */
  deleteDecision: (index: number) => void;
  installed: boolean;
  setInstalled: (value: boolean) => void;
  /** The default companion mark shown in the app chrome (byte). Voice is per-department
   *  (see lib/companions companionForDept); there is no global companion pick. */
  companionId: string;
  /** The pet that voices AND fronts the Copilot right now: the department in focus
   *  (viewed dept → CURRENT NEXT STEP's dept → byte). Drives the chat avatar + name. */
  focusCompanionId: string;
  /** Whether this account has seen the Overview first-run intro. */
  introSeen: boolean;
  /** Mark the first-run intro seen for this account (idempotent; persists). */
  markIntroSeen: () => void;
  /** The one-time "wake byte up" install popup (auto-opens once; the Topbar pill
   * and Settings reopen it). */
  installPromptOpen: boolean;
  openInstallPrompt: () => void;
  closeInstallPrompt: () => void;
  library: LibItem[];
  /** Second Brain event ledger, newest-first (P0/P1). */
  events: LedgerEvent[];
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
  /** Act on a roadmap cell by its state: run/review it inline in chat when byte can, guide the
   *  founder when it's theirs, explain what's blocking a locked step, or open a finished one. */
  guideRoadmapTask: (input: {
    deptK: string;
    title: string;
    state: string;
    blockedBy?: string;
    nodeId?: string;
    actor?: string;
  }) => void;
  /** Mark a founder-owned task done from an in-chat chip (the "tell me when it's done" path):
   *  flips the roadmap node to Done, unlocks its dependents, and offers stage-advance. */
  markTaskDone: (deptK: string, taskTitle: string) => void;
  /** Open assisted help for a founder-owned task: post a generated how-to + capture form in chat
   *  (falls back to a plain "this one's yours" brief when the guide can't be fetched). */
  openTaskHelp: (deptK: string, title: string, nodeId?: string, actor?: string) => void;
  /** Save a founder task's captured outputs into company memory (decisions) and mark it done. */
  captureTaskInput: (
    deptK: string,
    taskTitle: string,
    values: { key: string; label: string; value: string }[],
  ) => void;
  /** Dismiss the one-time BYOK nudge card by message id. */
  dismissByokNudge: (msgId: string) => void;
  /** Run a task named by an in-chat action chip (deptK + taskTitle). */
  runBriefedTask: (deptK: string, taskTitle: string) => void;
  viewItem: (item: LibItem) => void;
  closeModal: () => void;
  /** A deliverable opened into the "Your company" section (in-context, not a modal). */
  /** Open a delivered artifact externally: a site in a new tab, everything else copied. */
  openDeliverable: (item: LibItem) => void;
  approveTask: (task: Task, dept: Dept, type: string) => { item: LibItem; next?: Task };
  toggleEnv: (category: string, index: number) => void;
  setupCapability: (category: string, name: string) => void;
  /** Credit the on-items that fit a produced task's type (deduped) + persist. */
  creditToolkitUse: (taskTitle: string, type: string) => void;
  chatMessages: ChatMessage[];
  chatStreaming: boolean;
  sendChat: (text: string) => void;
  /** All conversation threads (history entries) for the "chat history" panel. */
  threads: ThreadMeta[];
  /** The thread whose messages are currently in `chatMessages`, or null before one exists. */
  activeThreadId: string | null;
  /** Whether the chat-history list is open. */
  chatHistoryOpen: boolean;
  /** Start a fresh thread — clears the active chat; the thread itself is created in
   * Firestore lazily, on the first message sent into it. */
  newChat: () => void;
  /** Switch the active thread and hydrate its messages. */
  openThread: (id: string) => void;
  /** Rename a thread (optimistic + persisted). */
  renameThread: (id: string, title: string) => void;
  /** Delete a thread and its messages; falls back to another thread or a new chat. */
  deleteThread: (id: string) => void;
  /** Delete every thread and its messages, then drop into a fresh empty chat. */
  clearAllChats: () => void;
  /** Open/close the chat-history list. */
  toggleChatHistory: (open?: boolean) => void;
  /** Re-run a byte reply that failed — re-streams into the same bubble against the same
   * history, so the founder doesn't have to retype. */
  retryChat: (byteMsgId: string) => void;
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
  /** Answer (or skip, with null) a first-run enrichment question. byte distills + persists
   * a real answer into the brief, then the interview advances to the next gap or hands off
   * to the "best first move" greeting. */
  answerInterview: (msgId: string, gap: Gap, answer: string | null) => void;
  /** Undo a "Noted" chip: strike it in the thread and forget that fact from company memory. */
  undoNoted: (msgId: string, topic: string) => void;
  /** Mark a task as awaiting the founder's approval and persist so it survives reload. */
  persistTaskDraft: (deptK: string, taskTitle: string) => void;
  /** byte's single next step — the one value the beacon AND chat both read. */
  nextStep: NextStep | null;
  /** byte's per-company roadmap (generated once, else null → consumers use the template). Owned
   *  here so the beacon, chat, and nudge derive "what's next" from the same source. */
  roadmapDefs: RoadmapTaskDef[] | null;
  toastMsg: string;
  toast: (msg: string) => void;
  /** "Let's build" flow — lifted from BuildCoachView so the chat panel drives START
   * and the main view renders DURING/END from one shared source. */
  buildStep: BuildStep;
  buildProject: string;
  setBuildProject: (v: string) => void;
  demoLetsBuild: boolean;
  setDemoLetsBuild: (v: boolean) => void;
  buildBrief: string;
  buildPlan: BytePlan | null;
  /** Edit the generated plan's steps in place before arming (founder can refine intent). */
  setBuildPlanSteps: (steps: string[]) => void;
  /** A git snapshot taken before a local build; null when the project isn't a git repo. */
  buildCheckpoint: { ref: string } | null;
  /** Undo everything the build changed, restoring the project to the pre-build snapshot. */
  rewindBuild: () => void;
  /** Advance a local in-UI build to the recap (there's no live-doc feed to flip it). */
  endBuild: () => void;
  /** How hands-on the founder wants to be during the build. */
  buildAutonomy: 'suggest' | 'copilot' | 'autopilot';
  setBuildAutonomy: (m: 'suggest' | 'copilot' | 'autopilot') => void;
  buildSessionId: string | null;
  buildLive: LiveState | null;
  buildLocal: boolean;
  buildLaunchCommand: string | null;
  buildProjectDir: string;
  buildArming: boolean;
  buildIntakeActive: boolean;
  /** True when this build was restored after a reload — the live view re-attaches
   *  to the running session instead of spawning a new one. */
  buildResumed: boolean;
  /** Local in-UI builds fold their own transcript into the meter (there's no
   *  hook→Firestore feed for them); the live view reports each reading here. */
  applyLocalLive: (s: LiveState) => void;
  startBuildIntake: () => void;
  /** Leave intake without building — the composer goes back to normal chat. */
  cancelBuildIntake: () => void;
  addIntakeTurn: (text: string) => void;
  generateBuildPlan: () => void;
  armBuild: () => void;
  resetBuildFlow: () => void;
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

  // Land on the Overview (the company map) by default.
  const [view, setView] = useState<View>('overview');
  const [deptKey, setDeptKey] = useState<string | null>(null);
  const [selStage, setSelStage] = useState(6);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Bumped whenever something requests the map to fly to a department (the portal).
  const [portalSignal, setPortalSignal] = useState<{ deptK: string; n: number } | null>(null);
  // Chat starts closed by default; the floating button opens it on demand.
  const [copilotCollapsed, setCopilotCollapsed] = useState(true);
  // Onboarding is shown only to users who haven't completed it. It starts false
  // and is flipped true after hydration iff the company has no `onboardedAt`
  // stamp — so returning users go straight to the app.
  const [onboarding, setOnboarding] = useState(false);
  const [installed, setInstalled] = useState(false);
  // Voice is per-department now (see lib/companions companionForDept); there is no global
  // companion pick. The chrome shows byte as the neutral default mark, so this is pinned.
  const companionId = DEFAULT_COMPANION_ID;
  // Whether THIS account has seen the Overview first-run intro (hydrated from
  // Firestore; drives introInitialPhase). Default false ⇒ a fresh account sees it.
  const [introSeen, setIntroSeen] = useState(false);
  // Mirror of introSeen for a stale-closure-free idempotency check in markIntroSeen.
  const introSeenRef = useRef(false);
  // Most recent graph-growth event (branches unlocked by a re-scaffold), or null.
  const [growthSignal, setGrowthSignal] = useState<GrowthSignal | null>(null);
  // Consume-once: the Overview clears the signal after easing the camera, so a later
  // remount (growthSignal already null) can never replay the unlock reveal.
  const clearGrowthSignal = useCallback(() => setGrowthSignal(null), []);
  // The one-time "wake byte up" popup — auto-opened by the effect next to
  // setInstalledFlag below; reopened any time via the Topbar pill or Settings.
  const [installPromptOpen, setInstallPromptOpen] = useState(false);

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
  // Also abort any in-flight chat stream on unmount, so a sign-out mid-reply doesn't leave
  // the request running or persist a byte message against the previous account.
  useEffect(
    () => () => {
      chatAbort.current?.abort();
      resetCompanyData();
    },
    [],
  );

  const [modal, setModal] = useState<Modal>(null);
  const [toastMsg, setToastMsg] = useState('');

  // Library + business brief are owned here as state, hydrated from Firestore.
  const [library, setLibrary] = useState<LibItem[]>([]);
  const [events, setEvents] = useState<LedgerEvent[]>([]);
  const [tracking, setTracking] = useState<TrackingSummary>(EMPTY_TRACKING);
  const [projects, setProjects] = useState<string[]>([]);
  const [brief, setBrief] = useState<CompanyBrief>({});
  // byte's one-time project analysis (hydrated from Firestore; null until generated).
  const [projectAnalysis, setProjectAnalysis] = useState<ProjectAnalysis | null>(null);
  // True while the one-time analysis call is in flight (drives the intro placeholder).
  const [analysisLoading, setAnalysisLoading] = useState(false);
  // Guards ensureProjectAnalysis against duplicate concurrent calls (not itself reactive state).
  const analysisInFlight = useRef(false);
  // Durable decisions byte maintains (hydrated from Firestore; founder-curatable).
  const [decisions, setDecisions] = useState<DecisionEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);
  // byte's per-company roadmap (generated once, else the canonical template). Owned here so the
  // beacon, the chat's next-step, and the after-completion nudge all derive "what's next" from the
  // SAME roadmap — one source of truth, no drift.
  const [roadmapDefs, setRoadmapDefs] = useState<RoadmapTaskDef[] | null>(null);

  // byte chat: messages (hydrated from Firestore) + a streaming guard.
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatStreaming, setChatStreaming] = useState(false);
  // Threads (history entries), the active one, and the history panel's open state.
  const [threads, setThreads] = useState<ThreadMeta[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [chatHistoryOpen, setChatHistoryOpen] = useState(false);
  const pendingThreadRef = useRef(false); // true ⇒ active thread not yet written to Firestore

  // Every persisted chat message carries the active thread id. Route all persistence
  // through here so no call site forgets it.
  const persistMsg = useCallback(
    (msg: { id: string; role: 'me' | 'byte'; text: string; ts: number }) => {
      if (!companyId || !activeThreadId) return;
      persistChatMessage(companyId, {
        id: msg.id,
        role: msg.role,
        text: msg.text,
        createdAt: msg.ts,
        threadId: activeThreadId,
      }).catch((err) => console.error('[store] persist message failed', err));
      // Keep the in-memory thread list fresh so History re-sorts / shows fresh
      // relative time without a reload. Harmless no-op for a brand-new thread not
      // yet in `threads` — the map simply matches nothing until sendChat adds it.
      setThreads((prev) =>
        prev.map((t) => (t.id === activeThreadId ? { ...t, updatedAt: msg.ts } : t)),
      );
    },
    [companyId, activeThreadId],
  );
  // Aborts the in-flight chat stream — on a new send, a retry, or provider unmount
  // (e.g. sign-out), so a stream never keeps running or writes against a stale account.
  const chatAbort = useRef<AbortController | null>(null);

  // "Let's build" flow (was BuildCoachView local state; lifted here so the chat
  // panel drives START and the main view renders DURING/END from one source).
  // An active build survives a page reload: its snapshot is read back synchronously
  // here (same company only — AppProvider mounts post-auth, so companyId is known)
  // and seeds the state below; the live view then re-attaches via `resume`. The
  // mirror effect further down keeps the snapshot current.
  const [restoredBuild] = useState(() => {
    try {
      return companyId ? parseActiveBuild(localStorage.getItem(ACTIVE_BUILD_KEY), companyId) : null;
    } catch {
      return null; // SSR / storage unavailable — start fresh
    }
  });
  const [buildStep, setBuildStep] = useState<BuildStep>(restoredBuild?.step ?? 'during');
  const [buildProject, setBuildProject] = useState(restoredBuild?.project ?? '');
  const [demoLetsBuild, setDemoLetsBuildState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem('codepet:demoLetsBuild') !== '0'; // default ON
  });
  const setDemoLetsBuild = useCallback((v: boolean) => {
    setDemoLetsBuildState(v);
    if (typeof window !== 'undefined')
      window.localStorage.setItem('codepet:demoLetsBuild', v ? '1' : '0');
  }, []);
  const [buildBrief, setBuildBrief] = useState(restoredBuild?.brief ?? '');
  const [buildPlan, setBuildPlanState] = useState<BytePlan | null>(restoredBuild?.plan ?? null);
  const [buildSessionId, setBuildSessionId] = useState<string | null>(
    restoredBuild?.buildSessionId ?? null,
  );
  const [buildLive, setBuildLive] = useState<LiveState | null>(restoredBuild?.live ?? null);
  const [buildLocal, setBuildLocal] = useState(restoredBuild?.local ?? false);
  const [buildLaunchCommand, setBuildLaunchCommand] = useState<string | null>(
    restoredBuild?.launchCommand ?? null,
  );
  const [buildProjectDir, setBuildProjectDir] = useState(restoredBuild?.projectDir ?? '');
  const [buildArming, setBuildArming] = useState(false);
  const [buildIntakeActive, setBuildIntakeActive] = useState(false);
  // The running brainstorm transcript (Byte questions + founder answers) that
  // /api/build-brainstorm reasons over. In-memory only, like buildBrief — an
  // interrupted intake just falls back to typing more.
  const [buildIntakeLog, setBuildIntakeLog] = useState<BrainstormTurn[]>([]);
  const [buildResumed, setBuildResumed] = useState(!!restoredBuild);
  // A git snapshot of the project taken right before a local build, so the founder can
  // rewind everything the build changed. null when the project isn't a git repo.
  const [buildCheckpoint, setBuildCheckpoint] = useState<{ ref: string } | null>(
    restoredBuild?.checkpoint ?? null,
  );
  // How hands-on the founder wants to be — passed to the live session (permission mode
  // + the bridge's auto-approval). Defaults to the most conservative.
  const [buildAutonomy, setBuildAutonomy] = useState<'suggest' | 'copilot' | 'autopilot'>(
    restoredBuild?.autonomy ?? 'suggest',
  );
  // Guards the one-time "session ended" nudge so the live subscription posts it once.
  const buildEndedNudged = useRef(false);

  // Subscribe to the live build doc once a session is armed — remote/terminal builds
  // only. Local in-UI builds fold their own transcript into buildLive (applyLocalLive);
  // subscribing there would clobber it with the doc's null snapshot. Updating state
  // from the subscription is intended; when the rollup marks the doc ended we flip to
  // END and post one closing nudge in chat.
  useEffect(() => {
    if (!companyId || !buildSessionId || buildLocal) return;
    return subscribeLiveBuild(companyId, buildSessionId, (s) => {
      setBuildLive(s);
      setBuildStep(stepForLive(s));
      if (s?.ended && !buildEndedNudged.current) {
        buildEndedNudged.current = true;
        const nudge: ChatMessage = {
          id: newId(),
          role: 'byte',
          text: "Nice — your session wrapped up! Pop over to the recap and let's write down what we learned. 📒",
          ts: Date.now(),
        };
        setChatMessages((prev) => [...prev, nudge]);
        persistMsg({ id: nudge.id, role: 'byte', text: nudge.text, ts: nudge.ts });
      }
    });
  }, [companyId, buildSessionId, buildLocal, persistMsg]);

  // Mirror the active build to localStorage on every change (and clear it when the
  // flow resets), so the restore above always sees the latest step/checkpoint/meter.
  useEffect(() => {
    if (!companyId) return;
    try {
      if (!buildSessionId || !buildPlan) {
        localStorage.removeItem(ACTIVE_BUILD_KEY);
        return;
      }
      localStorage.setItem(
        ACTIVE_BUILD_KEY,
        serializeActiveBuild({
          companyId,
          buildSessionId,
          step: buildStep,
          project: buildProject,
          projectDir: buildProjectDir,
          brief: buildBrief,
          plan: buildPlan,
          autonomy: buildAutonomy,
          local: buildLocal,
          launchCommand: buildLaunchCommand,
          checkpoint: buildCheckpoint,
          live: buildLive,
        }),
      );
    } catch {
      /* storage full/unavailable — the build just won't survive a reload */
    }
  }, [
    companyId,
    buildSessionId,
    buildStep,
    buildProject,
    buildProjectDir,
    buildBrief,
    buildPlan,
    buildAutonomy,
    buildLocal,
    buildLaunchCommand,
    buildCheckpoint,
    buildLive,
  ]);

  // byte's single next step — the one value the beacon AND chat read, so they can
  // never disagree. Set instantly to the authored golden path (so nothing is ever
  // blank), then swapped to byte's own pick when /api/next-step resolves. Recomputed
  // on hydrate and after every approval. On failure the authored fallback stands.
  const [nextStep, setNextStep] = useState<NextStep | null>(null);
  // byte's model availability, so the hub can show ONE honest "offline" state up front instead
  // of per-message "temporarily unavailable" confusion. Set to the failure code (e.g.
  // 'ai_unavailable' = out of credits, 'rate_limited' = daily cap) when a chat/run call fails
  // that way; cleared the moment any AI call succeeds again.
  const [aiOffline, setAiOffline] = useState<{ code: string; at: number } | null>(null);
  // Whether the map reflects a plan byte generated from THIS founder's product, vs. the
  // built-in example seed. Set from the persisted `scaffoldedAt` on hydrate, flipped true
  // the moment a scaffold succeeds. `scaffoldFailure` carries *why* a scaffold attempt
  // this session couldn't complete (e.g. the model was unreachable) rather than just
  // "not generated yet", so the example-plan banner can be honest about which it is.
  const [planTailored, setPlanTailored] = useState(false);
  const [scaffoldFailure, setScaffoldFailure] = useState<string | null>(null);
  // Guards regenerateCompany against being mashed — the button disables while true.
  // Cleared on both success and failure (.finally), never left stuck on.
  const [regenerating, setRegenerating] = useState(false);
  const regenInFlightRef = useRef(false);
  // The roadmap's own next move, derived live from the current roadmap + department state — THE
  // one source of "what's next" so the beacon (via nextStep), the chat, and the after-completion
  // nudge never disagree. Reads live DEPTS, so it's correct the instant after a task completes.
  const computeRoadmapNext = useCallback(() => {
    const defs = roadmapDefs ?? ROADMAP_TEMPLATE;
    // Same selector the Overview beacon renders from → chat, greeting, and nudge can't disagree.
    return selectRoadmap(defs, stageToPhase(brief.stage), DEPTS).move;
  }, [roadmapDefs, brief.stage]);
  const computeNextStep = useCallback(() => {
    const move = computeRoadmapNext();
    setNextStep(move ? { deptK: move.deptK, taskTitle: move.title, why: '' } : null);
  }, [computeRoadmapNext]);

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
      .then(
        ({
          library: lib,
          brief: b,
          onboardedAt,
          scaffoldedAt,
          roadmapStage,
          chat,
          threads: loadedThreads,
          activeThreadId: loadedActive,
          decisions: dec,
          projectAnalysis: pa,
          introSeenAt,
          events: loadedEvents,
        }) => {
          if (cancelled) return;
          setLibrary(lib);
          setBrief(normalizeBrief(b)); // clean the persisted brief once, at the store boundary
          setDecisions(dec);
          setEvents(loadedEvents ?? []);
          setIntroSeen(Boolean(introSeenAt));
          introSeenRef.current = Boolean(introSeenAt);
          // Reset (or hydrate) the one-time analysis for this account — an overwrite either
          // way, so a fresh account never inherits a previous account's in-flight/loading state.
          // Re-validate the persisted doc so a partial/corrupt one can't render blank rows.
          setProjectAnalysis(isUsableAnalysis(pa) ? pa : null);
          setAnalysisLoading(false);
          analysisInFlight.current = false;
          // A stamped scaffold ⇒ the map is this founder's generated plan; absent ⇒ it's
          // still the example seed (banner shows).
          setPlanTailored(Boolean(scaffoldedAt));
          setStageWatermark(roadmapWatermarkFor(b.stage)); // position the roadmap at their stage
          setChatMessages(
            chat.map((m) => ({ id: m.id, role: m.role, text: m.text, ts: m.createdAt })),
          );
          setThreads(loadedThreads);
          if (loadedActive) {
            setActiveThreadId(loadedActive);
            // Defensive: a stale `true` (e.g. if hydration ever re-runs) must never
            // clobber this real, already-persisted thread.
            pendingThreadRef.current = false;
          } else {
            // Fresh company with no threads yet: start a PENDING thread so the
            // founder's first message creates + persists it (mirrors newChat,
            // without a UI click). Without this, the first conversation is never
            // written to Firestore.
            setActiveThreadId(newId());
            pendingThreadRef.current = true;
          }
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
        },
      )
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

  // Load byte's per-company roadmap once, after hydration: use the saved one if present; else
  // generate a fresh one — unless the founder already has progress (a mismatched fresh plan would
  // orphan it), in which case keep the template, a stable constant.
  useEffect(() => {
    if (!hydrated) return;
    let live = true;
    loadSavedRoadmap().then((saved) => {
      if (!live) return;
      if (saved) {
        setRoadmapDefs(saved);
        return;
      }
      const hasProgress = DEPTS.some((d) => d.tasks.some((t) => t.roadmapNodeId));
      if (hasProgress) return;
      generateRoadmap().then((fresh) => {
        if (live && fresh) setRoadmapDefs(fresh);
      });
    });
    return () => {
      live = false;
    };
  }, [hydrated]);

  const show = useCallback((v: View) => {
    setView(v);
  }, []);
  const openDept = useCallback((k: string) => {
    setDeptKey(k);
    setView('dept');
  }, []);
  // Guide the founder to a part of the app when they tap byte's "take me there" chip.
  // Maps a resolved NavChip destination to the matching view/action.
  const navigateTo = useCallback((dest: NavDest, target?: string) => {
    switch (dest) {
      case 'roadmap':
        setView('overview'); // Roadmap retired — the Overview carries the journey now
        break;
      case 'tasks':
        setView('tasks');
        break;
      case 'library':
        setView('library');
        break;
      case 'company':
        setView('home');
        break;
      case 'environment':
        setView('env');
        break;
      case 'department':
        if (target) {
          setDeptKey(target);
          setView('dept');
        } else {
          setView('home');
        }
        break;
    }
    track('chat.navigate', { dest });
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
  const markIntroSeen = useCallback(() => {
    if (introSeenRef.current) return; // already seen — no state churn, no write
    introSeenRef.current = true;
    setIntroSeen(true);
    if (companyId) {
      persistIntroSeen(companyId).catch((err) =>
        console.error('[store] persistIntroSeen failed', err),
      );
    }
  }, [companyId]);
  const toggleCopilot = useCallback((collapsed?: boolean) => {
    setCopilotCollapsed((c) => (collapsed === undefined ? !c : collapsed));
  }, []);

  // The "best first move" hand-off: byte's landing greeting with the single best first
  // move as a one-tap INLINE action (produces the deliverable in-thread). Seeds immediately
  // from the authored fallback, then upgrades to byte's own pick when /api/next-step
  // resolves — the greeting message updates in place (stable id). Runs AFTER the first-run
  // enrichment interview, or immediately when the brief already has every plan-shaping field.
  const seedBestFirstMove = useCallback(
    (briefData: CompanyBrief) => {
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
      // The first move comes from the roadmap itself, so the greeting's "Do it with me" points at
      // the same next step the beacon shows (one source of truth for "what's next").
      const move = computeRoadmapNext();
      const next: NextStep | null = move
        ? { deptK: move.deptK, taskTitle: move.title, why: '' }
        : null;
      setNextStep(next);
      seed(next);
    },
    [computeRoadmapNext],
  );

  // Progress of the first-run enrichment interview: the empty gaps to ask, which one we're
  // on, and the brief accumulating byte's distilled answers. Null when no interview is active.
  const interviewRef = useRef<{ gaps: Gap[]; idx: number; brief: CompanyBrief } | null>(null);

  const askInterviewGap = useCallback((gap: Gap) => {
    setChatMessages((prev) => [
      ...prev,
      {
        id: newId(),
        role: 'byte',
        text: QUESTION_FOR[gap].ask,
        ts: Date.now(),
        interview: { gap },
      },
    ]);
  }, []);

  // First-run only: byte opens chat and — before offering the best first move — asks the
  // ≤3 plan-shaping questions the onboarding brief is missing (goal / traction / problem).
  // A full brief skips straight to the hand-off, so nothing changes for returning founders.
  const greetFirstRun = useCallback(
    (briefData: CompanyBrief) => {
      toggleCopilot(false); // open the chat panel so the greeting is seen
      const gaps = detectGaps(briefData);
      if (gaps.length === 0) {
        seedBestFirstMove(briefData);
        return;
      }
      interviewRef.current = { gaps, idx: 0, brief: briefData };
      const who = briefData.founderName?.trim();
      const proj = cleanCompanyName(briefData.projectName) ?? 'your product';
      const lead =
        `${who ? `${who}, your` : 'Your'} company for ${proj} is ready. ` +
        `A couple quick questions first, so I plan the right moves — not generic ones.`;
      setChatMessages((prev) => [
        ...prev,
        { id: newId(), role: 'byte', text: lead, ts: Date.now() },
      ]);
      track('firstrun.interview_started', { gaps: gaps.length });
      askInterviewGap(gaps[0]);
    },
    [toggleCopilot, seedBestFirstMove, askInterviewGap],
  );

  const answerInterview = useCallback(
    (msgId: string, gap: Gap, answer: string | null) => {
      // Retire this question's input/Skip affordance immediately.
      setChatMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, interview: { gap, answered: true } } : m)),
      );
      const st = interviewRef.current;
      // Move to the next gap, or hand off to the best-first-move greeting when done.
      const advance = (brief: CompanyBrief) => {
        const next = (st?.idx ?? 0) + 1;
        if (st && next < st.gaps.length) {
          interviewRef.current = { gaps: st.gaps, idx: next, brief };
          askInterviewGap(st.gaps[next]);
        } else {
          interviewRef.current = null;
          setBrief(normalizeBrief(brief)); // the enriched brief now grounds every run + chat
          seedBestFirstMove(brief);
        }
      };
      const text = answer?.trim();
      if (!text) {
        track('firstrun.interview_skipped', { gap });
        advance(st?.brief ?? {});
        return;
      }
      // Echo the founder's answer, then let byte distill + persist it.
      setChatMessages((prev) => [...prev, { id: newId(), role: 'me', text, ts: Date.now() }]);
      track('firstrun.interview_answered', { gap });
      postEnrichAnswer(gap, text)
        .then((res) => {
          const base = interviewRef.current?.brief ?? st?.brief ?? {};
          const brief = res?.saved && res.value ? { ...base, [gap]: res.value } : base;
          setChatMessages((prev) => [
            ...prev,
            { id: newId(), role: 'byte', text: 'Got it.', ts: Date.now() },
          ]);
          advance(brief);
        })
        .catch(() => advance(interviewRef.current?.brief ?? st?.brief ?? {}));
    },
    [seedBestFirstMove, askInterviewGap],
  );

  // Run the real stage-aware scaffold DURING onboarding (the wizard's "analysis" step),
  // so the founder watches byte build their actual company instead of a fake animation.
  // Marks scaffoldedInWizard so finishOnboarding won't run it a second time. Returns a
  // reveal summary read from the now-live DEPTS (ok=false ⇒ generation failed, seed kept).
  const scaffoldFromOnboarding = useCallback(
    async (briefData: CompanyBrief): Promise<RevealSummary> => {
      scaffoldedInWizard.current = true; // we attempted it here; don't double-run in finish
      if (!companyId) return buildRevealSummary(DEPTS, false);
      const { changed, failure } = await scaffoldCompany(companyId, briefData);
      if (changed > 0) {
        bump();
        setPlanTailored(true); // the map now reflects the founder's generated plan
      } else {
        setScaffoldFailure(failure); // attempted here but produced nothing → example stands, say why
      }
      return buildRevealSummary(DEPTS, changed > 0);
    },
    [companyId, bump],
  );

  const openOnboarding = useCallback(() => setOnboarding(true), []);

  const finishOnboarding = useCallback(
    (briefData?: CompanyBrief) => {
      setOnboarding(false);
      if (briefData) {
        setBrief(normalizeBrief(briefData));
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
            return scaffoldCompany(companyId, briefData).then(({ changed, failure }) => {
              if (changed) {
                bump();
                setPlanTailored(true);
              } else {
                setScaffoldFailure(failure);
              }
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
    if (regenInFlightRef.current || !companyId) return;
    regenInFlightRef.current = true;
    setRegenerating(true);
    toast('Re-planning your company for your stage…');
    const beforeLater = new Set(DEPTS.filter((d) => d.later).map((d) => d.k));
    scaffoldCompany(companyId, brief)
      .then(({ changed, failure }) => {
        if (changed) {
          bump();
          computeNextStep();
          setPlanTailored(true); // real plan landed — the example banner clears
          setScaffoldFailure(null);
          toast('Company re-planned for your stage');
          const unlocked = unlockedKeys(beforeLater, DEPTS);
          if (unlocked.length) setGrowthSignal({ unlockedKeys: unlocked, ts: Date.now() });
        } else {
          setScaffoldFailure(failure); // couldn't generate → the example still stands, say why
          toast('Couldn’t re-plan just now — try again');
        }
      })
      .finally(() => {
        regenInFlightRef.current = false;
        setRegenerating(false);
      });
  }, [companyId, brief, bump, toast, computeNextStep]);

  // byte's one-time, brief-grounded read of the project (the Overview intro). Idempotent:
  // skips if already generated, a call is already in flight, or there's no company/brief
  // to analyze yet. Best-effort — a failure just leaves it null (the fallback intro).
  const ensureProjectAnalysis = useCallback(() => {
    if (projectAnalysis || analysisInFlight.current || !companyId) return;
    const hasBrief = brief && Object.keys(brief).length > 0;
    if (!hasBrief) return;
    analysisInFlight.current = true;
    setAnalysisLoading(true);
    fetchProjectAnalysis(brief)
      .then((a) => {
        if (a) {
          setProjectAnalysis(a);
          persistProjectAnalysis(companyId, a).catch((err) =>
            console.error('[project-analysis] persist failed', err),
          );
        }
      })
      .finally(() => {
        analysisInFlight.current = false;
        setAnalysisLoading(false);
      });
  }, [projectAnalysis, companyId, brief]);

  // Founder-curated memory: edit or remove a decision byte is holding. Optimistic —
  // the panel reflects the change at once; the Firestore write is best-effort (a failed
  // write just leaves the persisted copy; it re-hydrates on next load). Editing stamps
  // updatedAt so the entry sorts as freshly-touched.
  const updateDecision = useCallback(
    (index: number, patch: Partial<DecisionEntry>) => {
      setDecisions((prev) => {
        if (index < 0 || index >= prev.length) return prev;
        const next = prev.map((d, i) =>
          i === index ? { ...d, ...patch, updatedAt: Date.now() } : d,
        );
        if (companyId) persistDecisions(companyId, next).catch(() => {});
        return next;
      });
    },
    [companyId],
  );
  const deleteDecision = useCallback(
    (index: number) => {
      setDecisions((prev) => {
        if (index < 0 || index >= prev.length) return prev;
        const next = prev.filter((_, i) => i !== index);
        if (companyId) persistDecisions(companyId, next).catch(() => {});
        return next;
      });
    },
    [companyId],
  );
  // Undo a "Noted" chip: strike it in the thread and forget that topic from company memory
  // (local + persisted), so byte stops grounding on something the founder didn't mean to keep.
  const undoNoted = useCallback(
    (msgId: string, topic: string) => {
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.noted ? { ...m, noted: { ...m.noted, undone: true } } : m,
        ),
      );
      const k = topic.trim().toLowerCase();
      setDecisions((prev) => {
        const next = prev.filter((d) => d.topic.trim().toLowerCase() !== k);
        if (companyId) persistDecisions(companyId, next).catch(() => {});
        return next;
      });
    },
    [companyId],
  );

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
    const company = cleanCompanyName(brief.projectName) ?? 'your company';
    const updated = { ...brief, stage: next };
    const noteId = newId();
    setBrief(normalizeBrief(updated));
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
    const beforeLater = new Set(DEPTS.filter((d) => d.later).map((d) => d.k));
    scaffoldCompany(companyId, updated).then(({ changed }) => {
      if (changed) {
        // Re-plan took — now it's safe to persist the new stage.
        persistWithRetry(() => persistBrief(companyId, updated), {
          toast,
          label: 'persistBrief',
          failMessage: 'Couldn’t save your project details — they may not persist.',
        });
        // Ledger: the milestone the company just crossed (keyed by stage name).
        const stageEv = eventFromStageAdvance(next, next, Date.now());
        void appendEvent(companyId, stageEv);
        setEvents((prev) => [stageEv, ...prev.filter((e) => e.refId !== stageEv.refId)]);
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
        const unlocked = unlockedKeys(beforeLater, DEPTS);
        if (unlocked.length) setGrowthSignal({ unlockedKeys: unlocked, ts: Date.now() });
      } else {
        // Re-plan failed and nothing was persisted — roll the stage back so the founder
        // stays consistent (current stage + current tasks), and offer a retry.
        setBrief(normalizeBrief(prevBrief));
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
  }, [brief, companyId, bump, computeNextStep, toast]);
  const setInstalledFlag = useCallback((value: boolean) => {
    setInstalled(value);
    try {
      if (value) localStorage.setItem('codepet:installed', '1');
      else localStorage.removeItem('codepet:installed');
    } catch {}
  }, []);

  const openInstallPrompt = useCallback(() => setInstallPromptOpen(true), []);
  // Closing the popup — any way — counts as "prompted": it never auto-shows again.
  const closeInstallPrompt = useCallback(() => {
    setInstallPromptOpen(false);
    try {
      localStorage.setItem(INSTALL_PROMPTED_KEY, '1');
    } catch {}
  }, []);

  // Auto-show the install popup ONCE, the first time the app is ready (hydrated,
  // onboarding done) without the toolkit. Before popping, sync against the real
  // machine state: a fresh browser on an already-installed machine just records
  // the fact instead of nagging. A failed status check still offers the popup.
  const installPromptChecked = useRef(false);
  useEffect(() => {
    if (installPromptChecked.current) return;
    let prompted = false;
    try {
      prompted = localStorage.getItem(INSTALL_PROMPTED_KEY) === '1';
    } catch {}
    if (!shouldPromptInstall({ hydrated, onboarding, installed, prompted })) return;
    installPromptChecked.current = true;
    let cancelled = false;
    getStatus()
      .then((s) => {
        if (cancelled) return;
        if (s.some((x) => x.installed)) {
          setInstalledFlag(true);
          try {
            localStorage.setItem(INSTALL_PROMPTED_KEY, '1');
          } catch {}
        } else {
          setInstallPromptOpen(true);
        }
      })
      .catch(() => {
        if (!cancelled) setInstallPromptOpen(true);
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated, onboarding, installed, setInstalledFlag]);

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

  // The spine of the roadmap↔work link: resolve the concrete task a roadmap node realizes —
  // matching an existing one (by the stable node link, else by title) or CREATING it on demand
  // in the department — and stamp the reverse link so the Overview tracks it exactly. Returns the
  // runnable task (its exact title feeds runTaskInChat), or null if the department is unknown.
  const ensureRoadmapTask = useCallback(
    (deptK: string, title: string, nodeId: string, actor?: string): Task | null => {
      const d = DEPTS.find((x) => x.k === deptK);
      if (!d || !nodeId) return null;
      const nm = (s: string) =>
        s
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();
      const existing =
        d.tasks.find((x) => x.roadmapNodeId === nodeId) ||
        d.tasks.find((x) => nm(x.t) === nm(title)) ||
        null;
      if (existing) {
        if (existing.roadmapNodeId !== nodeId) {
          existing.roadmapNodeId = nodeId; // stamp the link so tracking is exact from here on
          bump();
          if (companyId)
            persistDepartmentTasks(companyId, d).catch((err) =>
              console.error('[store] link roadmap task failed', err),
            );
        }
        return existing;
      }
      // Create-on-demand: a real, runnable task so byte can do it in-thread and the node tracks
      // it. No explicit kind — artType defaults it to a runnable deliverable (doc / prep).
      const created: Task = {
        t: title,
        d: '',
        who: actor === 'you' ? 'you' : 'does',
        out: '',
        done: false,
        roadmapNodeId: nodeId,
      };
      d.tasks.push(created);
      d.later = false; // the department now has live work
      bump();
      if (companyId)
        persistDepartmentTasks(companyId, d).catch((err) =>
          console.error('[store] create roadmap task failed', err),
        );
      return created;
    },
    [companyId, bump],
  );

  // Assisted founder tasks: a "needs your input" step gets a generated how-to + a capture form
  // instead of a shrug. Fetched once per node (cached for the session — one AI call per task),
  // posted as the brief. Degrades to a plain "this one's yours" brief + done chip when the guide
  // can't be fetched (offline / limit / bad generation), so it's never a dead-end.
  const taskHelpCache = useRef<Map<string, TaskHelp>>(new Map());
  const openTaskHelp = useCallback(
    async (deptK: string, title: string, nodeId?: string, actor?: string) => {
      const d = DEPTS.find((x) => x.k === deptK) || null;
      const t = nodeId
        ? ensureRoadmapTask(deptK, title, nodeId, actor)
        : d?.tasks.find((x) => x.t === title) || null;
      const doneChip: Partial<ChatMessage> = t
        ? { action: { label: `I've done “${t.t}”`, deptK, taskTitle: t.t, done: true } }
        : {};
      const post = (text: string, extra: Partial<ChatMessage> = {}) => {
        toggleCopilot(false); // open the chat so the guidance is visible
        setChatMessages((prev) => [
          ...prev.filter((m) => !m.brief),
          { id: newId(), role: 'byte', text, ts: Date.now(), brief: true, ...extra },
        ]);
      };
      // When the how-to can't be generated (paused / usage limit / bad generation), say so plainly
      // so it reads as a degraded state — not as if nothing happened — then still let them finish it.
      const staticFallback = () =>
        post(
          `I can't pull up the step-by-step for “${title}” right now — I'm paused for a bit (usage limit or connection). Meanwhile it's yours to do${d?.need ? ` — ${d.need}` : ''}: tap below when it's done and I'll mark it.`,
          doneChip,
        );
      const intro = `Here's how to tackle “${title}”. Tell me what you land on and I'll remember it for later steps.`;

      const cacheKey = nodeId || `${deptK}:${title}`;
      const cached = taskHelpCache.current.get(cacheKey);
      if (cached) {
        post(intro, {
          ...doneChip,
          help: { deptK, taskTitle: t?.t ?? title, nodeId, data: cached },
        });
        return;
      }
      if (aiOffline) {
        staticFallback();
        return;
      }
      post(`Pulling together how to tackle “${title}”…`);
      try {
        const data = await fetchTaskHelp({
          taskTitle: title,
          taskHint: t?.d,
          deptName: d?.name,
          deptKey: deptK,
          brief,
          companionId,
        });
        taskHelpCache.current.set(cacheKey, data);
        setAiOffline(null); // a successful fetch means byte is reachable again
        post(intro, { ...doneChip, help: { deptK, taskTitle: t?.t ?? title, nodeId, data } });
      } catch (err) {
        const code = err instanceof GenerateError ? err.code : '';
        if (code === 'rate_limited' || code === 'http_429' || code === 'ai_unavailable')
          setAiOffline({ code, at: Date.now() });
        staticFallback();
      }
    },
    [ensureRoadmapTask, toggleCopilot, aiOffline, brief, companionId],
  );

  // The roadmap as a control surface: clicking a cell routes by its state into the chat, so the
  // founder either completes the task in-thread or is told exactly what's blocking it — never a
  // dead-end. A shipped task opens where it lives; a locked one points at its prerequisite.
  const guideRoadmapTask = useCallback(
    (input: {
      deptK: string;
      title: string;
      state: string;
      blockedBy?: string;
      nodeId?: string;
      actor?: string;
    }) => {
      const { deptK, title, state, blockedBy, nodeId, actor } = input;
      const nm = (s: string) =>
        s
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();
      const d = DEPTS.find((x) => x.k === deptK) || null;
      // Match the scaffolded task loosely (normalized title) so byte can run it in-thread even
      // when the roadmap's canonical wording differs slightly from the department's.
      const realT = d?.tasks.find((x) => nm(x.t) === nm(title)) || null;
      const dn = d?.name ?? 'its department';
      const brief = (text: string, extra: Partial<ChatMessage> = {}) => {
        toggleCopilot(false); // open the chat so the guidance / run is visible
        setChatMessages((prev) => [
          ...prev.filter((m) => !m.brief),
          { id: newId(), role: 'byte', text, ts: Date.now(), brief: true, ...extra },
        ]);
      };

      switch (state) {
        case 'done': {
          // Open the finished deliverable to view/reopen — the runtime item if it's still in
          // memory, else the saved one from the library (matched by dept + title). Fall back to
          // the department when there's no artifact (e.g. a founder task the founder marked done).
          const dt =
            (nodeId ? d?.tasks.find((x) => x.roadmapNodeId === nodeId) : undefined) ||
            d?.tasks.find((x) => nm(x.t) === nm(title)) ||
            null;
          const item =
            dt?._item ||
            (dt && library.find((li) => li.k === deptK && nm(li.title) === nm(dt.t))) ||
            library.find((li) => li.k === deptK && nm(li.title) === nm(title));
          if (item) viewItem(item);
          else openDept(deptK);
          return;
        }
        case 'locked': {
          const prereq = blockedBy && d?.tasks.find((x) => nm(x.t) === nm(blockedBy));
          // If the prerequisite is already drafted (just not approved yet), point to
          // that draft to review/approve — NOT "Start", which would re-run and
          // duplicate it.
          const prereqDrafted = !!prereq && !!prereq.out?.trim();
          brief(
            blockedBy
              ? prereqDrafted
                ? `“${title}” unlocks once you approve “${blockedBy}” — let's review that draft.`
                : `“${title}” unlocks once “${blockedBy}” is done — let's start there.`
              : `“${title}” needs an earlier step finished first.`,
            prereq
              ? {
                  action: {
                    label: `${prereqDrafted ? 'Review' : 'Start'}: ${prereq.t}`,
                    deptK,
                    taskTitle: prereq.t,
                    inline: true,
                  },
                }
              : {},
          );
          return;
        }
        case 'needsYou': {
          // Founder-owned — byte can't run it, but it can help. Post a generated how-to + a capture
          // form for the task's output (openTaskHelp ensures the task exists, keeps the "I've done
          // it" chip, and falls back to a plain brief when the guide can't be fetched).
          void openTaskHelp(deptK, title, nodeId, actor);
          return;
        }
        case 'approve': {
          // Resolve (or link) the drafted task; review it in-thread.
          const t = nodeId ? ensureRoadmapTask(deptK, title, nodeId, actor) : realT;
          brief(`I've drafted “${title}”. Let's review it${d ? ` in ${dn}` : ''}.`, {
            action: {
              label: `Review: ${(t ?? realT)?.t ?? title}`,
              deptK,
              taskTitle: (t ?? realT)?.t ?? title,
              inline: true,
            },
          });
          return;
        }
        default: {
          // available / current — byte can do this. The spine guarantees a runnable task: match
          // an existing one or create it on demand, so one tap always runs it in-thread (and the
          // node then tracks that task's real state). Only fall back to a plain brief if there's
          // no node/department to hang a task on.
          const t = nodeId ? ensureRoadmapTask(deptK, title, nodeId, actor) : realT;
          if (t)
            brief(`Let's do “${title}”${d ? ` in ${dn}` : ''} — ready when you are.`, {
              action: { label: `Start: ${t.t}`, deptK, taskTitle: t.t, inline: true },
            });
          else
            brief(
              `“${title}” is your next move${d ? ` in ${dn}` : ''}.${d?.need ? ` ${d.need}` : ''} Ask me anything about it and I'll walk you through it.`,
            );
          return;
        }
      }
    },
    [toggleCopilot, openDept, ensureRoadmapTask, library, viewItem, openTaskHelp],
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
    const company = cleanCompanyName(brief.projectName) ?? 'your company';
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

  // After a task is completed but the stage isn't finished, byte speaks up in the chat —
  // acknowledges it and points to (and offers to run) the next move — so finishing a task never
  // leaves the founder staring at a silent panel. The stage-complete moment is handled instead by
  // maybeOfferAdvance's advance prompt, so we skip this then to avoid two messages at once.
  const guideAfterCompletion = useCallback(
    (completedTitle: string) => {
      if (stageComplete()) return;
      // The SAME next move the beacon shows — so byte's nudge and the roadmap always agree.
      const move = computeRoadmapNext();
      const nm = (s: string) =>
        s
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();
      const d = move ? DEPTS.find((x) => x.k === move.deptK) : null;
      const realT = move && d ? d.tasks.find((x) => nm(x.t) === nm(move.title)) : null;
      const runnable = !!realT && !realT.done && liveKind(artType(realT)) !== null;
      toggleCopilot(false); // keep the chat open so the nudge is seen
      setChatMessages((prev) => [
        ...prev,
        {
          id: newId(),
          role: 'byte',
          text: move
            ? `Nice — “${completedTitle}” is done. Next up: “${move.title}”${d ? ` in ${d.name}` : ''}${runnable ? ' — want me to take it on?' : ' — it’s lit on the roadmap; hit Start when you’re ready.'}`
            : `Nice — “${completedTitle}” is done. That’s this phase wrapped — check the roadmap for what’s next.`,
          ts: Date.now(),
          action:
            runnable && realT && d
              ? { label: `Start: ${realT.t}`, deptK: d.k, taskTitle: realT.t, inline: true }
              : undefined,
        },
      ]);
    },
    [toggleCopilot, computeRoadmapNext],
  );

  // One-time, subtle BYOK nudge: once the founder has approved a few deliverables (they're
  // invested) and hasn't set a key, drop ONE dismissible chat card offering to run byte's
  // lighter BACKGROUND work on their own Anthropic key. Transient (never persisted, no persistMsg)
  // + gated by a per-account localStorage flag → appears at most once. Honest framing (no
  // "more runs" promise); the key never touches deliverables/chat.
  const maybeNudgeByok = useCallback(
    async (deliverableCount: number) => {
      if (deliverableCount < 3 || !companyId) return;
      const seenKey = `codepet:byokNudge:${companyId}`;
      try {
        if (localStorage.getItem(seenKey)) return;
      } catch {
        return;
      }
      // Fetch only at the moment we'd nudge (not on every load). Mark seen either way so this
      // never re-checks; if a key is already set, don't nudge.
      const status = await getByok();
      try {
        localStorage.setItem(seenKey, '1');
      } catch {}
      if (status.present) return;
      setChatMessages((prev) => [
        ...prev,
        {
          id: newId(),
          role: 'byte',
          ts: Date.now(),
          byokNudge: true,
          text: `Small optional thing — I just picked your next step and quietly logged a couple of decisions in the background. If you like, that lighter background work can run on your own Anthropic key; your deliverables and our chats always stay on me. No pressure — it just helps keep byte snappy. You can add a key anytime in Billing & Usage.`,
        },
      ]);
    },
    [companyId],
  );
  const dismissByokNudge = useCallback((msgId: string) => {
    setChatMessages((prev) => prev.filter((m) => m.id !== msgId));
  }, []);

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
      void maybeNudgeByok(library.length + 1); // after a few approvals, offer BYOK once
      const next = d.tasks.find((x) => !x.done);
      bump();
      track('task.approved', { dept: d.k, type });
      toast((type === 'build' || type === 'site' ? 'Shipped' : 'Saved') + ' · ' + t.t);
      // Write-through (optimistic — the in-memory update already happened).
      if (companyId) {
        const approvedAt = Date.now();
        persistWithRetry(() => persistApproval(companyId, d, item, approvedAt), {
          toast,
          label: 'persistApproval',
          failMessage: 'Saved here, but syncing failed — it may not persist.',
        });
        // Ledger emit: keyed by the same id persistApproval assigns (`${d.k}-${approvedAt}`),
        // so this live node and the backfill's node for the same deliverable never duplicate.
        const ev = eventFromLibItem(
          { id: `${d.k}-${approvedAt}`, title: item.title, k: d.k, createdAt: approvedAt },
          d.k,
        );
        void appendEvent(companyId, ev);
        setEvents((prev) => [ev, ...prev.filter((e) => e.refId !== ev.refId)]);
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
      guideAfterCompletion(t.t); // …otherwise byte acknowledges it + nudges the next move in chat
      return { item, next };
    },
    [
      companyId,
      bump,
      toast,
      computeNextStep,
      maybeOfferAdvance,
      guideAfterCompletion,
      library,
      maybeNudgeByok,
    ],
  );

  // Founder-owned tasks (incorporate, open a bank account, …) are the founder's to do — byte
  // can't produce a deliverable for them. This is the completion path that fulfills byte's
  // "tell me when it's done and I'll mark it" promise: flip the task (and its linked roadmap
  // node) to Done, unlock its dependents live, and offer to advance if the stage just finished.
  const markTaskDone = useCallback(
    (deptK: string, taskTitle: string) => {
      const d = DEPTS.find((x) => x.k === deptK);
      const t = d?.tasks.find((x) => x.t === taskTitle);
      if (!d || !t || t.done) return;
      t.done = true;
      t.drafted = false;
      d.pend = Math.max(0, (d.pend || 0) - 1);
      if (d.pend === 0 && d.status === 'attention') d.status = 'ready';
      bump();
      if (companyId)
        persistDepartmentTasks(companyId, d).catch((err) =>
          console.error('[store] mark task done failed', err),
        );
      setChatMessages((prev) => prev.filter((m) => !m.brief));
      computeNextStep(); // it's done now — advance the next step
      maybeOfferAdvance(); // …and if that finished the stage, offer to move up
      guideAfterCompletion(taskTitle); // …otherwise acknowledge it + nudge the next move in chat
    },
    [companyId, bump, computeNextStep, maybeOfferAdvance, guideAfterCompletion],
  );

  // The literal "add your input": save a founder task's captured OUTPUTS into company memory
  // (decisions — read by every downstream generation via composeProjectModel), then mark the task
  // done. So completing "Business bank account" leaves "Bank: Mercury" behind for billing/invoices
  // to build on. Non-sensitive values only (the capture form + prompt enforce that upstream).
  const captureTaskInput = useCallback(
    (deptK: string, taskTitle: string, values: { key: string; label: string; value: string }[]) => {
      const extracted = values
        .filter((v) => v.value.trim())
        .map((v) => ({
          topic: v.key.trim(),
          statement: `${v.label.trim()}: ${v.value.trim()}`,
          source: 'input' as const,
        }))
        .filter((e) => e.topic && e.statement);
      if (extracted.length) {
        setDecisions((prev) => {
          const next = mergeDecisions(prev, extracted, Date.now());
          if (companyId) persistDecisions(companyId, next).catch(() => {});
          return next;
        });
      }
      // markTaskDone clears the brief (and thus the help card) and posts the acknowledgment/nudge.
      markTaskDone(deptK, taskTitle);
    },
    [companyId, markTaskDone],
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

  // Credit the on-items whose `fits` includes a produced task's type (deduped) and
  // persist, same as toggleEnv.
  const creditToolkitUse = useCallback(
    (taskTitle: string, type: string) => {
      const used = toolkitUsedFor(ENV, type);
      if (!used.length) return;
      for (const u of used) {
        const item = ENV[u.category]?.find((x) => x.n === u.name);
        if (item) item.tasks = appendTaskUse(item.tasks, taskTitle);
      }
      bump();
      if (companyId) {
        persistEnvUsage(companyId, envUsageFromCatalog()).catch((err) => {
          console.error('[store] persistEnvUsage failed', err);
        });
      }
    },
    [bump, companyId],
  );

  // byte produced a reviewable draft for this task — mark it awaiting the founder's
  // approval and persist so the state survives reload. `done` (on approve) supersedes.
  const persistTaskDraft = useCallback(
    (deptK: string, taskTitle: string) => {
      const d = DEPTS.find((x) => x.k === deptK);
      const t = d?.tasks.find((x) => x.t === taskTitle);
      if (!d || !t || t.done || t.run === 'route') return; // ship-type never "awaits"
      t.drafted = true;
      bump();
      if (companyId)
        persistWithRetry(() => persistDepartmentTasks(companyId, d), {
          toast,
          label: 'persistTaskDraft',
          failMessage: 'Couldn’t save this draft — it may be lost if you reload.',
        });
    },
    [companyId, bump, toast],
  );

  // Turn a named toolkit item ON for the founder — byte's "I'll connect it" from chat.
  // Idempotent (never flips an already-on item off) and persisted like toggleEnv.
  const setupCapability = useCallback(
    (category: string, name: string) => {
      const idx = resolveEnvIndex(ENV, category, name);
      if (idx === -1) return;
      const item = ENV[category][idx];
      if (item.s) return; // already on — nothing to do
      item.s = 1;
      bump();
      if (companyId) {
        persistEnv(companyId, envStateFromCatalog()).catch((err) => {
          console.error('[store] persistEnv (setup) failed', err);
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
      // Idempotent: if this task already has a draft, surface THAT instead of
      // re-generating. Re-running duplicates the deliverable (and its saved library
      // copy) — the bug when a locked step's "Start: <prereq>" is tapped for a prereq
      // that's already drafted-but-not-approved. Show the existing draft so the founder
      // can approve/revise it, not a second copy.
      if (t.out?.trim()) {
        setChatMessages((prev) => [
          ...prev,
          {
            id: msgId,
            role: 'byte',
            text: `You already have a draft of “${t.t}” — here it is. Approve it (or Revise) to move on.`,
            ts: Date.now(),
            result: { deptK, taskTitle, type },
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
          steps: buildLog(t, type, d),
          result: { deptK, taskTitle, type },
        },
      ]);
      try {
        const res = await runByteTask({
          kind,
          taskTitle: t.t,
          taskHint: t.d,
          deptName: d.name,
          deptKey: d.k,
          brief,
          companionId,
        });
        applyResult(t, type, res);
        creditToolkitUse(t.t, type);
        bump();
        persistTaskDraft(d.k, t.t);
        track('chat.run_task', { dept: d.k, type });
        setAiOffline(null); // a successful run means byte is reachable again
        setChatMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, running: false } : m)));
      } catch (err) {
        const code = err instanceof GenerateError ? err.code : '';
        const limited = code === 'rate_limited' || code === 'http_429';
        if (limited || code === 'ai_unavailable') setAiOffline({ code, at: Date.now() });
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
    [brief, bump, persistTaskDraft, creditToolkitUse, companionId],
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
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, running: true, steps: buildLog(t, type, d) } : m,
        ),
      );
      try {
        const res = await runByteTask({
          kind,
          taskTitle: t.t,
          taskHint: t.d,
          deptName: d.name,
          deptKey: d.k,
          brief,
          reviseNote: trimmed || undefined,
          current: trimmed ? currentDraft(t, type) : undefined,
          companionId,
        });
        applyResult(t, type, res);
        bump();
        persistTaskDraft(d.k, t.t);
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
    [brief, bump, persistTaskDraft, toast, companionId],
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

  // Open an inline chat result: a site opens in a new tab, every other deliverable
  // opens the readable viewer (scrollable full text, with its own Copy inside).
  // Built from the live task.
  const openChatResult = useCallback(
    (deptK: string, taskTitle: string) => {
      const d = DEPTS.find((x) => x.k === deptK);
      const t = d?.tasks.find((x) => x.t === taskTitle);
      if (!d || !t) return;
      const type = artType(t);
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
        doc: t.doc,
        dms: t.dms,
        checklist: t.checklist,
        plan: t.plan,
      };
      // A site opens in a new tab; every other deliverable opens the readable
      // viewer (scrollable full text, with its own Copy inside) — the same modal
      // the department card and Library use.
      if (type === 'site') openDeliverable(item);
      else viewItem(item);
    },
    [openDeliverable, viewItem],
  );

  // Chat-history actions: switch/rename/delete threads, open/close the history list,
  // and start a fresh one. The new thread's Firestore doc is written lazily on the
  // first message (see sendChat) so a never-sent "New chat" never litters the list.
  const toggleChatHistory = useCallback((open?: boolean) => {
    setChatHistoryOpen((c) => (open === undefined ? !c : open));
  }, []);

  const newChat = useCallback(() => {
    // Cancel any in-flight stream first — otherwise its stream-end persistMsg (bound
    // to the OLD threadId) can land after we've switched threads.
    chatAbort.current?.abort();
    setChatStreaming(false);
    setActiveThreadId(newId());
    pendingThreadRef.current = true; // created in Firestore on first send
    setChatMessages([]);
    setChatHistoryOpen(false);
  }, []);

  const openThread = useCallback(
    (id: string) => {
      if (!companyId) return;
      // Cancel any in-flight stream first — see newChat for why.
      chatAbort.current?.abort();
      setChatStreaming(false);
      pendingThreadRef.current = false;
      setActiveThreadId(id);
      setChatHistoryOpen(false);
      loadThreadMessages(companyId, id)
        .then((msgs) =>
          setChatMessages(
            msgs.map((m) => ({ id: m.id, role: m.role, text: m.text, ts: m.createdAt })),
          ),
        )
        .catch((err) => console.error('[store] loadThreadMessages failed', err));
    },
    [companyId],
  );

  const renameThread = useCallback(
    (id: string, title: string) => {
      const clean = title.trim();
      if (!clean) return;
      setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, title: clean } : t)));
      if (companyId)
        updateThreadTitle(companyId, id, clean).catch((err) =>
          console.error('[store] updateThreadTitle failed', err),
        );
    },
    [companyId],
  );

  const deleteThread = useCallback(
    (id: string) => {
      if (!companyId) return;
      // Cancel any in-flight stream first — otherwise deleting the active thread
      // mid-stream lets the stream-end persistMsg re-create it via the `{updatedAt}`
      // merge in persistChatMessage, leaving a titleless zombie thread on reload.
      chatAbort.current?.abort();
      setChatStreaming(false);
      const fallback = activeThreadId === id ? pickFallbackThreadId(threads, id) : null;
      setThreads((prev) => prev.filter((t) => t.id !== id));
      deleteThreadAndMessages(companyId, id).catch((err) =>
        console.error('[store] deleteThreadAndMessages failed', err),
      );
      if (activeThreadId === id) {
        if (fallback) openThread(fallback);
        else newChat();
      }
    },
    [companyId, activeThreadId, threads, openThread, newChat],
  );

  const clearAllChats = useCallback(() => {
    if (!companyId) return;
    // Cancel any in-flight stream first — same reason as deleteThread: a stream-end
    // persistMsg could otherwise re-create a just-deleted thread.
    chatAbort.current?.abort();
    setChatStreaming(false);
    const ids = threads.map((t) => t.id);
    setThreads([]);
    ids.forEach((id) =>
      deleteThreadAndMessages(companyId, id).catch((err) =>
        console.error('[store] deleteThreadAndMessages failed', err),
      ),
    );
    // Drop into a fresh empty chat (also closes the history list).
    newChat();
  }, [companyId, threads, newChat]);

  // The department in focus drives BOTH the Copilot's voice-per-department persona and its
  // avatar/name: the department being viewed → else the CURRENT NEXT STEP's department →
  // else undefined (byte). One source of truth so the chat's face never disagrees with its tone.
  const focusDeptKey = (view === 'dept' ? deptKey : null) ?? nextStep?.deptK ?? undefined;
  const focusCompanionId = companionForDept(focusDeptKey).id;

  // byte chat. Appends the founder's message, streams byte's reply in place, and
  // persists both. One turn at a time — guarded by chatStreaming.
  // The streaming engine both sendChat and retryChat drive: run byte's reply into an
  // existing byte bubble (`byteMsgId`) against `history`. Aborts any prior in-flight stream,
  // handles action/nav/setup/memory events, gives distinct copy per failure, and flags the
  // bubble for Retry when it fails. Company context is snapshotted fresh on each run.
  // Long-thread memory: once a batch of turns has scrolled past the chat window, fold them
  // into the thread's rolling summary (best-effort — a failure just leaves the summary as-is
  // and the next batch retries). The summary rides along on the next chat call as grounding.
  const maybeSummarizeThread = useCallback(
    async (threadId: string, turns: { role: 'me' | 'byte'; text: string }[]) => {
      if (!companyId) return;
      const thread = threads.find((t) => t.id === threadId);
      if (!thread) return;
      const plan = planThreadSummary(turns, thread.summarizedThrough ?? 0);
      if (plan.turns.length === 0) return;
      const summary = await summarizeThread(thread.summary ?? '', plan.turns);
      if (summary == null || !summary.trim()) return;
      const updated: ThreadMeta = { ...thread, summary, summarizedThrough: plan.through };
      setThreads((prev) => prev.map((t) => (t.id === threadId ? updated : t)));
      persistThread(companyId, updated).catch((err) =>
        console.error('[store] persistThread(summary) failed', err),
      );
    },
    [companyId, threads],
  );

  const runByteStream = useCallback(
    (byteMsgId: string, byteTs: number, history: { role: 'me' | 'byte'; text: string }[]) => {
      chatAbort.current?.abort();
      const ac = new AbortController();
      chatAbort.current = ac;
      setChatStreaming(true);
      const activeThread = threads.find((t) => t.id === activeThreadId);

      // A compact snapshot of the departments so byte talks about THIS company — plus the
      // single next step byte already picked, so chat and the map beacon never disagree.
      const deptLines = DEPTS.map(
        (d) => `- ${d.name} (${d.status}, ${d.pend} to do): ${d.need}`,
      ).join('\n');
      const focusDept = nextStep ? DEPTS.find((d) => d.k === nextStep.deptK)?.name : undefined;
      // Lead with the single agreed next step so it survives the route's length cap — the
      // department lines below can be long and would otherwise push this grounding past the
      // slice, leaving byte to invent a different "first step" than the map beacon shows.
      const focus =
        nextStep && focusDept
          ? `CURRENT NEXT STEP (the founder's single focus right now): "${nextStep.taskTitle}" in ${focusDept}${nextStep.why ? ` — ${nextStep.why}` : ''}. If they ask what to do or focus on — first, next, or right now — name THIS exact task and department as your headline answer; you may add sequencing or detail, but never lead with a different task.\n\n`
          : '';
      const deptSummary = focus + deptLines;
      const openTasks = DEPTS.flatMap((d) =>
        d.tasks
          .filter((t) => !t.done && liveKind(artType(t)) !== null)
          .map((t) => ({ deptK: d.k, deptName: d.name, taskTitle: t.t, hint: t.d ?? '' })),
      );
      const envSetup = collectSetupItems(ENV);

      (async () => {
        let acc = '';
        let errCode = '';
        let failed = false;
        let pending: { deptK: string; taskTitle: string } | null = null;
        let navChip: NavChip | undefined;
        let setupChip: { category: string; name: string } | undefined;
        let offerBuild = false;
        try {
          for await (const ev of streamByteChat(
            history,
            deptSummary,
            openTasks,
            envSetup,
            focusDeptKey,
            activeThread?.summary,
            ac.signal,
          )) {
            if (ev.type === 'action') {
              pending = { deptK: ev.deptK, taskTitle: ev.taskTitle };
              continue;
            }
            if (ev.type === 'nav') {
              // Resolve to a real chip client-side (drops a stale/unknown destination).
              navChip = resolveNavChip(ev.dest, ev.target, DEPTS);
              continue;
            }
            if (ev.type === 'setup') {
              setupChip = { category: ev.category, name: ev.name };
              continue;
            }
            if (ev.type === 'build-offer') {
              offerBuild = true;
              continue;
            }
            if (ev.type === 'noted') {
              // byte recorded durable facts (in this same generation — no extra call). The
              // server already merged them into memory; reflect them locally as a quiet
              // "Noted" chip per fact and fold into decisions so grounding updates now.
              const now = Date.now();
              setChatMessages((prev) => [
                ...prev,
                ...ev.items.map((c) => ({
                  id: newId(),
                  role: 'byte' as const,
                  text: '',
                  ts: now,
                  noted: { topic: c.topic, statement: c.statement },
                })),
              ]);
              setDecisions((prev) => {
                const byTopic = new Map(prev.map((d) => [d.topic.trim().toLowerCase(), d]));
                for (const c of ev.items) {
                  byTopic.set(c.topic.trim().toLowerCase(), {
                    topic: c.topic,
                    statement: c.statement,
                    source: 'chat',
                    updatedAt: now,
                  });
                }
                return [...byTopic.values()];
              });
              if (companyId) {
                for (const c of ev.items) {
                  const decEv = eventFromDecision({
                    topic: c.topic,
                    statement: c.statement,
                    source: 'chat',
                    updatedAt: now,
                  });
                  void appendEvent(companyId, decEv);
                  setEvents((prev) => [decEv, ...prev.filter((e) => e.refId !== decEv.refId)]);
                }
              }
              continue;
            }
            acc += ev.text;
            setChatMessages((prev) =>
              prev.map((m) => (m.id === byteMsgId ? { ...m, text: acc } : m)),
            );
          }
        } catch (err) {
          // A deliberate abort (new send / retry / sign-out) leaves state untouched.
          if (ac.signal.aborted) return;
          console.error('[store] chat stream failed', err);
          failed = true;
          errCode = err instanceof ChatError ? err.code : 'network';
        }
        // Track byte's availability globally so the hub shows one honest offline state: a
        // credit/quota failure marks it offline; any success clears it.
        if (!failed) setAiOffline(null);
        else if (errCode === 'ai_unavailable' || errCode === 'rate_limited')
          setAiOffline({ code: errCode, at: Date.now() });
        const fallback =
          errCode === 'rate_limited'
            ? 'We’ve hit today’s usage limit — it resets tomorrow. Let’s pick this back up then.'
            : errCode === 'unauthorized'
              ? 'Your session looks expired — sign in again and I’ll pick right back up.'
              : errCode === 'ai_unavailable'
                ? 'I’m temporarily unavailable — try again shortly and I’ll pick right back up.'
                : errCode === 'network'
                  ? 'I couldn’t reach the model — check your connection, then Retry.'
                  : 'I couldn’t reach the model just now.';
        // Errored = a real failure that produced nothing usable → show the Retry affordance.
        const errored = failed && !acc.trim() && !pending && !navChip && !setupChip && !offerBuild;
        // If byte chose to act but said nothing, synthesize a short lead-in so the run or
        // the "take me there" chip never appears out of nowhere.
        const finalText =
          acc.trim() ||
          (pending
            ? `On it — running “${pending.taskTitle}”.`
            : navChip
              ? 'Here you go.'
              : setupChip
                ? 'I can turn that on for you — one tap.'
                : offerBuild
                  ? 'Love it — let’s build it.'
                  : fallback);
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === byteMsgId
              ? {
                  ...m,
                  text: finalText,
                  nav: navChip,
                  setup: setupChip,
                  error: errored || undefined,
                  ...(offerBuild
                    ? { buildAction: { kind: 'begin-intake' as const, label: "Let's build it →" } }
                    : {}),
                }
              : m,
          ),
        );
        setChatStreaming(false);
        chatAbort.current = null;
        // Persist byte's reply if it's a real answer or a run lead-in (not the error
        // fallback). The inline result card itself is transient, like the briefings.
        if (companyId && (acc.trim() || pending || navChip || setupChip || offerBuild)) {
          persistMsg({ id: byteMsgId, role: 'byte', text: finalText, ts: byteTs });
        }
        // Long-thread memory: after a real exchange, fold any turns that have scrolled past
        // the window into the thread's rolling summary (best-effort, only when a batch drops).
        if (!failed && activeThreadId) {
          const turns = acc.trim() ? [...history, { role: 'byte' as const, text: acc }] : history;
          void maybeSummarizeThread(activeThreadId, turns);
        }
        // byte decided to run a task — produce it inline now.
        if (pending) runTaskInChat(pending.deptK, pending.taskTitle);
      })();
    },
    [
      companyId,
      nextStep,
      focusDeptKey,
      runTaskInChat,
      persistMsg,
      threads,
      activeThreadId,
      maybeSummarizeThread,
    ],
  );

  const sendChat = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text || chatStreaming) return;

      const now = Date.now();
      const userMsg: ChatMessage = { id: newId(), role: 'me', text, ts: now };
      // Pin the reply to whoever is in focus now, so it keeps that pet's face in the thread
      // even after the founder navigates to another department.
      const byteMsg: ChatMessage = {
        id: newId(),
        role: 'byte',
        text: '',
        ts: now + 1,
        companionId: focusCompanionId,
      };

      // Build the history to send BEFORE the empty byte placeholder is added.
      const history = [...chatMessages, userMsg].map((m) => ({ role: m.role, text: m.text }));
      setChatMessages((prev) => [...prev, userMsg, byteMsg]);
      track('chat.send', {});

      if (companyId) {
        if (pendingThreadRef.current && activeThreadId) {
          const thread: ThreadMeta = {
            id: activeThreadId,
            title: deriveThreadTitle(text),
            createdAt: now,
            updatedAt: now,
          };
          pendingThreadRef.current = false;
          setThreads((prev) => [thread, ...prev]);
          persistThread(companyId, thread).catch((err) =>
            console.error('[store] persist thread failed', err),
          );
        }
        persistMsg({ id: userMsg.id, role: 'me', text, ts: userMsg.ts });
      }

      runByteStream(byteMsg.id, byteMsg.ts, history);
    },
    [
      companyId,
      chatMessages,
      chatStreaming,
      focusCompanionId,
      runByteStream,
      persistMsg,
      activeThreadId,
    ],
  );

  // Re-run a byte reply that failed: rebuild the history up to (and ending on) the user turn
  // that failed, reset the bubble to a fresh placeholder, and re-stream into it.
  const retryChat = useCallback(
    (byteMsgId: string) => {
      if (chatStreaming) return;
      const target = chatMessages.find((m) => m.id === byteMsgId);
      if (!target) return;
      const history = chatMessages
        .filter((m) => m.id !== byteMsgId)
        .map((m) => ({ role: m.role, text: m.text }));
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === byteMsgId
            ? { ...m, text: '', error: undefined, nav: undefined, setup: undefined }
            : m,
        ),
      );
      track('chat.retry', {});
      runByteStream(byteMsgId, target.ts, history);
    },
    [chatMessages, chatStreaming, runByteStream],
  );

  const startBuildIntake = useCallback(() => {
    // Idempotent: an intake already in progress must never stack a second opener.
    if (buildIntakeActive) return;
    setBuildIntakeActive(true);
    setBuildBrief('');
    setBuildIntakeLog([{ role: 'byte', text: INTAKE_OPENING }]);
    setBuildPlanState(null);
    const opening: ChatMessage = {
      id: newId(),
      role: 'byte',
      text: INTAKE_OPENING,
      ts: Date.now(),
    };
    // Strip the "Let's build it" trigger(s) as we open, so they can't be tapped
    // again to re-append the opener (the source of the duplicated intake message).
    setChatMessages((prev) => [...stripBuildButtons(prev), opening]);
    persistMsg({ id: opening.id, role: 'byte', text: opening.text, ts: opening.ts });
    track('build.intake.start', {});
  }, [companyId, persistMsg, buildIntakeActive]);

  const cancelBuildIntake = useCallback(() => {
    setBuildIntakeActive(false);
    setBuildBrief('');
    const msg: ChatMessage = {
      id: newId(),
      role: 'byte',
      text: 'No worries — we can build whenever you like. What else can I help with?',
      ts: Date.now(),
    };
    setChatMessages((prev) => [...stripBuildButtons(prev), msg]);
    persistMsg({ id: msg.id, role: 'byte', text: msg.text, ts: msg.ts });
    track('build.intake.cancel', {});
  }, [persistMsg]);

  const addIntakeTurn = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      setBuildBrief((b) => appendBrief(b, text));

      const nextLog: BrainstormTurn[] = [...buildIntakeLog, { role: 'user', text }];
      setBuildIntakeLog(nextLog);
      const userTurns = nextLog.filter((t) => t.role === 'user').length;

      const now = Date.now();
      const userMsg: ChatMessage = { id: newId(), role: 'me', text, ts: now };
      const thinkingId = newId();
      setChatMessages((prev) => [
        ...stripBuildButtons(prev),
        userMsg,
        // Transient "thinking" bubble, swapped for Byte's question/summary below.
        { id: thinkingId, role: 'byte', text: 'Byte is thinking…', ts: now + 1 },
      ]);
      // Persist only the founder's real answer; Byte's turns are transient like
      // the result cards (they carry in-memory-only buttons and reload dead).
      persistMsg({ id: userMsg.id, role: 'me', text, ts: userMsg.ts });

      (async () => {
        let reply = null as Awaited<ReturnType<typeof requestBuildBrainstorm>> | null;
        try {
          reply = await requestBuildBrainstorm({
            conversation: nextLog,
            project: buildProject || undefined,
          });
        } catch {
          reply = null; // Any failure → static fallback via decideIntakeStep.
        }
        const step = decideIntakeStep(reply, userTurns);
        // Only a follow-up question needs to re-enter the transcript (so the next
        // API turn sees it). A ready/fallback reflect-back is derived from turns
        // already in the log and is terminal — the founder builds next — so it's
        // deliberately not appended.
        if (step.mode === 'question') {
          setBuildIntakeLog((prev) => [...prev, { role: 'byte', text: step.text }]);
        }
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === thinkingId
              ? {
                  ...m,
                  text: step.text,
                  ...(step.mode === 'question'
                    ? {}
                    : {
                        buildAction: {
                          kind: 'to-plan' as const,
                          label: step.mode === 'ready' ? 'Build this →' : 'Turn this into a plan →',
                        },
                      }),
                }
              : m,
          ),
        );
      })();
    },
    [buildIntakeLog, buildProject, persistMsg],
  );

  const generateBuildPlan = useCallback(() => {
    const brief = buildBrief.trim();
    if (!brief) return;
    // The thinking → plan-card message carries an in-memory-only buildPlan +
    // buildAction (dead after reload), so it stays transient like the result cards.
    const thinkingId = newId();
    setChatMessages((prev) => [
      ...stripBuildButtons(prev),
      { id: thinkingId, role: 'byte', text: 'Byte is turning this into a plan…', ts: Date.now() },
    ]);
    (async () => {
      try {
        const plan = await requestBuildPlan({ brief, project: buildProject || undefined });
        setBuildPlanState(plan);
        setBuildIntakeActive(false);
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === thinkingId
              ? {
                  ...m,
                  text: `Here's the plan — aim for ~${plan.budgetActions} actions.`,
                  buildPlan: plan,
                  buildAction: { kind: 'start-building', label: 'Start building' },
                }
              : m,
          ),
        );
      } catch {
        // The failure message carries its own retry button — no scrolling back to
        // hunt for the previous "turn this into a plan" one (those were stripped).
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === thinkingId
              ? {
                  ...m,
                  text: "Byte couldn't put the plan together just now. Give it another go?",
                  buildAction: { kind: 'to-plan', label: 'Try again' },
                }
              : m,
          ),
        );
      }
    })();
  }, [buildBrief, buildProject]);

  const setBuildPlanSteps = useCallback((steps: string[]) => {
    setBuildPlanState((p) => (p ? { ...p, steps } : p));
  }, []);

  const armBuild = useCallback(() => {
    // A project is required — never fall back to '.' (the app server's own cwd),
    // which would let Byte build inside whatever directory the server runs from.
    // (Demo mode is the one exception: it targets a fixed, throwaway ~/codepet-demo dir.)
    if (!buildPlan || !companyId || buildArming || (!demoLetsBuild && !buildProject.trim())) return;
    setBuildArming(true);
    buildEndedNudged.current = false;
    setBuildResumed(false);
    (async () => {
      try {
        const id = crypto.randomUUID();
        // Non-null only in remote mode (a copy-paste command is shown); drives the honest
        // "paste this" message vs the local "I'm watching" one.
        let launchCommand: string | null = null;
        if (demoLetsBuild) {
          const cap = await getCapability();
          if (cap.mode === 'local') {
            const dir = await scaffoldDemoProject(); // creates + seeds ~/codepet-demo
            setBuildProjectDir(dir);
            setBuildCheckpoint(null); // throwaway target — no rewind
            setBuildLocal(true);
            setBuildLaunchCommand(null);
            setBuildSessionId(id);
            setBuildLive(null);
            setBuildStep('during');
          } else {
            setBuildLocal(false);
            setBuildProjectDir(DEMO_DIR);
            setBuildCheckpoint(null); // throwaway target — no rewind
            const token = await ensureIngestToken(companyId);
            await armBuildSession({
              buildSessionId: id,
              projectDir: DEMO_DIR,
              plan: buildPlan,
              brief: buildBrief,
              companyId,
              token,
              apiUrl: window.location.origin,
            });
            // Self-seeding copy-paste command (the app can't touch the tester's machine remotely).
            launchCommand = demoTerminalCommand(buildOpeningPrompt(buildPlan, buildBrief), {
              apiUrl: window.location.origin,
              companyId,
              buildSessionId: id,
              token,
            });
            setBuildLaunchCommand(launchCommand);
            setBuildSessionId(id);
            setBuildLive(null);
            setBuildStep('during');
          }
        } else {
          const dirs = await loadProjectDirs(companyId);
          const dir = dirs.find((p) => p.name === buildProject)?.path ?? buildProject.trim();
          setBuildProjectDir(dir);
          const cap = await getCapability();
          if (cap.mode === 'local') {
            // Snapshot the project BEFORE the session touches anything, so END can offer
            // a rewind. Best-effort: null (non-repo / git missing) just hides the button.
            setBuildCheckpoint(await createCheckpoint(dir));
            setBuildLocal(true);
            setBuildLaunchCommand(null);
            setBuildSessionId(id);
            setBuildLive(null);
            setBuildStep('during');
          } else {
            setBuildLocal(false);
            const token = await ensureIngestToken(companyId);
            // Self-report tokens too (best-effort, same as the demo path) so remote testers'
            // real usage shows up without a toolkit install.
            const command =
              terminalCommand(dir, buildOpeningPrompt(buildPlan, buildBrief)) +
              tokenReportSuffix({
                apiUrl: window.location.origin,
                companyId,
                buildSessionId: id,
                token,
              });
            const res = await armBuildSession({
              buildSessionId: id,
              projectDir: dir,
              plan: buildPlan,
              brief: buildBrief,
              companyId,
              token,
              apiUrl: window.location.origin,
            });
            launchCommand = res.ok && res.launched ? null : command;
            setBuildLaunchCommand(launchCommand);
            setBuildSessionId(id);
            setBuildLive(null);
            setBuildStep('during');
          }
        }
        setView('build');
        const live: ChatMessage = {
          id: newId(),
          role: 'byte',
          text: launchCommand
            ? 'Copy the command below into your terminal and run it — byte will build there. (This live view fills in only when you run the app locally.)'
            : "We're live! I'm watching your session in the main panel — every step lands there. 👀",
          ts: Date.now(),
        };
        setChatMessages((prev) => [...prev, live]);
        persistMsg({ id: live.id, role: 'byte', text: live.text, ts: live.ts });
        track('build.arm', { demo: demoLetsBuild });
      } finally {
        setBuildArming(false);
      }
    })();
  }, [buildPlan, companyId, buildArming, buildProject, buildBrief, demoLetsBuild, persistMsg]);

  // Advance a local in-UI build to the recap. (Remote builds flip via the live-doc
  // subscription; local mode has no such feed, so this is the explicit "wrap up".)
  const endBuild = useCallback(() => setBuildStep('end'), []);

  // Local in-UI builds report each transcript reading here — DURING meter + END
  // recap read buildLive either way, so both modes share one render path.
  const applyLocalLive = useCallback((s: LiveState) => setBuildLive(s), []);

  const rewindBuild = useCallback(() => {
    const ref = buildCheckpoint?.ref;
    if (!ref || !buildProjectDir) return;
    (async () => {
      const res = await rewindToCheckpoint(buildProjectDir, ref);
      const now = Date.now();
      const msg: ChatMessage = {
        id: newId(),
        role: 'byte',
        text: res.ok
          ? '↩ Rewound your project to before this build — everything it changed is undone.'
          : "I couldn't rewind the project just now. If you need to, you can undo the changes with git yourself.",
        ts: now,
      };
      setChatMessages((prev) => [...prev, msg]);
      if (res.ok) setBuildCheckpoint(null);
      persistMsg({ id: msg.id, role: 'byte', text: msg.text, ts: now });
      track('build.rewind', { ok: res.ok });
    })();
  }, [buildCheckpoint, buildProjectDir, companyId, persistMsg]);

  const resetBuildFlow = useCallback(() => {
    setBuildStep('during');
    setBuildProject('');
    setBuildBrief('');
    setBuildPlanState(null);
    setBuildCheckpoint(null);
    setBuildAutonomy('suggest');
    setBuildSessionId(null);
    setBuildLive(null);
    setBuildLocal(false);
    setBuildLaunchCommand(null);
    setBuildProjectDir('');
    setBuildIntakeActive(false);
    setBuildResumed(false);
    buildEndedNudged.current = false;
  }, []);

  const value = useMemo<AppState>(
    () => ({
      tick,
      bump,
      view,
      show,
      deptKey,
      openDept,
      navigateTo,
      selStage,
      drawerOpen,
      selectStage,
      closeStage,
      copilotCollapsed,
      toggleCopilot,
      onboarding,
      finishOnboarding,
      openOnboarding,
      scaffoldFromOnboarding,
      regenerateCompany,
      regenerating,
      planTailored,
      scaffoldFailure,
      aiOffline,
      advanceStage,
      growthSignal,
      clearGrowthSignal,
      brief,
      projectAnalysis,
      analysisLoading,
      ensureProjectAnalysis,
      decisions,
      updateDecision,
      deleteDecision,
      installed,
      setInstalled: setInstalledFlag,
      companionId,
      focusCompanionId,
      introSeen,
      markIntroSeen,
      installPromptOpen,
      openInstallPrompt,
      closeInstallPrompt,
      library,
      events,
      tracking,
      projects,
      modal,
      runTask,
      briefDepartment,
      portalSignal,
      portalToTask,
      guideRoadmapTask,
      markTaskDone,
      openTaskHelp,
      captureTaskInput,
      dismissByokNudge,
      runBriefedTask,
      viewItem,
      closeModal,
      openDeliverable,
      approveTask,
      toggleEnv,
      setupCapability,
      creditToolkitUse,
      chatMessages,
      chatStreaming,
      sendChat,
      threads,
      activeThreadId,
      chatHistoryOpen,
      newChat,
      openThread,
      renameThread,
      deleteThread,
      clearAllChats,
      toggleChatHistory,
      retryChat,
      runTaskInChat,
      reviseTaskInChat,
      approveChatResult,
      openChatResult,
      dismissChatAction,
      answerInterview,
      undoNoted,
      persistTaskDraft,
      nextStep,
      roadmapDefs,
      toastMsg,
      toast,
      buildStep,
      buildProject,
      setBuildProject,
      demoLetsBuild,
      setDemoLetsBuild,
      buildBrief,
      buildPlan,
      setBuildPlanSteps,
      buildSessionId,
      buildLive,
      buildLocal,
      buildLaunchCommand,
      buildProjectDir,
      buildArming,
      buildIntakeActive,
      buildResumed,
      applyLocalLive,
      startBuildIntake,
      cancelBuildIntake,
      addIntakeTurn,
      generateBuildPlan,
      armBuild,
      buildCheckpoint,
      rewindBuild,
      endBuild,
      buildAutonomy,
      setBuildAutonomy,
      resetBuildFlow,
    }),
    [
      tick,
      bump,
      view,
      show,
      deptKey,
      openDept,
      navigateTo,
      selStage,
      drawerOpen,
      selectStage,
      closeStage,
      copilotCollapsed,
      toggleCopilot,
      onboarding,
      finishOnboarding,
      openOnboarding,
      scaffoldFromOnboarding,
      regenerateCompany,
      regenerating,
      planTailored,
      scaffoldFailure,
      aiOffline,
      advanceStage,
      growthSignal,
      clearGrowthSignal,
      brief,
      projectAnalysis,
      analysisLoading,
      ensureProjectAnalysis,
      decisions,
      updateDecision,
      deleteDecision,
      installed,
      setInstalledFlag,
      companionId,
      focusCompanionId,
      introSeen,
      markIntroSeen,
      installPromptOpen,
      openInstallPrompt,
      closeInstallPrompt,
      library,
      events,
      tracking,
      projects,
      modal,
      runTask,
      briefDepartment,
      portalSignal,
      portalToTask,
      guideRoadmapTask,
      markTaskDone,
      openTaskHelp,
      captureTaskInput,
      dismissByokNudge,
      runBriefedTask,
      viewItem,
      closeModal,
      openDeliverable,
      approveTask,
      toggleEnv,
      setupCapability,
      creditToolkitUse,
      chatMessages,
      chatStreaming,
      sendChat,
      threads,
      activeThreadId,
      chatHistoryOpen,
      newChat,
      openThread,
      renameThread,
      deleteThread,
      clearAllChats,
      toggleChatHistory,
      retryChat,
      runTaskInChat,
      reviseTaskInChat,
      approveChatResult,
      openChatResult,
      dismissChatAction,
      answerInterview,
      undoNoted,
      persistTaskDraft,
      nextStep,
      roadmapDefs,
      toastMsg,
      toast,
      buildStep,
      buildProject,
      setBuildProject,
      demoLetsBuild,
      setDemoLetsBuild,
      buildBrief,
      buildPlan,
      setBuildPlanSteps,
      buildSessionId,
      buildLive,
      buildLocal,
      buildLaunchCommand,
      buildProjectDir,
      buildArming,
      buildIntakeActive,
      buildResumed,
      applyLocalLive,
      startBuildIntake,
      cancelBuildIntake,
      addIntakeTurn,
      generateBuildPlan,
      armBuild,
      buildCheckpoint,
      rewindBuild,
      endBuild,
      buildAutonomy,
      setBuildAutonomy,
      resetBuildFlow,
    ],
  );

  return <Ctx.Provider value={value}>{hydrated ? children : <HydrateScreen />}</Ctx.Provider>;
}
