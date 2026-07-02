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
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { LiveState } from '../liveBuild';
import { getDb } from './client';
import { DEPTS, ENV, type Dept, type Task, type LibItem } from '../data';
import {
  paths,
  type DepartmentDoc,
  type LibraryDoc,
  type EnvState,
  type CompanyBrief,
  type ScannedProject,
} from './schema';
import { projectNames } from '../projects';
import {
  aggregateTracking,
  distinctProjects,
  EMPTY_TRACKING,
  type TrackEvent,
  type TrackingSummary,
} from '../tracking';

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
function applyEnvState(env: EnvState): void {
  for (const [category, items] of Object.entries(ENV)) {
    const saved = env[category];
    if (!saved) continue;
    for (const item of items) {
      if (item.n in saved) item.s = saved[item.n] ? 1 : 0;
    }
  }
}

/** Merge persisted departments onto the DEPTS singleton (by department key). */
function applyDepartments(departments: DepartmentDoc[]): void {
  for (const loaded of departments) {
    const existing = DEPTS.find((d) => d.k === loaded.k);
    if (existing) Object.assign(existing, loaded);
  }
}

// ---- load + hydrate ----
export interface CompanyData {
  library: LibItem[];
  brief: CompanyBrief;
  /** When onboarding was completed; undefined ⇒ the user hasn't onboarded yet. */
  onboardedAt?: number;
}

/**
 * Load the company's persisted state and hydrate the DEPTS/ENV singletons in
 * place. Returns the library + business brief (which the store owns as state).
 */
export async function loadCompanyData(companyId: string): Promise<CompanyData> {
  const db = getDb();
  const [deptSnap, libSnap, companySnap] = await Promise.all([
    getDocs(collection(db, paths.departments(companyId))),
    getDocs(query(collection(db, paths.library(companyId)), orderBy('createdAt', 'desc'))),
    getDoc(doc(db, paths.company(companyId))),
  ]);

  applyDepartments(deptSnap.docs.map((d) => d.data() as DepartmentDoc));
  const company = companySnap.data();
  applyEnvState((company?.env ?? {}) as EnvState);

  const library = libSnap.docs.map((d) => {
    // Strip persistence-only fields so the shape matches the in-app LibItem.
    const { id, createdAt, ...item } = d.data() as LibraryDoc;
    void id;
    void createdAt;
    return item as LibItem;
  });

  return {
    library,
    brief: (company?.brief ?? {}) as CompanyBrief,
    onboardedAt: company?.onboardedAt as number | undefined,
  };
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

// ---- write-through ----
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
