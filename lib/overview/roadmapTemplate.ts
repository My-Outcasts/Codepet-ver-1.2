// The Overview roadmap, phase 1 — the canonical company-building journey.
//
// Like the "How to Build a Company" reference, the roadmap is a fixed playbook every
// founder follows: six phases, each recruiting multiple departments, tasks that unlock the
// next. A founder's real progress overlays onto this via task state (a later step wires the
// live done/available/current values off DEPTS + the roadmap's own next move). Progress is derived by
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
    actor: 'you', // only the founder can sign the incorporation
    dependsOn: ['find-validate'],
  },
  {
    id: 'found-bank',
    phase: 'foundation',
    dept: 'fin',
    title: 'Business bank account',
    actor: 'you', // only the founder can open the bank account
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
    // the company exists → start building; product work doesn't wait on Brand & voice
    title: 'Core product flow',
    dependsOn: ['found-incorporate'],
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
    // depends on Auth & accounts (adjacent Build column, same row) → a clean straight
    // connector, instead of spanning back to Foundation across the Build column
    title: 'Terms & privacy',
    dependsOn: ['build-auth'],
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
  // the app's warm semantic palette (globals.css tokens) so dept dots match the rest of the app
  eng: '#2563eb', // --blue
  mkt: '#ff8c42', // --clay
  ops: '#2dd4bf', // --teal
  fin: '#fdb022', // --gold
  legal: '#64748b',
  design: '#9333ea', // --violet
  sales: '#ff6b9d', // --rose
  support: '#06b6d4',
};
