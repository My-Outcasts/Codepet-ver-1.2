// The Overview roadmap, phase 1 — the canonical company-building journey.
//
// Like the "How to Build a Company" reference, the roadmap is a fixed playbook every
// founder follows: six phases, each recruiting multiple departments, tasks that unlock the
// next. A founder's real progress overlays onto this via task state (a later step wires the
// live done/available/current values off DEPTS + /api/next-step). Progress is derived by
// applyProgress (roadmapProgress.ts) from the founder's position, so tasks carry no state here.
//
// Note the phases run Find → Foundation → Build → Ship → Launch → Grow — Foundation is the
// company shell (incorporate, bank, brand) the product-shaped phases used to skip.
import type { RoadmapPhase, RoadmapTaskDef } from './roadmapModel';

export const ROADMAP_PHASES: RoadmapPhase[] = [
  { key: 'find', name: 'Find' },
  { key: 'foundation', name: 'Foundation' },
  { key: 'build', name: 'Build' },
  { key: 'ship', name: 'Ship' },
  { key: 'launch', name: 'Launch' },
  { key: 'grow', name: 'Run & grow' },
];

// Department keys match lib/data.ts DEPTS: eng · mkt · ops · fin · legal · design · sales · support.
export const ROADMAP_TEMPLATE: RoadmapTaskDef[] = [
  // Find — the business bet
  {
    id: 'find-validate',
    phase: 'find',
    dept: 'mkt',
    title: 'Validate the idea',
    dependsOn: [],
  },
  {
    id: 'find-audience',
    phase: 'find',
    dept: 'mkt',
    title: 'Name your audience',
    dependsOn: ['find-validate'],
  },

  // Foundation — the company shell
  {
    id: 'found-incorporate',
    phase: 'foundation',
    dept: 'legal',
    title: 'Incorporate LLC',
    dependsOn: ['find-validate'],
  },
  {
    id: 'found-bank',
    phase: 'foundation',
    dept: 'fin',
    title: 'Business bank account',
    dependsOn: ['found-incorporate'],
  },
  {
    id: 'found-brand',
    phase: 'foundation',
    dept: 'design',
    title: 'Brand & voice',
    dependsOn: ['find-audience'],
  },

  // Build — the product
  {
    id: 'build-core',
    phase: 'build',
    dept: 'eng',
    title: 'Core product flow',
    dependsOn: ['found-brand'],
  },
  {
    id: 'build-onboard',
    phase: 'build',
    dept: 'ops',
    title: 'User onboarding',
    dependsOn: ['build-core'],
  },
  {
    id: 'build-auth',
    phase: 'build',
    dept: 'eng',
    title: 'Auth & accounts',
    dependsOn: ['build-core'],
  },

  // Ship — get ready to launch (byte is here)
  {
    id: 'ship-site',
    phase: 'ship',
    dept: 'mkt',
    title: 'Landing site',
    dependsOn: ['build-core'],
  },
  {
    id: 'ship-billing',
    phase: 'ship',
    dept: 'fin',
    title: 'Set up billing',
    dependsOn: ['build-auth'],
  },
  {
    id: 'ship-terms',
    phase: 'ship',
    dept: 'legal',
    title: 'Terms & privacy',
    dependsOn: ['found-incorporate'],
  },
  {
    id: 'ship-help',
    phase: 'ship',
    dept: 'support',
    title: 'Stand up help center',
    dependsOn: ['build-onboard'],
  },

  // Launch — ship it
  {
    id: 'launch-campaign',
    phase: 'launch',
    dept: 'mkt',
    title: 'Launch campaign',
    dependsOn: ['ship-billing', 'ship-site'],
  },
  {
    id: 'launch-app',
    phase: 'launch',
    dept: 'eng',
    title: 'Launch app',
    dependsOn: ['ship-billing'],
  },
  {
    id: 'launch-sales',
    phase: 'launch',
    dept: 'sales',
    title: 'First sales outreach',
    dependsOn: ['ship-help'],
  },

  // Run & grow — acquisition + operations
  {
    id: 'grow-pipeline',
    phase: 'grow',
    dept: 'sales',
    title: 'Sales pipeline',
    dependsOn: ['launch-sales'],
  },
  {
    id: 'grow-seo',
    phase: 'grow',
    dept: 'mkt',
    title: 'SEO content engine',
    dependsOn: ['launch-campaign'],
  },
  {
    id: 'grow-hire',
    phase: 'grow',
    dept: 'ops',
    title: 'Hire first contractor',
    dependsOn: ['launch-app'],
  },
];

/** Human-readable department names for the card chips. Keys match DEPTS. */
export const DEPT_LABEL: Record<string, string> = {
  eng: 'Engineering',
  mkt: 'Marketing',
  ops: 'Operations',
  fin: 'Finance',
  legal: 'Legal',
  design: 'Design',
  sales: 'Sales',
  support: 'Support',
};

/** Department accent colors for the chip dots — a categorical palette kept distinct from
 *  the task-STATE colors (state lives on the badge, department on the chip). */
export const DEPT_COLOR: Record<string, string> = {
  eng: '#6366f1',
  mkt: '#f97316',
  ops: '#14b8a6',
  fin: '#eab308',
  legal: '#64748b',
  design: '#a855f7',
  sales: '#ec4899',
  support: '#06b6d4',
};
