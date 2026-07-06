// The golden set for the quality-eval harness: a few realistic companies and the
// deliverable cases we score them on. Fixed + versioned so runs are comparable over time.
// Pure data — the runner (scripts/eval.mts) turns each case into a real generation + judge.
import type { CompanyBrief } from '../../firebase/schema';

/** A deliverable type the eval exercises (a representative subset of the 12). */
export type EvalKind = 'doc' | 'email' | 'plan' | 'site';

export interface GoldenCase {
  /** Stable id for the case, e.g. "codepet:email". */
  id: string;
  brief: CompanyBrief;
  kind: EvalKind;
  taskTitle: string;
  taskHint?: string;
}

// Three companies with genuinely different shapes, each with a rich-enough brief that
// "generic" output has no excuse — so the grounded/specific scores mean something.
const CODEPET: CompanyBrief = {
  projectName: 'Codepet',
  founderName: 'Mona',
  role: 'Founder',
  stage: 'Pre-launch',
  summary:
    'A local-first macOS companion that recaps your Claude Code sessions and turns the terms you hit into a project-aware Dictionary you actively recall (Encountered → Used → Mastered).',
  categories: ['macOS app', 'developer tool'],
  audience: 'AI-first developers who build with Claude Code',
  goal: 'Ship the macOS beta and convert the waitlist',
  traction: '~300 on the waitlist, not launched yet',
  problem: 'Developers lose the context and vocabulary of what they built between coding sessions',
};

const FERNWEH: CompanyBrief = {
  projectName: 'Fernweh',
  founderName: 'Diego',
  role: 'Solo founder',
  stage: 'Private beta',
  summary:
    'A trip-planning app that turns a saved list of Instagram and TikTok travel posts into a day-by-day itinerary with bookable stops.',
  categories: ['mobile app', 'travel', 'consumer'],
  audience: 'Millennial and Gen-Z travelers who plan trips from social media',
  goal: 'Get 50 beta users to plan a real trip and book at least one stop',
  traction: '120 private-beta signups, 18 active, 4 trips planned so far',
  problem: 'Saved travel inspiration never becomes an actual, bookable plan',
};

const LEDGERLY: CompanyBrief = {
  projectName: 'Ledgerly',
  founderName: 'Priya',
  role: 'Technical co-founder',
  stage: 'Public beta',
  summary:
    'Bookkeeping automation for freelance designers: it reads their Stripe + bank feed and produces categorized, tax-ready quarterly summaries.',
  categories: ['SaaS', 'fintech', 'B2B'],
  audience: 'Freelance designers and small studios in the US',
  goal: 'Convert free beta users to a paid $19/mo plan before tax season',
  traction: '900 free users, ~6% weekly active, no paid tier live yet',
  problem: 'Freelancers dread quarterly taxes and overpay an accountant for basic categorization',
};

export const GOLDEN_CASES: GoldenCase[] = [
  { id: 'codepet:email', brief: CODEPET, kind: 'email', taskTitle: 'Write the launch email' },
  {
    id: 'codepet:plan',
    brief: CODEPET,
    kind: 'plan',
    taskTitle: 'Plan the waitlist-to-beta conversion flow',
  },
  { id: 'fernweh:doc', brief: FERNWEH, kind: 'doc', taskTitle: 'Decide the private-beta focus' },
  { id: 'fernweh:site', brief: FERNWEH, kind: 'site', taskTitle: 'Write the landing page copy' },
  {
    id: 'ledgerly:email',
    brief: LEDGERLY,
    kind: 'email',
    taskTitle: 'Write the free-to-paid upgrade email',
  },
  {
    id: 'ledgerly:plan',
    brief: LEDGERLY,
    kind: 'plan',
    taskTitle: 'Plan the paid-tier launch before tax season',
  },
];
