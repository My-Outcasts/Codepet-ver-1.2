// Pure JSON-schema definitions + prompt instructions for byte's structured
// deliverables. Kept OUT of the server route (no `server-only` / SDK imports) so
// they're unit-testable in plain node and shared by app/api/run-task/route.ts.
//
// Every schema must satisfy Anthropic's strict JSON-schema subset:
// `additionalProperties: false` on each object AND `required` listing *every*
// property key. deliverableSchemas.test.ts enforces that so a malformed schema
// fails in CI instead of 400-ing at runtime.

export type StructuredKind = 'post' | 'email' | 'legal' | 'screens';

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

export const STRUCTURED_SCHEMAS: Record<StructuredKind, Record<string, unknown>> = {
  post: POST_SCHEMA,
  email: EMAIL_SCHEMA,
  legal: LEGAL_SCHEMA,
  screens: SCREENS_SCHEMA,
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
};
