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
import type { ProjectAnalysis } from '../ai/projectAnalysis';

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
  /** byte's enriched read of the product (from "byte reads it"), when the founder's
   * inputs were rich enough to extract one. Sharper/fuller than the founder's one-liner. */
  summary?: string;
  /** Free-form details: pitch, README, PRD notes, anything pasted. */
  notes?: string;
  /** Website / repo / Figma link. */
  link?: string;
  /** Product categories (e.g. "Web app", "SaaS", "Dev tool"). */
  categories?: string[];
  /** Who the product is for (target user / customer). */
  audience?: string;
  /** The founder's immediate objective for the next few weeks — what byte should
   * plan toward. Captured by byte's first-chat enrichment (lib/ai/enrichInterview). */
  goal?: string;
  /** Where the product actually is right now: real assets and numbers (waitlist size,
   * launched or not, users, revenue, live links). Grounds Finance/Marketing in reality
   * instead of invented figures. Captured by byte's first-chat enrichment. */
  traction?: string;
  /** The core problem the product solves and who feels it — makes positioning and copy
   * specific. Captured by byte's first-chat enrichment. */
  problem?: string;
}

/** Per-company toolkit state: category → item key → enabled. Mirrors ENV in data.ts. */
export type EnvState = Record<string, Record<string, boolean>>;

/** Per-item usage: category → item name → the distinct task titles it's been used on. */
export type EnvUsage = Record<string, Record<string, string[]>>;

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
  /** byte's one-time project analysis (shown on the Overview first run). */
  projectAnalysis?: ProjectAnalysis;
  /** When the one-time project analysis ran. Absent ⇒ never analyzed. */
  analyzedAt?: Millis;
  /** Current roadmap stage number (see PHASES in lib/data.ts). */
  roadmapStage: number;
  env: EnvState;
  envUsage?: EnvUsage;
  /** Shared secret the local Claude Code hook presents to POST /api/track. Minted
   *  server-side; the installer bakes it into the machine's hook config. */
  ingestToken?: string;
  /** Local projects reported by the scan CLI (POST /api/projects) — names + paths
   *  only, never file contents. Feeds the Build Coach's "Which project?" picker. */
  projects?: ScannedProject[];
  /** When the project list was last synced by a scan. */
  projectsScannedAt?: Millis;
  createdAt: Millis;
  updatedAt: Millis;
}

/** One local git project discovered by the scan CLI. */
export interface ScannedProject {
  name: string;
  path: string;
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
  /** Which conversation thread this message belongs to. */
  threadId: string;
}

/** One conversation thread (a "history entry") for a company's byte chat. */
export interface ThreadMeta {
  id: string;
  /** Derived from the first founder message; user-renameable. */
  title: string;
  createdAt: Millis;
  /** Bumped on each new message; drives list sort + relative time. */
  updatedAt: Millis;
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
  trackEvents: (companyId: string) => `companies/${companyId}/trackEvents`,
  trackEvent: (companyId: string, eventId: string) =>
    `companies/${companyId}/trackEvents/${eventId}`,
  liveBuilds: (companyId: string) => `companies/${companyId}/liveBuilds`,
  liveBuild: (companyId: string, buildSessionId: string) =>
    `companies/${companyId}/liveBuilds/${buildSessionId}`,
  notebook: (companyId: string) => `companies/${companyId}/notebook`,
  chat: (companyId: string) => `companies/${companyId}/chat`,
  chatMessage: (companyId: string, msgId: string) => `companies/${companyId}/chat/${msgId}`,
  threads: (companyId: string) => `companies/${companyId}/threads`,
  thread: (companyId: string, threadId: string) => `companies/${companyId}/threads/${threadId}`,
};

// Re-export the shared shapes so persistence consumers import everything from one place.
export type { Dept, Task, LibItem, EnvItem };
