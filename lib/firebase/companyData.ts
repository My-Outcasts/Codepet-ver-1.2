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
import { DEPTS, ENV, type Dept, type Task, type LibItem } from '../data';
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

// ---- load + hydrate ----
export interface CompanyData {
  library: LibItem[];
  brief: CompanyBrief;
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

  return { library, brief: (company?.brief ?? {}) as CompanyBrief };
}

/** Persist the business brief captured during onboarding. */
export async function saveBrief(companyId: string, brief: CompanyBrief): Promise<void> {
  const db = getDb();
  await updateDoc(doc(db, paths.company(companyId)), {
    brief: clean(brief),
    updatedAt: Date.now(),
  });
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
