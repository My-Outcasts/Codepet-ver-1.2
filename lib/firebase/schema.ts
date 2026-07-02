// Firestore data model for Codepet. The persistence boundary: the in-memory
// shapes in lib/data.ts (Dept, Task, LibItem, EnvItem) become per-company
// documents here. Phase 2 swaps the store's in-memory mutations for reads/writes
// against these collections; the view layer keeps consuming the same Dept/Task/
// LibItem shapes.
//
// Layout
//   users/{uid}                              → UserDoc (profile + company membership)
//   companies/{companyId}                    → CompanyDoc (brief, roadmap stage, env state)
//   companies/{companyId}/departments/{k}    → DepartmentDoc (one per department key)
//   companies/{companyId}/library/{itemId}   → LibraryDoc (approved deliverables)
import type { Dept, Task, LibItem, EnvItem } from '../data';

// Firestore server timestamps arrive as Timestamp objects; we store millis on
// write for portability and treat them as numbers everywhere in app code.
export type Millis = number;

export interface UserDoc {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  /** Companies this user belongs to. First entry is their primary/active company. */
  companyIds: string[];
  createdAt: Millis;
  updatedAt: Millis;
}

/** Onboarding answers + derived business brief (see OB_* in lib/data.ts). */
export interface CompanyBrief {
  founderName?: string;
  role?: string;
  tech?: string;
  stage?: string;
  projectName?: string;
  /** One-sentence description of the product (highest-signal field for byte). */
  oneLiner?: string;
  /** Free-form details: pitch, README, PRD notes, anything pasted. */
  notes?: string;
  /** Website / repo / Figma link. */
  link?: string;
  /** Product categories (e.g. "Web app", "SaaS", "Dev tool"). */
  categories?: string[];
  /** Who the product is for (target user / customer). */
  audience?: string;
}

/** Per-company toolkit state: category → item key → enabled. Mirrors ENV in data.ts. */
export type EnvState = Record<string, Record<string, boolean>>;

export interface CompanyDoc {
  id: string;
  ownerId: string;
  /** Flat list for security-rule membership checks. */
  memberIds: string[];
  /** uid → role, for richer permissions later. */
  roles: Record<string, 'owner' | 'member'>;
  name: string;
  brief: CompanyBrief;
  /** When onboarding was completed (or skipped). Absent ⇒ never onboarded. */
  onboardedAt?: Millis;
  /** When byte's one-time seed personalization ran. Absent ⇒ never personalized. */
  personalizedAt?: Millis;
  /** Current roadmap stage number (see PHASES in lib/data.ts). */
  roadmapStage: number;
  env: EnvState;
  createdAt: Millis;
  updatedAt: Millis;
}

/** One department document. Tasks are stored inline (bounded, ~handful each). */
export interface DepartmentDoc {
  k: Dept['k'];
  name: string;
  ab: string;
  status: Dept['status'];
  pend: number;
  need: string;
  byte: string;
  tasks: Task[];
  later?: boolean;
}

/** An approved deliverable saved to the company Library. */
export interface LibraryDoc extends LibItem {
  id: string;
  createdAt: Millis;
}

/** One byte-chat message. 'me' = the founder, 'byte' = the companion. */
export interface ChatMessageDoc {
  id: string;
  role: 'me' | 'byte';
  text: string;
  createdAt: Millis;
}

// ---- Collection / document path helpers (single source of truth) ----
export const paths = {
  user: (uid: string) => `users/${uid}`,
  users: () => `users`,
  company: (companyId: string) => `companies/${companyId}`,
  companies: () => `companies`,
  departments: (companyId: string) => `companies/${companyId}/departments`,
  department: (companyId: string, k: string) => `companies/${companyId}/departments/${k}`,
  library: (companyId: string) => `companies/${companyId}/library`,
  libraryItem: (companyId: string, itemId: string) => `companies/${companyId}/library/${itemId}`,
  chat: (companyId: string) => `companies/${companyId}/chat`,
  chatMessage: (companyId: string, msgId: string) => `companies/${companyId}/chat/${msgId}`,
};

// Re-export the shared shapes so persistence consumers import everything from one place.
export type { Dept, Task, LibItem, EnvItem };
