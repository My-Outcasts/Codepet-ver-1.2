// Pure JSON-schema definitions + prompt instructions for byte's structured
// deliverables. Kept OUT of the server route (no `server-only` / SDK imports) so
// they're unit-testable in plain node and shared by app/api/run-task/route.ts.
//
// Every schema must satisfy Anthropic's strict JSON-schema subset:
// `additionalProperties: false` on each object AND `required` listing *every*
// property key. deliverableSchemas.test.ts enforces that so a malformed schema
// fails in CI instead of 400-ing at runtime.

export type StructuredKind = 'post' | 'email' | 'legal' | 'screens' | 'sheet' | 'site';

// One slider input byte tunes: a default value + a sensible range. Structure
// (which 4 inputs, in what order, what they mean) is FIXED in code — see
// lib/ai/sheetModel.ts — because SheetViewer reads inputs by position and
// divides by churn. byte only fills the numbers.
const SHEET_INPUT: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    val: { type: 'number', description: 'Realistic default for this company.' },
    min: { type: 'number', description: 'Low end of the slider.' },
    max: { type: 'number', description: 'High end of the slider.' },
    step: { type: 'number', description: 'Slider step (≥ 1).' },
  },
  required: ['val', 'min', 'max', 'step'],
};

/** Illustrations the screens viewer (components/artifact/viewers.tsx) can render.
 *  byte's `art` field is constrained to these so it can never pick one the phone
 *  frame can't draw. Keep in sync with ScreensViewer's `art()` branch. */
export const SCREEN_ARTS = ['connect', 'session', 'recap'] as const;

export const POST_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    variants: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: {
            type: 'string',
            description: 'The hook angle, 1-3 words (e.g. "Bold", "Problem-first").',
          },
          body: {
            type: 'string',
            description: 'The full social post, under ~280 characters, no hashtag spam.',
          },
        },
        required: ['label', 'body'],
      },
    },
  },
  required: ['variants'],
};

export const EMAIL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    subject: { type: 'string' },
    preheader: { type: 'string', description: 'Short inbox preview line.' },
    body: {
      type: 'array',
      items: { type: 'string' },
      description: 'Email body as an ordered list of paragraphs.',
    },
    cta: { type: 'string', description: 'Call-to-action button label.' },
    seq: {
      type: 'array',
      description: 'A short follow-up sequence that sends on milestones.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          when: { type: 'string', description: 'Trigger, e.g. "Day 0", "On first session".' },
          title: { type: 'string' },
          open: { type: 'string', description: 'The opening line of that email.' },
        },
        required: ['when', 'title', 'open'],
      },
    },
  },
  required: ['subject', 'preheader', 'body', 'cta', 'seq'],
};

export const LEGAL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    docTitle: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          h: { type: 'string', description: 'Section heading.' },
          p: { type: 'string', description: 'Section body (a real paragraph, not a placeholder).' },
        },
        required: ['h', 'p'],
      },
    },
    flag: {
      type: 'string',
      description: 'One-line reviewer note, e.g. that a lawyer should review before publishing.',
    },
  },
  required: ['docTitle', 'sections', 'flag'],
};

// Design — the onboarding as tap-through phone screens. All fields are required
// (strict subset); the viewer hides sub/cta/note when they're empty strings, so
// byte passes "" for a screen that doesn't need one.
export const SCREENS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    screens: {
      type: 'array',
      description:
        'Exactly 3 onboarding steps that get a brand-new user to their first real moment of value in under ~2 minutes.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: {
            type: 'string',
            description: 'Short step name for the phone header, 1-2 words (e.g. "Connect").',
          },
          time: {
            type: 'string',
            description: 'Target time to complete this step, as m:ss (e.g. "0:15").',
          },
          kick: { type: 'string', description: 'Tiny step label, e.g. "Step 1 of 3".' },
          title: { type: 'string', description: 'The screen headline — what the user does here.' },
          sub: {
            type: 'string',
            description: 'One supporting sentence; empty string if the screen needs none.',
          },
          art: {
            type: 'string',
            enum: [...SCREEN_ARTS],
            description:
              'Which built-in illustration to show: connect (step 1), session (step 2), recap (step 3).',
          },
          cta: { type: 'string', description: 'Button/CTA label; empty string if none.' },
          note: {
            type: 'string',
            description: 'Small footnote under the CTA; empty string if none.',
          },
        },
        required: ['name', 'time', 'kick', 'title', 'sub', 'art', 'cta', 'note'],
      },
    },
  },
  required: ['screens'],
};

// Finance — an interactive pricing model. byte supplies the 4 pinned inputs'
// values/ranges (price · waitlist · conversion% · churn%) + a summary; the model
// math and the input roles live in code (lib/ai/sheetModel.ts).
export const SHEET_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    price: { ...SHEET_INPUT, description: 'Monthly Pro-tier price, in dollars.' },
    waitlist: { ...SHEET_INPUT, description: 'Current waitlist / early-audience size (a count).' },
    conversion: { ...SHEET_INPUT, description: 'Percent of that audience who become paid (a %).' },
    churn: { ...SHEET_INPUT, description: 'Monthly churn as a percent — at least 1.' },
    summary: {
      type: 'string',
      description: 'One paragraph on what the model shows at the default values.',
    },
  },
  required: ['price', 'waitlist', 'conversion', 'churn', 'summary'],
};

// A short {h, p} card used by both the how-it-works steps and the feature grid.
const SITE_CARD: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    h: { type: 'string', description: 'Short heading, 1-4 words.' },
    p: { type: 'string', description: 'One or two plain-language sentences.' },
  },
  required: ['h', 'p'],
};

// Marketing — a real, shippable landing page. byte fills ONLY the content and a
// single accent hex; the page's HTML/CSS skeleton is a fixed template in code
// (lib/ai/siteTemplate.ts), which escapes every field and sanitizes the accent.
// byte never writes markup, so the output is always safe and on-brand.
export const SITE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', description: 'Browser tab title / SEO title.' },
    brand: { type: 'string', description: 'Company or product name for the logo + footer.' },
    kicker: {
      type: 'string',
      description:
        'Tiny label above the headline (e.g. platform / category); empty string if none.',
    },
    headline: { type: 'string', description: 'The hero H1 — the core promise.' },
    headlineHi: {
      type: 'string',
      description:
        'A short tail phrase of the headline shown in the accent colour; empty string if none.',
    },
    sub: { type: 'string', description: 'One supporting sentence under the headline.' },
    ctaPrimary: { type: 'string', description: 'Primary button label (e.g. "Get started").' },
    ctaSecondary: {
      type: 'string',
      description: 'Secondary button label; empty string if there is only one CTA.',
    },
    howEyebrow: { type: 'string', description: 'Eyebrow over the how-it-works section.' },
    howTitle: { type: 'string', description: 'How-it-works section heading.' },
    steps: {
      type: 'array',
      description: 'Exactly 3 how-it-works steps, in order.',
      items: SITE_CARD,
    },
    featEyebrow: { type: 'string', description: 'Eyebrow over the features section.' },
    featTitle: { type: 'string', description: 'Features section heading.' },
    features: {
      type: 'array',
      description: 'Exactly 3 feature cards — concrete benefits, not fluff.',
      items: SITE_CARD,
    },
    quote: {
      type: 'string',
      description: 'One pull-quote / testimonial line; empty string if none.',
    },
    quoteBy: { type: 'string', description: 'Attribution for the quote; empty string if none.' },
    finalTitle: { type: 'string', description: 'Closing call-to-action heading.' },
    finalSub: {
      type: 'string',
      description: 'One line under the closing CTA; empty string if none.',
    },
    finalCta: { type: 'string', description: 'Closing CTA button label.' },
    accent: {
      type: 'string',
      description: 'Brand accent colour as a 6-digit hex (e.g. "#6E8E68"). Just the hex.',
    },
    footNote: {
      type: 'string',
      description: 'Footer line, e.g. "© 2026 Acme · acme.com".',
    },
  },
  required: [
    'title',
    'brand',
    'kicker',
    'headline',
    'headlineHi',
    'sub',
    'ctaPrimary',
    'ctaSecondary',
    'howEyebrow',
    'howTitle',
    'steps',
    'featEyebrow',
    'featTitle',
    'features',
    'quote',
    'quoteBy',
    'finalTitle',
    'finalSub',
    'finalCta',
    'accent',
    'footNote',
  ],
};

export const STRUCTURED_SCHEMAS: Record<StructuredKind, Record<string, unknown>> = {
  post: POST_SCHEMA,
  email: EMAIL_SCHEMA,
  legal: LEGAL_SCHEMA,
  screens: SCREENS_SCHEMA,
  sheet: SHEET_SCHEMA,
  site: SITE_SCHEMA,
};

export const DELIVERABLE_INSTRUCTIONS: Record<StructuredKind | 'text', string> = {
  text: 'Write the deliverable as plain text.',
  post: 'Write exactly 3 distinct launch-post variants that take different angles on the same announcement.',
  email:
    'Write a launch/activation email: a subject, a preheader, 3-5 short body paragraphs, a CTA label, and a 2-3 step follow-up sequence.',
  legal:
    'Draft a real, formatted legal document with a clear title and 4-7 substantive sections written in plain language.',
  screens:
    'Design exactly 3 onboarding screens for this company. Set `art` to "connect", then "session", then "recap" in that order (step 1, 2, 3). Walk a brand-new user to their first real moment of value in under ~2 minutes. Use empty strings for any sub/cta/note a screen does not need.',
  sheet:
    'Build a pricing model tuned to THIS company. For each of the 4 fixed inputs give a realistic default value and a sensible slider range (min ≤ val ≤ max, step ≥ 1): price (monthly Pro price in $), waitlist (current early-audience size), conversion (% who become paid), churn (monthly % churn, min at least 1). Then write a one-paragraph summary of what the model shows at those defaults.',
  site: "Write the content for a real, shippable one-page marketing site for THIS company. Provide a hero (kicker, headline with an optional accent tail, one subline, and 1-2 CTA labels), exactly 3 how-it-works steps, exactly 3 concrete feature cards, an optional one-line testimonial, a closing CTA, a brand accent colour as a 6-digit hex, and a footer line. Write real, specific copy in the company's voice — no placeholders. Use empty strings for any optional field (kicker, headlineHi, ctaSecondary, quote, quoteBy, finalSub) the page does not need. Do NOT write HTML; only the text and the hex colour.",
};
