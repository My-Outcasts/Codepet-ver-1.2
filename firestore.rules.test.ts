// Emulator-based security-rules tests for firestore.rules (Phase 5.5 follow-up).
// These run against the Firestore emulator, NOT plain node — so they're excluded from
// the default vitest suite and run via `npm run test:rules` (which boots the emulator
// through `firebase emulators:exec`). They lock the multi-tenancy guarantees from 5.1:
// an account only ever touches its own company, ownership can't be reassigned, members
// can't escalate, and the iOS users/feedback rules still hold.
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

const ALICE = 'alice';
const BOB = 'bob';

// A minimal valid company doc owned by `uid` with the given members.
const company = (uid: string, memberIds: string[] = [uid]) => ({
  id: uid,
  ownerId: uid,
  memberIds,
  roles: { [uid]: 'owner' },
  name: 'Test Co',
  brief: {},
  roadmapStage: 6,
  env: {},
  createdAt: 0,
  updatedAt: 0,
});

// Seed a doc with rules bypassed (fixture setup, not under test).
async function seed(path: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-codepet-rules',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe('companies — ownership & isolation', () => {
  it('lets an owner create their own company (id == uid, owner == uid, self in members)', async () => {
    const db = testEnv.authenticatedContext(ALICE).firestore();
    await assertSucceeds(setDoc(doc(db, 'companies/alice'), company(ALICE)));
  });

  it('rejects creating a company under someone else’s uid', async () => {
    const db = testEnv.authenticatedContext(ALICE).firestore();
    await assertFails(setDoc(doc(db, 'companies/bob'), company(BOB)));
  });

  it('rejects create where ownerId isn’t the caller', async () => {
    const db = testEnv.authenticatedContext(ALICE).firestore();
    await assertFails(setDoc(doc(db, 'companies/alice'), { ...company(ALICE), ownerId: BOB }));
  });

  it('rejects create where the caller isn’t in memberIds', async () => {
    const db = testEnv.authenticatedContext(ALICE).firestore();
    await assertFails(setDoc(doc(db, 'companies/alice'), company(ALICE, [BOB])));
  });

  it('lets the owner read their company; blocks a stranger', async () => {
    await seed('companies/alice', company(ALICE));
    const alice = testEnv.authenticatedContext(ALICE).firestore();
    const bob = testEnv.authenticatedContext(BOB).firestore();
    await assertSucceeds(getDoc(doc(alice, 'companies/alice')));
    await assertFails(getDoc(doc(bob, 'companies/alice')));
  });

  it('blocks unauthenticated reads', async () => {
    await seed('companies/alice', company(ALICE));
    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, 'companies/alice')));
  });

  it('lets the owner update company data but never reassign ownerId', async () => {
    await seed('companies/alice', company(ALICE));
    const db = testEnv.authenticatedContext(ALICE).firestore();
    await assertSucceeds(updateDoc(doc(db, 'companies/alice'), { name: 'Renamed' }));
    await assertFails(updateDoc(doc(db, 'companies/alice'), { ownerId: BOB }));
  });

  it('only the owner can delete the company', async () => {
    await seed('companies/alice', company(ALICE));
    const bob = testEnv.authenticatedContext(BOB).firestore();
    const alice = testEnv.authenticatedContext(ALICE).firestore();
    await assertFails(deleteDoc(doc(bob, 'companies/alice')));
    await assertSucceeds(deleteDoc(doc(alice, 'companies/alice')));
  });
});

describe('companies — members can’t escalate', () => {
  // A team company owned by alice with bob as a plain member.
  beforeEach(async () => {
    await seed('companies/alice', company(ALICE, [ALICE, BOB]));
  });

  it('a member may edit data but not the member list', async () => {
    const bob = testEnv.authenticatedContext(BOB).firestore();
    await assertSucceeds(updateDoc(doc(bob, 'companies/alice'), { name: 'Bob edit' }));
    await assertFails(updateDoc(doc(bob, 'companies/alice'), { memberIds: [ALICE, BOB, 'carol'] }));
  });

  it('a member cannot make themselves owner', async () => {
    const bob = testEnv.authenticatedContext(BOB).firestore();
    await assertFails(updateDoc(doc(bob, 'companies/alice'), { ownerId: BOB }));
  });

  it('a member cannot delete the company', async () => {
    const bob = testEnv.authenticatedContext(BOB).firestore();
    await assertFails(deleteDoc(doc(bob, 'companies/alice')));
  });
});

describe('companies — subcollections are scoped to the company', () => {
  beforeEach(async () => {
    await seed('companies/alice', company(ALICE));
  });

  it('the owner can read/write departments, chat, library; a stranger cannot', async () => {
    const alice = testEnv.authenticatedContext(ALICE).firestore();
    const bob = testEnv.authenticatedContext(BOB).firestore();
    await assertSucceeds(setDoc(doc(alice, 'companies/alice/departments/eng'), { k: 'eng' }));
    await assertSucceeds(setDoc(doc(alice, 'companies/alice/chat/m1'), { role: 'me', text: 'hi' }));
    await assertFails(setDoc(doc(bob, 'companies/alice/departments/eng'), { k: 'eng' }));
    await assertFails(getDoc(doc(bob, 'companies/alice/chat/m1')));
  });
});

describe('iOS rules — users & feedback still hold', () => {
  it('a user owns their profile doc and nested docs; others are blocked', async () => {
    const alice = testEnv.authenticatedContext(ALICE).firestore();
    const bob = testEnv.authenticatedContext(BOB).firestore();
    await assertSucceeds(setDoc(doc(alice, 'users/alice'), { email: 'a@x.com' }));
    await assertSucceeds(setDoc(doc(alice, 'users/alice/extensions/cursor'), { v: 1 }));
    await assertFails(setDoc(doc(bob, 'users/alice'), { email: 'hacked' }));
    await assertFails(getDoc(doc(bob, 'users/alice')));
  });

  it('feedback accepts a valid payload, rejects bad ratings, and is never readable', async () => {
    const db = testEnv.authenticatedContext(ALICE).firestore();
    await assertSucceeds(setDoc(doc(db, 'feedback/f1'), { rating: 5, feature: 'chat' }));
    await assertFails(setDoc(doc(db, 'feedback/f2'), { rating: 6, feature: 'chat' }));
    await assertFails(setDoc(doc(db, 'feedback/f3'), { rating: 'five', feature: 'chat' }));
    await seed('feedback/f4', { rating: 4, feature: 'x' });
    await assertFails(getDoc(doc(db, 'feedback/f4')));
  });
});
