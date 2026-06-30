// Pure helpers ported from the draft: artifact typing, task state, metadata.
import type { Task } from './data';

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const fmt = (n: number): string =>
  n >= 1000 ? '$' + Math.round(n / 100) / 10 + 'k' : '$' + Math.round(n);

export const slug = (s: string): string =>
  s
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
    .replace(/^-|-$/g, '');

// type of artifact a task produces
export const artType = (t: Task, walk?: boolean): string =>
  t.site
    ? 'site'
    : t.screens
      ? 'screens'
      : t.sheet
        ? 'sheet'
        : t.pr
          ? 'pr'
          : t.post
            ? 'post'
            : t.email
              ? 'email'
              : t.calendar
                ? 'calendar'
                : t.legal
                  ? 'legal'
                  : t.dms
                    ? 'dms'
                    : t.checklist
                      ? 'checklist'
                      : t.run === 'route'
                        ? 'build'
                        : walk || t.who === 'you'
                          ? 'prep'
                          : 'doc';

export interface TaskStateInfo {
  label: string;
  cls: string;
}
// shared task-state vocabulary — what each task needs from whom
export function taskState(t: Task, available?: boolean): TaskStateInfo {
  if (t.done) return { label: 'Done', cls: 'st-done' };
  if (available === false) return { label: 'Locked', cls: 'st-locked' };
  if (t.who === 'draft') return { label: 'Needs your approval', cls: 'st-draft' };
  if (t.who === 'you') return { label: 'Needs your input', cls: 'st-you' };
  return { label: 'byte does this', cls: 'st-does' };
}

const artTag = (c: string, l: string): string =>
  `<span class="art-tag" style="background:var(${c})">${l}</span>`;

// registry: type → meta (viewer is bound separately in the modal)
export interface RichMeta {
  file: string;
  head: string;
  tag: string;
  log: string;
  vstat: string;
  ok: string;
  ho: string;
  saved: string;
}
export const RICH_META: Record<string, RichMeta> = {
  post: {
    file: 'launch-post.txt',
    head: 'Social post',
    tag: artTag('--clay', 'ready to post'),
    log: 'doc',
    vstat: 'Post is ready — try the hook variants, then copy the winner straight to X',
    ok: 'Approve the post',
    ho: '<b>byte wrote your launch post.</b> Try the hook variants, copy the winner — or tell byte what to change.',
    saved: 'in your <b>Library</b>',
  },
  email: {
    file: 'waitlist-email.eml',
    head: 'Email',
    tag: artTag('--clay', 'ready to send'),
    log: 'doc',
    vstat: 'Email previewed exactly as testers will see it — full 3-step sequence below',
    ok: 'Approve the email',
    ho: '<b>byte wrote your activation email.</b> Preview it, approve to save — or ask for a different angle.',
    saved: 'in your <b>Library</b>',
  },
  calendar: {
    file: 'content-calendar.md',
    head: 'Content calendar',
    tag: artTag('--clay', '2-week plan'),
    log: 'doc',
    vstat: 'Two weeks planned — four posts, scheduled and themed',
    ok: 'Approve the plan',
    ho: '<b>byte planned two weeks of teaching-in-public.</b> Approve to save it — or ask for a different cadence.',
    saved: 'in your <b>Library</b>',
  },
  legal: {
    file: 'legal-doc.md',
    head: 'Legal document',
    tag: artTag('--violet', 'draft for review'),
    log: 'doc',
    vstat: 'Drafted as a real, formatted document — copy or download for your lawyer',
    ok: 'Approve the draft',
    ho: '<b>byte drafted a real document.</b> Read it through, copy or download — approve to save, or ask for changes.',
    saved: 'in your <b>Library</b>',
  },
  dms: {
    file: 'outreach-dms.md',
    head: 'Outreach DMs',
    tag: artTag('--accent', 'ready to send'),
    log: 'doc',
    vstat: 'Personal DMs drafted per waitlister — copy each, mark it sent as you go',
    ok: 'Approve the outreach',
    ho: '<b>byte drafted a personal DM for each waitlister.</b> Copy and send them yourself — I’ll track who activates.',
    saved: 'in your <b>Library</b>',
  },
  checklist: {
    file: 'testflight-checklist.md',
    head: 'Checklist',
    tag: artTag('--gold', 'for you to run'),
    log: 'prep',
    vstat: 'A live checklist — tick items off as you go; I’ll track what’s left',
    ok: 'Add to my plan',
    ho: '<b>byte prepared a checklist you can run.</b> Tick items off here — approve to track it in your plan.',
    saved: 'tracked in your <b>plan</b>',
  },
  pr: {
    file: 'pull-request.diff',
    head: 'Pull request',
    tag: artTag('--accent', 'merged'),
    log: 'build',
    vstat: 'Shipped & verified — merged to main, all checks green',
    ok: 'Looks right — log it',
    ho: '<b>byte shipped this and verified it.</b> Review the change and the checks — approve to log it, or send it back.',
    saved: 'live in your project',
  },
};

export interface ArtMeta {
  file: string;
  head: string;
  tag: string;
}
export function artMeta(t: Task, type: string): ArtMeta {
  const s = slug(t.t);
  if (RICH_META[type])
    return { file: RICH_META[type].file, head: RICH_META[type].head, tag: RICH_META[type].tag };
  return type === 'site'
    ? {
        file: 'index.html',
        head: 'Built &amp; shipped',
        tag: '<span class="art-tag" style="background:var(--accent)">live</span>',
      }
    : type === 'screens'
      ? {
          file: s + '.fig',
          head: 'Screens — tap through',
          tag: '<span class="art-tag" style="background:var(--violet,#8B7FB8)">prototype</span>',
        }
      : type === 'sheet'
        ? {
            file: s + '.model',
            head: 'Live model',
            tag: '<span class="art-tag" style="background:var(--accent)">interactive</span>',
          }
        : type === 'build'
          ? {
              file: s + '.diff',
              head: 'Built &amp; verified',
              tag: '<span class="art-tag" style="background:var(--accent)">verified</span>',
            }
          : type === 'prep'
            ? {
                file: s + '-checklist.md',
                head: 'Prepared for you',
                tag: '<span class="art-tag" style="background:var(--gold)">for you</span>',
              }
            : {
                file: s + '.md',
                head: 'Draft document',
                tag: '<span class="art-tag" style="background:#B7AE9E">draft</span>',
              };
}

// the execute-phase build log (terminal-style) — returns step descriptors
export interface LogStep {
  t?: string;
  mono?: boolean;
  ck?: string;
}
export function buildLog(t: Task, type: string, d: { k: string }): LogStep[] {
  const M = (s: string): LogStep => ({ t: s, mono: true });
  const L = (s: string): LogStep => ({ t: s });
  const CK = (s: string): LogStep => ({ ck: s });
  const file =
    d.k === 'eng' ? 'Analytics.swift' : d.k === 'design' ? 'Onboarding.swift' : 'project';
  if (type === 'site')
    return [
      M('<span class="cm">$</span> codepet build "' + t.t + '"'),
      L('Outlining the page — nav · hero · how-it-works · features · CTA · footer'),
      L('Pulling brand context — palette, voice, the launch positioning'),
      M('<span class="ad">→</span> routed to Claude Code <span class="cm">(your agent)</span>'),
      M('claude  scaffolding <span class="ad">index.html</span> + responsive styles …'),
      M('claude  writing hero, sections, mobile breakpoints'),
      M('claude  <span class="cm">$</span> npm run dev  <span class="ad">→ localhost:3001</span>'),
      CK('Checkpoint — dev server up on :3001, took a screenshot with agent-browser'),
      M('agent-browser  <span class="ad">✓</span> renders · links work · mobile layout ok'),
      L('Verifying against the brief — message, CTA, tone'),
      M('<span class="ad">✓</span> built &amp; verified — opening the live preview below'),
    ];
  if (type === 'screens')
    return [
      L('Reading the onboarding spec — three screens, first value < 2 min'),
      L('Laying out the phone frame and the connect → session → recap flow'),
      L('Writing copy and the live recap state'),
      CK('Checkpoint — checked each screen against the < 2 min target'),
      L('Wiring the tap-through prototype ↓'),
    ];
  if (type === 'sheet')
    return [
      M('<span class="cm">$</span> codepet model "' + t.t + '"'),
      L('Pulling inputs — waitlist 1,504 · price band $8–15 · learning-companion frame'),
      L('Building the projection — paid users → MRR → ARR → LTV'),
      CK('Checkpoint — stress-tested across the price band'),
      M('<span class="ad">✓</span> model built — drag the inputs below'),
    ];
  if (type === 'build')
    return [
      M('<span class="cm">$</span> codepet handoff "' + t.t + '"'),
      L('Reading project context — CLAUDE.md, Business Brief, your code'),
      L('Drafting the change and a verification check'),
      M('<span class="ad">→</span> routed to Claude Code <span class="cm">(your agent)</span>'),
      M('claude  reading ' + file + ' …'),
      M(
        'claude  editing ' +
          file +
          ' <span class="ad">+' +
          (8 + (t.t.length % 9)) +
          '</span> <span class="rm">−' +
          (2 + (t.t.length % 3)) +
          '</span>',
      ),
      CK('Checkpoint — built, started dev server on :3001, took a screenshot'),
      M('claude  build succeeded <span class="cm">· 218 tests passed</span>'),
      L('Verifying the change actually does what we said…'),
      M(
        '<span class="ad">✓</span> verified live <span class="cm">— writing the record below</span>',
      ),
    ];
  if (type === 'prep')
    return [
      L('Reading your Business Brief — stage, ICP, what’s next'),
      L('Working out the exact steps you’ll need to run'),
      CK('Checkpoint — cross-checked against your roadmap stage'),
      L('Sequencing them so nothing blocks later'),
      L('Writing the checklist for you ↓'),
    ];
  return [
    L('Reading your Business Brief — ICP, mission, your voice'),
    L('Matching tone: warm, plain-language, no hype'),
    L('Drafting “' + t.t + '” …'),
    CK('Checkpoint — sanity-checked claims against your product'),
    L('Shaping it into sections and adding a variant or two'),
    L('Writing the deliverable ↓'),
  ];
}
