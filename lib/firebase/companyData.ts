'use client';
// Phase 2 persistence layer. Reads a company's live state from Firestore and
// writes mutations through. The app keeps its mutate-in-place + `tick` re-render
// model: these helpers HYDRATE the module-level DEPTS/ENV singletons from
// Firestore on load and PERSIST changes after each in-memory mutation, so the
// view layer (which imports DEPTS/ENV directly) needs no changes.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { getDb } from './client';
import { DEPTS, ENV, DEPTS_SEED, ENV_SEED, byN, type Dept, type Task, type LibItem } from '../data';
import {
  paths,
  type DepartmentDoc,
  type LibraryDoc,
  type EnvState,
  type CompanyBrief,
} from './schema';

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
  /** Last-selected roadmap stage; undefined ⇒ none saved (use the UI default). */
  roadmapStage?: number;
}

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
    roadmapStage: validStage(company?.roadmapStage),
  };
}

/** Persist the user's current roadmap position so they return to where they left off. */
export async function persistRoadmapStage(companyId: string, stage: number): Promise<void> {
  await updateDoc(doc(getDb(), paths.company(companyId)), {
    roadmapStage: stage,
    updatedAt: Date.now(),
  });
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
