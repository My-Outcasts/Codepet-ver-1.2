// Reusable per-department foundations: real expertise + stage-aware focus that the
// generation prompts read from, so byte's tasks (/api/scaffold) and deliverables
// (/api/run-task) come from an operator's brain tuned to the founder's stage — not a
// one-line role hint. Static, curated data (no runtime generation). Keys match the 8
// fixed departments; stageFocus keys match OB_STAGES.

export interface DepartmentFoundation {
  /** 2–3 sentences: what this function owns and what "winning" looks like. */
  mandate: string;
  /** Core competencies this function works from. */
  skills: string[];
  /** One focus line per OB_STAGES value — what to prioritize at that stage. */
  stageFocus: Record<string, string>;
  /** The founder mistakes this function guards against — sharpens byte's judgment. */
  antipatterns: string[];
}

export const DEPARTMENT_FOUNDATIONS: Record<string, DepartmentFoundation> = {
  eng: {
    mandate:
      "Engineering builds the product itself — turning the founder's idea into something real people can use, then keeping it stable enough to trust as usage grows. Winning is shipping the smallest thing that proves the core value, then hardening only what real usage demands — never gold-plating ahead of need.",
    skills: [
      'scoping an MVP to its riskiest assumption',
      'system and data-model design',
      'shipping cadence and cutting scope',
      'instrumentation and error monitoring',
      'technical-debt triage',
      'performance and reliability under load',
    ],
    stageFocus: {
      'Just an idea':
        "Prove the single riskiest technical assumption with the crudest possible spike: is the core thing even buildable? Don't build anything you'd keep.",
      Prototype:
        'Build the one core flow end-to-end, ugly but real, so it can go in front of a person. Instrument just enough to see if it works.',
      'Private beta':
        "Make that core flow reliable for a handful of hand-held users; add enough logging and error capture to learn fast. Fix what breaks, ignore what doesn't.",
      'Public beta':
        'Harden the paths real users actually hit; kill the crash and data-loss bugs; make signup-to-value work without you in the room.',
      Launched:
        "The boring reliability work — monitoring, backups, on-call basics — so growth doesn't break trust. Pay down the debt that's now slowing you.",
      Growing:
        'Scale the parts actually straining (not the ones you fear), and build the second and third features that deepen retention — sequenced by evidence, not wishlist.',
    },
    antipatterns: [
      "building infrastructure for scale you don't have yet",
      'polishing code quality before the product is validated',
      "adding features instead of fixing the core flow that isn't landing",
      'rewrites when a targeted fix would do',
    ],
  },
  design: {
    mandate:
      "Design owns how the product feels to use — the path from first touch to value, and whether it's clear enough that people succeed without help. Winning is a first-run where a new user reaches the core value fast and understands what happened, so they come back.",
    skills: [
      'user flows and information architecture',
      'first-run and onboarding design',
      'interaction and UI craft',
      'usability testing on real users',
      'microcopy for clarity',
      'reducing steps-to-value',
    ],
    stageFocus: {
      'Just an idea':
        'Sketch the core flow as rough wireframes to pressure-test whether the idea is even usable. Paper-level, no polish.',
      Prototype:
        'Design the one core flow so a real person can attempt it unaided; watch where they get stuck.',
      'Private beta':
        'Fix the friction the first testers actually hit — the confusing step, the dead end — before adding anything. Nail the "aha" moment.',
      'Public beta':
        'Tighten first-run so a stranger reaches value without hand-holding; make empty and error states teach.',
      Launched:
        'Raise the craft bar on the paths that convert and retain; make the product feel trustworthy where it counts.',
      Growing:
        'Design the second-order journeys — habit, depth, re-engagement — and clear the accumulated rough edges slowing power users.',
    },
    antipatterns: [
      'polishing visuals before the flow works',
      'designing screens no one has tried to use',
      'adding onboarding steps instead of removing them',
      'a beautiful empty state with no path to value',
    ],
  },
  mkt: {
    mandate:
      "Marketing owns positioning and demand — making the right people understand why this is for them, and building an audience that's ready when you ship. Winning is a message that resonates and a growing pool of people who want in.",
    skills: [
      'positioning and messaging',
      'audience and channel strategy',
      'launch sequencing',
      'teaching-in-public and content',
      'lifecycle and email',
      "copywriting in the founder's voice",
    ],
    stageFocus: {
      'Just an idea':
        'Write the one-line positioning and the "who + what problem," sharp enough to test in conversations. No brand, no logo.',
      Prototype:
        'Find where your first users hang out and start showing the thing; harvest the words they use so the message is theirs, not yours.',
      'Private beta':
        'Build the waitlist or interest loop and a small teaching-in-public thread; confirm the message pulls the right people.',
      'Public beta':
        'Sequence the launch (assets, channels, timing) and warm the audience; turn early users into proof.',
      Launched:
        'Run the launch, then convert attention into a repeatable acquisition loop — the one or two channels that actually work; start lifecycle to activate signups.',
      Growing:
        'Double down on channels with traction, systematize content, and build referral and word-of-mouth so growth compounds.',
    },
    antipatterns: [
      'polishing a brand before anyone wants the product',
      "launching to an audience you haven't built",
      'chasing every channel instead of the one that works',
      'talking features instead of the problem',
    ],
  },
  sales: {
    mandate:
      "Sales owns landing the first real customers — the direct, unscalable work of getting specific people to say yes. Winning early isn't a pipeline; it's a handful of real users who prove someone wants this enough to act.",
    skills: [
      'prospecting and target-list building',
      'personalized outreach, not broadcast',
      'discovery — hearing the real need',
      'objection handling',
      'asking for the commitment',
      'early pricing conversations',
    ],
    stageFocus: {
      'Just an idea':
        'List 20–30 specific people who have the problem; start conversations to validate the pain, not to sell.',
      Prototype:
        'Get the rough thing in front of those people one-to-one; ask for a small commitment (a trial, a call, a pre-order) to test real intent.',
      'Private beta':
        'Hand-recruit the first cohort personally — a per-person ask, not a broadcast — and stay close to hear what makes them stick or bounce.',
      'Public beta':
        'Turn warm interest into first paying or committed users; find the repeatable reason people say yes.',
      Launched:
        'Convert launch attention into customers with a clear path to yes; document what closes so it repeats.',
      Growing:
        'Build a light repeatable motion for the segments that convert; know who to chase and who to ignore.',
    },
    antipatterns: [
      'broadcasting instead of talking to people one at a time',
      'pitching before understanding the need',
      'building a CRM before you have customers',
      'selling to everyone instead of the few who desperately need it',
    ],
  },
  support: {
    mandate:
      "Support owns user success after they're in — turning confusion into confidence, and what breaks into what you learn. Winning is users who get unstuck fast and a founder who hears every problem while there are still few enough to fix.",
    skills: [
      'responsive help and triage',
      'writing help docs and FAQs',
      'turning tickets into product insight',
      'onboarding assistance',
      'expectation management',
      'closing the loop with users',
    ],
    stageFocus: {
      'Just an idea':
        'Nothing formal yet, but decide how the first testers reach you (a DM, an email) so no early signal is lost.',
      Prototype:
        'Be the support: hand-hold every tester personally and log every point of confusion — your richest product data.',
      'Private beta':
        'Set up a fast, personal help channel; triage what breaks and feed recurring issues straight to Engineering and Design.',
      'Public beta':
        'Write the first help docs and FAQ for the questions you keep answering; start deflecting the repeats so you scale past one-to-one.',
      Launched:
        "Stand up a real support flow (inbox, canned replies, a response bar) so growth doesn't drown you; keep mining tickets for fixes.",
      Growing:
        'Systematize self-serve (docs, in-app help), watch for churn signals in support, and turn resolved users into advocates.',
    },
    antipatterns: [
      'automating support before you understand the questions',
      'treating tickets as chores instead of product signal',
      'building a help center no one reads',
      'going silent on users who hit a wall',
    ],
  },
  fin: {
    mandate:
      'Finance owns whether the business math works — pricing, the model of money in versus out, and enough runway and proof to keep going. Winning is a price the market will actually pay and a clear-eyed view of what has to be true for this to be a business.',
    skills: [
      'pricing and packaging',
      'financial modeling (unit economics, runway)',
      'willingness-to-pay testing',
      'burn and runway tracking',
      'fundraising narrative',
      'scenario and sensitivity analysis',
    ],
    stageFocus: {
      'Just an idea':
        'One page of rough business logic: who pays, roughly how much, and what must be true for the numbers to work. Assumptions, not spreadsheets.',
      Prototype:
        "Frame the pricing hypothesis and how you'll test willingness to pay; don't set a price in stone.",
      'Private beta':
        'Test willingness to pay for real — a price conversation, a pre-order, a fake door — before committing; build a simple model off what you learn.',
      'Public beta':
        'Lock a launch price and packaging you can defend; model the funnel (signups → paid → churn) so you know the levers.',
      Launched:
        'Track real unit economics and burn; know your runway and the one or two numbers that decide whether this works.',
      Growing:
        'Tighten pricing with real data, model growth scenarios, and — if raising — build the numbers narrative behind the story.',
    },
    antipatterns: [
      'a detailed five-year model before your first customer',
      'guessing at a price instead of testing it',
      "ignoring runway until it's urgent",
      "optimizing costs that don't matter yet",
    ],
  },
  ops: {
    mandate:
      "Operations owns the machinery that lets everything else run — the tools, process, and logistics behind shipping and running the product. Winning is a founder who isn't the bottleneck, with just enough process to move fast without dropping balls.",
    skills: [
      'tooling and infrastructure setup',
      'process design, only where it pays',
      'launch logistics and checklists',
      'vendor and account setup',
      'light automation',
      'tracking what matters',
    ],
    stageFocus: {
      'Just an idea':
        'Almost nothing — resist process. Set up only the couple of accounts or tools you genuinely need to start building.',
      Prototype:
        'Stand up the minimum plumbing (repo, hosting, the one or two services the core flow needs); keep it boring.',
      'Private beta':
        "Machinery to run a small closed beta — invites and access, a way to track who's in and what's happening — so you learn without chaos.",
      'Public beta':
        'Build the launch-readiness checklist and the pipelines a bigger influx needs; remove the manual steps that break at volume.',
      Launched:
        "Put the basics on rails — deploys, backups, a runbook — so the founder isn't hand-cranking everything during growth.",
      Growing:
        'Automate the repetitive load, tighten the processes now straining, and set up light metrics that keep the company legible.',
    },
    antipatterns: [
      "adding process before there's anything to run",
      "automating a workflow you've done twice",
      "setting up tools you don't need yet",
      'becoming the bottleneck by hoarding manual steps',
    ],
  },
  legal: {
    mandate:
      'Legal owns covering the essentials so the product can ship and grow without avoidable risk — the policies, terms, and compliance the business actually needs. Winning is the legal minimum handled cleanly at the right time: not ignored, not gold-plated.',
    skills: [
      'privacy policy and terms drafting',
      'data-handling and compliance basics',
      'contracts and agreements',
      'IP and ownership hygiene',
      'domain-specific regulatory awareness',
      'knowing when to bring in a real lawyer',
    ],
    stageFocus: {
      'Just an idea':
        "Nothing yet — just note anything legally sensitive about the idea (data, a regulated space) to handle later. Don't lawyer a prototype.",
      Prototype:
        'Still minimal; just be mindful of how you handle any real user data you touch while testing.',
      'Private beta':
        'Draft the basics to put it in front of outside users — a simple privacy policy and terms — framed to how the product actually handles data.',
      'Public beta':
        'Firm up privacy and terms for a public audience; check the obvious domain-specific requirements before more people rely on it.',
      Launched:
        'Make sure the shipping essentials are covered — policies live, data handling honest, compliance basics for your space — and have a lawyer glance at anything load-bearing.',
      Growing:
        'Tighten contracts and compliance as stakes rise (customers, data, money), and bring in real counsel for what now warrants it.',
    },
    antipatterns: [
      'over-lawyering before you have users',
      'shipping with no privacy policy while handling real data',
      "copy-pasting terms that don't match the product",
      'treating "a lawyer should see this" as optional on the load-bearing stuff',
    ],
  },
};

/** Scaffold block: mandate + skills + ONLY the current-stage focus + anti-patterns. */
export function departmentBlock(k: string, stage: string): string {
  const f = DEPARTMENT_FOUNDATIONS[k];
  if (!f) return '';
  const lines = [`Mandate: ${f.mandate}`, `Core skills: ${f.skills.join(', ')}.`];
  const focus = f.stageFocus[stage];
  if (focus) lines.push(`Focus at the "${stage}" stage: ${focus}`);
  lines.push(`Avoid: ${f.antipatterns.join('; ')}.`);
  return lines.join('\n');
}

/** Run-task block: mandate + skills only (the task already carries the stage ask). */
export function departmentBrief(k: string): string {
  const f = DEPARTMENT_FOUNDATIONS[k];
  if (!f) return '';
  return `Mandate: ${f.mandate}\nCore skills: ${f.skills.join(', ')}.`;
}
