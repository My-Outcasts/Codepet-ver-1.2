'use client';
// Company bootstrap + seeding. On a user's first sign-in we create their user
// document and a personal company seeded from the in-memory DEPTS catalog, so the
// app has real persisted data to read in Phase 2. All writes go through a single
// batch so a company is never half-created.
import { doc, getDoc, writeBatch, arrayUnion, type Firestore } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { getDb } from './client';
import { DEPTS, ENV } from '../data';
import { artType, artMeta } from '../helpers';
import {
  paths,
  type DepartmentDoc,
  type LibraryDoc,
  type CompanyDoc,
  type EnvState,
} from './schema';

// Titles pre-approved into the seeded Library (mirrors the demo's seedLibrary).
const SEED_LIBRARY_TITLES = [
  'Build the Codepet landing page',
  'Write the launch announcement post',
  'Build the waitlist conversion email',
  'Instrument the dual go/no-go signal',
  'Set up the TestFlight beta',
];

function seedDepartments(): DepartmentDoc[] {
  // Deep clone so the module-level DEPTS seed is never mutated.
  return structuredClone(DEPTS) as DepartmentDoc[];
}

// Default toolkit state from ENV: an item is "on" when its `s` flag is set.
function seedEnvState(): EnvState {
  const state: EnvState = {};
  for (const [category, items] of Object.entries(ENV)) {
    state[category] = {};
    for (const item of items) state[category][item.n] = item.s === 1;
  }
  return state;
}

function seedLibrary(): LibraryDoc[] {
  const now = Date.now();
  const out: LibraryDoc[] = [];
  for (const title of SEED_LIBRARY_TITLES) {
    for (const dep of DEPTS) {
      const t = dep.tasks.find((x) => x.t === title);
      if (!t) continue;
      const type = artType(t);
      const { file, head, tag } = artMeta(t, type);
      out.push({
        id: `${dep.k}-${out.length}`,
        createdAt: now,
        title: t.t,
        dept: dep.name,
        k: dep.k,
        ab: dep.ab,
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
      });
      break;
    }
  }
  return out;
}

/** Strip undefined values — Firestore rejects them. */
function clean<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

async function createCompanyForUser(db: Firestore, user: User): Promise<string> {
  const companyId = user.uid; // one company per user for v1; stable, owner-scoped id.
  const now = Date.now();
  const batch = writeBatch(db);

  const company: CompanyDoc = {
    id: companyId,
    ownerId: user.uid,
    memberIds: [user.uid],
    roles: { [user.uid]: 'owner' },
    name: user.displayName ? `${user.displayName}'s company` : 'My company',
    brief: {},
    roadmapStage: 6,
    env: seedEnvState(),
    createdAt: now,
    updatedAt: now,
  };
  batch.set(doc(db, paths.company(companyId)), company);

  for (const dept of seedDepartments()) {
    batch.set(doc(db, paths.department(companyId, dept.k)), clean(dept));
  }
  for (const item of seedLibrary()) {
    batch.set(doc(db, paths.libraryItem(companyId, item.id)), clean(item));
  }

  batch.set(
    doc(db, paths.user(user.uid)),
    {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      companyIds: arrayUnion(companyId),
      updatedAt: now,
    },
    { merge: true },
  );

  await batch.commit();
  return companyId;
}

/**
 * Ensure the signed-in user has a bootstrapped user doc + seeded company.
 * Idempotent: returns the existing primary companyId if already set up.
 */
export async function ensureUserBootstrap(user: User): Promise<string> {
  const db = getDb();
  const userSnap = await getDoc(doc(db, paths.user(user.uid)));
  const existing = userSnap.data()?.companyIds as string[] | undefined;
  if (existing && existing.length > 0) return existing[0];
  return createCompanyForUser(db, user);
}
