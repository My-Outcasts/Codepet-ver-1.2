'use client';
// Phase 2 persistence layer. Reads a company's live state from Firestore and
// writes mutations through. The app keeps its mutate-in-place + `tick` re-render
// model: these helpers HYDRATE the module-level DEPTS/ENV singletons from
// Firestore on load and PERSIST changes after each in-memory mutation, so the
// view layer (which imports DEPTS/ENV directly) needs no changes.
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { LiveState } from '../liveBuild';
import type { ProjectAnalysis } from '../ai/projectAnalysis';
import { getDb } from './client';
import { DEPTS, ENV, DEPTS_SEED, ENV_SEED, byN, type Dept, type Task, type LibItem } from '../data';
import {
  paths,
  type DepartmentDoc,
  type LibraryDoc,
  type EnvState,
  type EnvUsage,
  type CompanyBrief,
  type ScannedProject,
  type ChatMessageDoc,
  type ThreadMeta,
} from './schema';
import { deriveThreadTitle, needsBackfill, sortThreadsByRecent } from '@/lib/chat/threads';
import { projectNames } from '../projects';
import {
  aggregateTracking,
  distinctProjects,
  EMPTY_TRACKING,
  type TrackEvent,
  type TrackingSummary,
} from '../tracking';
import { normalizeDecisions, type DecisionEntry } from '../ai/projectModel';
import { dayKey } from '../ai/rateLimit';

// ---- serialization (Firestore rejects undefined; drop runtime-only fields) ----
function clean<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

function serializeTask(t: Task): Task {
  // Drop runtime annotations that shouldn't be persisted.
  const { _item, _rev, ...rest } = t;
  void _item;
  void _rev;
  return clean(rest) as Task;
}

function serializeDept(dept: Dept): DepartmentDoc {
  return {
    k: dept.k,
    name: dept.name,
    ab: dept.ab,
    status: dept.status,
    pend: dept.pend,
    need: dept.need,
    byte: dept.byte,
    tasks: dept.tasks.map(serializeTask),
    later: dept.later ?? false,
  };
}

// ---- env state <-> ENV catalog ----
/** Snapshot the current on/off state of the ENV catalog as a persistable map. */
export function envStateFromCatalog(): EnvState {
  const state: EnvState = {};
  for (const [category, items] of Object.entries(ENV)) {
    state[category] = {};
    for (const item of items) state[category][item.n] = item.s === 1;
  }
  return state;
}

/** Apply a persisted env map back onto the ENV catalog singleton. */
export function applyEnvState(env: EnvState): void {
  for (const [category, items] of Object.entries(ENV)) {
    const saved = env[category];
    if (!saved) continue;
    for (const item of items) {
      if (item.n in saved) item.s = saved[item.n] ? 1 : 0;
    }
  }
}

// ---- env usage <-> ENV catalog (additive; independent of the on/off env map) ----
export function envUsageFromCatalog(): EnvUsage {
  const usage: EnvUsage = {};
  for (const [category, items] of Object.entries(ENV)) {
    usage[category] = {};
    for (const item of items) if (item.tasks?.length) usage[category][item.n] = item.tasks;
  }
  return usage;
}

/** Apply a persisted usage map back onto the ENV catalog singleton. Self-resetting: an
 * item not present in `usage` is cleared, so a previously signed-in account's usage can
 * never leak into a freshly loaded one (an empty map clears everything). */
export function applyEnvUsage(usage: EnvUsage): void {
  for (const [category, items] of Object.entries(ENV)) {
    const saved = usage[category] ?? {};
    for (const item of items) item.tasks = Array.isArray(saved[item.n]) ? saved[item.n] : undefined;
  }
}

export async function persistEnvUsage(companyId: string, usage: EnvUsage): Promise<void> {
  const db = getDb();
  await updateDoc(doc(db, paths.company(companyId)), { envUsage: usage, updatedAt: Date.now() });
}

/** Merge persisted departments onto the DEPTS singleton (by department key). */
export function applyDepartments(departments: DepartmentDoc[]): void {
  for (const loaded of departments) {
    const existing = DEPTS.find((d) => d.k === loaded.k);
    if (existing) Object.assign(existing, loaded);
  }
}

/**
 * Reset the mutable DEPTS/ENV singletons to their pristine seed, in place (element
 * references are preserved, so views holding them keep working). Called at the start
 * of every hydration so an account always loads from a clean baseline — no task
 * approvals, env toggles, or other edits can leak in from a previously signed-in
 * account on the same browser.
 */
export function resetCompanyData(): void {
  DEPTS.forEach((dept, i) => {
    const seed = DEPTS_SEED[i];
    if (seed) Object.assign(dept, structuredClone(seed));
  });
  for (const category of Object.keys(ENV)) {
    const seedItems = ENV_SEED[category] ?? [];
    ENV[category].forEach((item, i) => {
      const seed = seedItems[i];
      if (seed) Object.assign(item, structuredClone(seed));
    });
  }
}

// ---- load + hydrate ----
export interface CompanyData {
  library: LibItem[];
  brief: CompanyBrief;
  /** When onboarding was completed; undefined ⇒ the user hasn't onboarded yet. */
  onboardedAt?: number;
  /** When byte's stage scaffold last landed; undefined ⇒ the map is still the built-in
   *  example, not a plan generated from this founder's product. Drives the "example
   *  plan" signal so a seeded map is never mistaken for a tailored one. */
  scaffoldedAt?: number;
  /** Last-selected roadmap stage; undefined ⇒ none saved (use the UI default). */
  roadmapStage?: number;
  /** byte's one-time project analysis; undefined ⇒ not generated yet. */
  projectAnalysis?: ProjectAnalysis;
  /** The active thread's messages, oldest-first. */
  chat: ChatMessageDoc[];
  /** All conversation threads (history entries). */
  threads: ThreadMeta[];
  /** The thread whose messages are in `chat` (most-recent), or null if none. */
  activeThreadId: string | null;
  /** Durable company decisions byte maintains (the memory the founder can curate). */
  decisions: DecisionEntry[];
}

/** How many recent chat messages to hydrate on load. */
const CHAT_LOAD_LIMIT = 100;

/** A persisted roadmap stage is only usable if it maps to a real node. */
export function validStage(raw: unknown): number | undefined {
  return typeof raw === 'number' && byN(raw) ? raw : undefined;
}

/**
 * Load the company's persisted state and hydrate the DEPTS/ENV singletons in
 * place. Returns the library + business brief (which the store owns as state).
 */
export async function loadCompanyData(companyId: string): Promise<CompanyData> {
  // Start from a clean per-account baseline before applying this account's data.
  resetCompanyData();
  const db = getDb();
  const [deptSnap, libSnap, companySnap, threadSnap] = await Promise.all([
    getDocs(collection(db, paths.departments(companyId))),
    getDocs(query(collection(db, paths.library(companyId)), orderBy('createdAt', 'desc'))),
    getDoc(doc(db, paths.company(companyId))),
    getDocs(collection(db, paths.threads(companyId))),
  ]);

  applyDepartments(deptSnap.docs.map((d) => d.data() as DepartmentDoc));
  const company = companySnap.data();
  applyEnvState((company?.env ?? {}) as EnvState);
  applyEnvUsage((company?.envUsage ?? {}) as EnvUsage);

  const library = libSnap.docs.map((d) => {
    // Strip persistence-only fields so the shape matches the in-app LibItem.
    const { id, createdAt, ...item } = d.data() as LibraryDoc;
    void id;
    void createdAt;
    return item as LibItem;
  });

  // Threads + the active thread's messages. Migrate legacy flat chat on first load.
  let threads = threadSnap.docs.map((d) => d.data() as ThreadMeta);
  if (threads.length === 0) {
    const migrated = await backfillLegacyThread(companyId);
    if (migrated) threads = [migrated];
  }
  const activeThreadId = sortThreadsByRecent(threads)[0]?.id ?? null;
  const chat = activeThreadId ? await loadThreadMessages(companyId, activeThreadId) : [];

  return {
    library,
    brief: (company?.brief ?? {}) as CompanyBrief,
    onboardedAt: company?.onboardedAt as number | undefined,
    scaffoldedAt: company?.scaffoldedAt as number | undefined,
    roadmapStage: validStage(company?.roadmapStage),
    chat,
    threads,
    activeThreadId,
    decisions: normalizeDecisions(company?.decisions),
    projectAnalysis: company?.projectAnalysis as ProjectAnalysis | undefined,
  };
}

/**
 * Persist the founder-curated decisions memory. byte writes decisions server-side on
 * approval (/api/remember); this is the client path for the founder editing/removing
 * them in the "What byte remembers" panel. `clean` drops undefined fields (e.g. an
 * absent `source`) since Firestore rejects them.
 */
export async function persistDecisions(
  companyId: string,
  decisions: DecisionEntry[],
): Promise<void> {
  await updateDoc(doc(getDb(), paths.company(companyId)), {
    decisions: decisions.map((d) => clean(d)),
    updatedAt: Date.now(),
  });
}

/** Persist a single byte-chat message under the company. */
export async function persistChatMessage(
  companyId: string,
  message: ChatMessageDoc,
): Promise<void> {
  const db = getDb();
  await setDoc(doc(db, paths.chatMessage(companyId, message.id)), message);
  // Bump the parent thread so the history list re-sorts / shows fresh relative time.
  await setDoc(
    doc(db, paths.thread(companyId, message.threadId)),
    { updatedAt: message.createdAt },
    { merge: true },
  );
}

export async function loadThreads(companyId: string): Promise<ThreadMeta[]> {
  const snap = await getDocs(collection(getDb(), paths.threads(companyId)));
  return snap.docs.map((d) => d.data() as ThreadMeta);
}

export async function loadThreadMessages(
  companyId: string,
  threadId: string,
): Promise<ChatMessageDoc[]> {
  const snap = await getDocs(
    query(
      collection(getDb(), paths.chat(companyId)),
      where('threadId', '==', threadId),
      orderBy('createdAt', 'desc'),
      limit(CHAT_LOAD_LIMIT),
    ),
  );
  // Query returns newest-first (to cap at the most recent N); flip back to
  // oldest-first for rendering/history order.
  return snap.docs.map((d) => d.data() as ChatMessageDoc).reverse();
}

export async function persistThread(companyId: string, thread: ThreadMeta): Promise<void> {
  await setDoc(doc(getDb(), paths.thread(companyId, thread.id)), thread);
}

export async function updateThreadTitle(
  companyId: string,
  threadId: string,
  title: string,
): Promise<void> {
  await setDoc(doc(getDb(), paths.thread(companyId, threadId)), { title }, { merge: true });
}

/** Firestore hard-caps a writeBatch at 500 ops; chunk under that so a thread with
 *  hundreds of messages can't blow the limit and throw on commit(). */
const BATCH_CHUNK = 450;

export async function deleteThreadAndMessages(companyId: string, threadId: string): Promise<void> {
  const db = getDb();
  const msgs = await getDocs(
    query(collection(db, paths.chat(companyId)), where('threadId', '==', threadId)),
  );
  // Delete messages in chunked batches, then remove the thread doc last in its own batch.
  const refs = msgs.docs.map((d) => d.ref);
  for (let i = 0; i < refs.length; i += BATCH_CHUNK) {
    const batch = writeBatch(db);
    for (const ref of refs.slice(i, i + BATCH_CHUNK)) batch.delete(ref);
    await batch.commit();
  }
  const finalBatch = writeBatch(db);
  finalBatch.delete(doc(db, paths.thread(companyId, threadId)));
  await finalBatch.commit();
}

/**
 * One-time migration: fold a company's pre-threads flat `chat/*` into a single
 * "first conversation" thread. Caller guarantees threads are empty. Returns the
 * created thread, or null if there were no legacy messages.
 */
async function backfillLegacyThread(companyId: string): Promise<ThreadMeta | null> {
  const db = getDb();
  const legacySnap = await getDocs(
    query(collection(db, paths.chat(companyId)), orderBy('createdAt', 'asc')),
  );
  const legacy = legacySnap.docs.map((d) => d.data() as ChatMessageDoc);
  if (!needsBackfill(0, legacy.length)) return null;

  const id = crypto.randomUUID();
  const thread: ThreadMeta = {
    id,
    title: deriveThreadTitle(legacy[0].text),
    createdAt: legacy[0].createdAt,
    updatedAt: legacy[legacy.length - 1].createdAt,
  };
  // Chunk into batches of at most BATCH_CHUNK ops (Firestore's hard cap is 500 per
  // batch): the thread doc set (once, in the first batch) + one `{threadId}` merge
  // per legacy message.
  let i = 0;
  {
    const batch = writeBatch(db);
    batch.set(doc(db, paths.thread(companyId, id)), thread);
    const slice = legacy.slice(0, BATCH_CHUNK - 1);
    slice.forEach((m) =>
      batch.set(doc(db, paths.chatMessage(companyId, m.id)), { threadId: id }, { merge: true }),
    );
    await batch.commit();
    i = slice.length;
  }
  while (i < legacy.length) {
    const batch = writeBatch(db);
    const slice = legacy.slice(i, i + BATCH_CHUNK);
    slice.forEach((m) =>
      batch.set(doc(db, paths.chatMessage(companyId, m.id)), { threadId: id }, { merge: true }),
    );
    await batch.commit();
    i += slice.length;
  }
  return thread;
}

/** Persist the user's current roadmap position so they return to where they left off. */
export async function persistRoadmapStage(companyId: string, stage: number): Promise<void> {
  await updateDoc(doc(getDb(), paths.company(companyId)), {
    roadmapStage: stage,
    updatedAt: Date.now(),
  });
}

/** Persist the business brief on its own (e.g. after the founder advances a stage). */
export async function persistBrief(companyId: string, brief: CompanyBrief): Promise<void> {
  await updateDoc(doc(getDb(), paths.company(companyId)), {
    brief: clean(brief),
    updatedAt: Date.now(),
  });
}

/**
 * Return the company's ingest token, minting + persisting one on first use. The
 * local installer bakes this into the machine's hook config so /api/track can
 * attribute pushed events to the right company.
 */
export async function ensureIngestToken(companyId: string): Promise<string> {
  const db = getDb();
  const ref = doc(db, paths.company(companyId));
  const snap = await getDoc(ref);
  const existing = snap.data()?.ingestToken;
  if (typeof existing === 'string' && existing) return existing;
  const token = crypto.randomUUID().replace(/-/g, '');
  await updateDoc(ref, { ingestToken: token, updatedAt: Date.now() });
  return token;
}

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

/**
 * Read the company's recent Claude Code activity (last ~200 session events) and
 * roll it up into the numbers the Summary shows. Best-effort: any read failure
 * (rules, offline, empty collection) yields the empty summary so the UI just
 * falls back to its DEPTS-derived view instead of erroring.
 */
export async function loadTrackingSummary(companyId: string): Promise<TrackingSummary> {
  try {
    const db = getDb();
    const snap = await getDocs(
      query(collection(db, paths.trackEvents(companyId)), orderBy('ts', 'desc'), limit(200)),
    );
    const events = snap.docs.map((d) => d.data() as TrackEvent);
    return aggregateTracking(events, Date.now() - THIRTY_DAYS);
  } catch {
    return EMPTY_TRACKING;
  }
}

/** Today's AI-run count for the company (the daily cost-guard counter), or 0 if none yet. */
export async function loadTodayUsage(companyId: string): Promise<number> {
  const snap = await getDoc(doc(getDb(), `companies/${companyId}/usage/${dayKey(new Date())}`));
  const n = snap.exists() ? (snap.data() as { n?: unknown }).n : 0;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

/** Local projects for the Build Coach's "Which project?" picker. Prefers the
 *  list synced by the scan CLI (POST /api/projects); falls back to the repos the
 *  tracker has seen. Empty on any error or when neither source has data. */
export async function loadProjects(companyId: string): Promise<string[]> {
  try {
    const db = getDb();
    const companySnap = await getDoc(doc(db, paths.company(companyId)));
    const scanned = (companySnap.data()?.projects ?? []) as ScannedProject[];
    if (scanned.length > 0) return projectNames(scanned);
    // Fallback: distinct repos the tracker reported.
    const snap = await getDocs(
      query(collection(db, paths.trackEvents(companyId)), orderBy('ts', 'desc'), limit(200)),
    );
    return distinctProjects(snap.docs.map((d) => d.data() as TrackEvent));
  } catch {
    return [];
  }
}

/** Local projects with their absolute paths, for arming a build session (the
 *  picker shows names; arming needs the dir to `cd` into). Empty on any error. */
export async function loadProjectDirs(companyId: string): Promise<ScannedProject[]> {
  try {
    const db = getDb();
    const companySnap = await getDoc(doc(db, paths.company(companyId)));
    return (companySnap.data()?.projects ?? []) as ScannedProject[];
  } catch {
    return [];
  }
}

/** Live-subscribe to a build session's activity doc. Returns an unsubscribe fn;
 *  the callback fires with null before the first event arrives or on any error. */
export function subscribeLiveBuild(
  companyId: string,
  buildSessionId: string,
  cb: (state: LiveState | null) => void,
): () => void {
  const ref = doc(getDb(), paths.liveBuild(companyId, buildSessionId));
  return onSnapshot(
    ref,
    (snap) => cb(snap.exists() ? (snap.data() as LiveState) : null),
    () => cb(null),
  );
}

/** The most recent SessionEnd rollup for a given session id (drives END recap). */
export async function loadTrackEventForSession(
  companyId: string,
  sessionId: string,
): Promise<TrackEvent | null> {
  try {
    const db = getDb();
    const rows = await getDocs(
      query(collection(db, paths.trackEvents(companyId)), where('sessionId', '==', sessionId)),
    );
    const events = rows.docs.map((d) => d.data() as TrackEvent);
    events.sort((a, b) => b.ts - a.ts);
    return events[0] ?? null;
  } catch {
    return null;
  }
}

/** Append a small note to the company notebook (Build Coach END "write to memory"). */
export async function writeNotebookNote(
  companyId: string,
  note: { buildSessionId: string; doneLooks: string; wins: string[] },
): Promise<void> {
  await addDoc(collection(getDb(), paths.notebook(companyId)), { ...note, ts: Date.now() });
}

/**
 * Mark onboarding complete. Stamps `onboardedAt` so the wizard never shows again,
 * and (when provided) persists the business brief captured during onboarding.
 * Called for both "finish" and "skip" so the decision is remembered either way.
 */
export async function completeOnboarding(companyId: string, brief?: CompanyBrief): Promise<void> {
  const db = getDb();
  const now = Date.now();
  const ref = doc(db, paths.company(companyId));
  await updateDoc(
    ref,
    brief
      ? { onboardedAt: now, updatedAt: now, brief: clean(brief) }
      : { onboardedAt: now, updatedAt: now },
  );
}

// ---- seed personalization (Phase 5.3) ----
/** Personalized text fields byte returns from /api/personalize, keyed by dept. */
export interface PersonalizedDept {
  k: string;
  need: string;
  byte: string;
  tasks: Array<{ t: string; d: string }>;
}

/**
 * Merge byte's personalized text onto the DEPTS singleton in place. ONLY the text
 * fields (`need`, `byte`, and each task's `t`/`d`) are touched — status, pend, run
 * kind, `out` fallback, and all rich payloads stay exactly as seeded. Matching is by
 * department key + task index; mismatched keys/lengths are skipped (the server
 * already validates, this is defensive). Returns the depts that changed.
 */
export function applyPersonalization(generated: PersonalizedDept[]): Dept[] {
  const changed: Dept[] = [];
  for (const g of generated) {
    const dept = DEPTS.find((d) => d.k === g.k);
    if (!dept || !Array.isArray(g.tasks) || g.tasks.length !== dept.tasks.length) continue;
    if (typeof g.need === 'string' && g.need.trim()) dept.need = g.need;
    if (typeof g.byte === 'string' && g.byte.trim()) dept.byte = g.byte;
    dept.tasks.forEach((task, i) => {
      const gt = g.tasks[i];
      if (!gt) return;
      if (typeof gt.t === 'string' && gt.t.trim()) task.t = gt.t;
      if (typeof gt.d === 'string' && gt.d.trim()) task.d = gt.d;
    });
    changed.push(dept);
  }
  return changed;
}

// ---- stage scaffold (Part 1) ----
export interface ScaffoldTask {
  t: string;
  d: string;
  who: string;
  kind: string;
}
export interface ScaffoldDept {
  k: string;
  active: boolean;
  need: string;
  byte: string;
  tasks: ScaffoldTask[];
}

/**
 * Replace the seed company with byte's stage-appropriate scaffold, in place on the
 * DEPTS singleton. For each department: set need/byte, and either install the
 * generated tasks (active) or clear them and mark the dept `later` (dormant). Returns
 * the depts that changed so the caller can persist + re-render.
 */
export function applyScaffold(generated: ScaffoldDept[]): Dept[] {
  const changed: Dept[] = [];
  for (const g of generated) {
    const dept = DEPTS.find((d) => d.k === g.k);
    if (!dept) continue;
    if (typeof g.need === 'string' && g.need.trim()) dept.need = g.need;
    if (typeof g.byte === 'string' && g.byte.trim()) dept.byte = g.byte;

    const tasks = g.active && Array.isArray(g.tasks) ? g.tasks : [];
    const usable = tasks.filter(
      (t) => t && typeof t.t === 'string' && t.t.trim() && typeof t.kind === 'string',
    );
    if (g.active && usable.length) {
      dept.tasks = usable.map((t) => ({
        t: t.t,
        d: typeof t.d === 'string' ? t.d : '',
        who: (['does', 'draft', 'you'].includes(t.who)
          ? t.who
          : 'does') as Dept['tasks'][number]['who'],
        kind: t.kind,
        out: '',
        done: false,
      }));
      dept.later = false;
      dept.pend = dept.tasks.length;
      dept.status = 'attention';
    } else {
      // Dormant — no work yet at this stage.
      dept.tasks = [];
      dept.later = true;
      dept.pend = 0;
      dept.status = 'idle';
    }
    changed.push(dept);
  }
  return changed;
}

/** Persist byte's stage scaffold; stamp `scaffoldedAt` so returning users hydrate it. */
export async function persistScaffold(companyId: string, depts: Dept[]): Promise<void> {
  if (!depts.length) return;
  const db = getDb();
  const now = Date.now();
  const batch = writeBatch(db);
  for (const dept of depts) {
    batch.set(doc(db, paths.department(companyId, dept.k)), serializeDept(dept));
  }
  batch.update(doc(db, paths.company(companyId)), { scaffoldedAt: now, updatedAt: now });
  await batch.commit();
}

/**
 * Persist the personalized departments and stamp `personalizedAt` so it's a one-time
 * pass: returning users hydrate these docs via loadCompanyData and never regenerate.
 */
export async function persistPersonalization(companyId: string, depts: Dept[]): Promise<void> {
  if (!depts.length) return;
  const db = getDb();
  const now = Date.now();
  const batch = writeBatch(db);
  for (const dept of depts) {
    batch.set(doc(db, paths.department(companyId, dept.k)), serializeDept(dept));
  }
  batch.update(doc(db, paths.company(companyId)), { personalizedAt: now, updatedAt: now });
  await batch.commit();
}

/**
 * Persist byte's one-time project analysis and stamp `analyzedAt` so it never
 * regenerates (returning users hydrate it via loadCompanyData).
 */
export async function persistProjectAnalysis(
  companyId: string,
  analysis: ProjectAnalysis,
): Promise<void> {
  const now = Date.now();
  await updateDoc(doc(getDb(), paths.company(companyId)), {
    projectAnalysis: analysis,
    analyzedAt: now,
    updatedAt: now,
  });
}

// ---- write-through ----
/** Persist a single department's current tasks (e.g. after byte produces a draft,
 * so the task's `drafted` flag + draft payload survive reload). Members may write
 * department docs, so no rules change is needed. Optimistic: the in-memory task
 * already updated; this write-through can fail without breaking the session. */
export async function persistDepartmentTasks(companyId: string, dept: Dept): Promise<void> {
  await setDoc(doc(getDb(), paths.department(companyId, dept.k)), serializeDept(dept), {
    merge: true,
  });
}

/** Persist a task approval: the updated department doc + a new library item. */
export async function persistApproval(
  companyId: string,
  dept: Dept,
  libItem: LibItem,
  createdAt: number,
): Promise<void> {
  const db = getDb();
  const id = `${dept.k}-${createdAt}`;
  const batch = writeBatch(db);
  batch.set(doc(db, paths.department(companyId, dept.k)), serializeDept(dept));
  batch.set(doc(db, paths.libraryItem(companyId, id)), clean({ ...libItem, id, createdAt }));
  await batch.commit();
}

/** Persist the current ENV toggle state. */
export async function persistEnv(companyId: string, env: EnvState): Promise<void> {
  const db = getDb();
  await updateDoc(doc(db, paths.company(companyId)), { env, updatedAt: Date.now() });
}

/** A founder-initiated support message → the existing `feedback` collection (kind:'support'). */
export async function sendSupportMessage(msg: string, name: string, email: string): Promise<void> {
  await addDoc(collection(getDb(), 'feedback'), {
    kind: 'support',
    message: msg.trim(),
    name,
    email,
    ts: Date.now(),
  });
}
