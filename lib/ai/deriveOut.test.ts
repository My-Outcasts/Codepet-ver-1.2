import { describe, it, expect } from 'vitest';
import { deriveOut } from './deriveOut';

describe('deriveOut', () => {
  it('returns null for handled-elsewhere / unknown kinds', () => {
    expect(deriveOut('text', { anything: 1 })).toBeNull();
    expect(deriveOut('sheet', { summary: 'x' })).toBeNull();
    expect(deriveOut('site', { sub: 'x' })).toBeNull();
    expect(deriveOut('mystery', { a: 1 })).toBeNull();
  });

  it('returns null for non-object payloads', () => {
    expect(deriveOut('post', null)).toBeNull();
    expect(deriveOut('post', 'nope')).toBeNull();
    expect(deriveOut('post', 42)).toBeNull();
  });

  describe('post', () => {
    const payload = {
      variants: [
        { label: 'Bold', body: 'Ship code you understand.' },
        { label: 'Problem-first', body: 'Vibe coding leaves gaps.' },
      ],
    };
    it('summarizes variant count, angles, and the lead body', () => {
      const out = deriveOut('post', payload)!;
      expect(out).toContain('2 launch-post variants ready to A/B');
      expect(out).toContain('Bold · Problem-first');
      expect(out).toContain('Ship code you understand.');
    });
    it('handles a single variant (no plural, no angles line when unlabeled)', () => {
      const out = deriveOut('post', { variants: [{ label: '', body: 'Just one.' }] })!;
      expect(out).toContain('1 launch-post variant ready');
      expect(out).not.toContain('variants');
      expect(out).toContain('Just one.');
    });
    it('returns null when there is no usable lead body', () => {
      expect(deriveOut('post', { variants: [] })).toBeNull();
      expect(deriveOut('post', { variants: [{ label: 'X', body: '' }] })).toBeNull();
      expect(deriveOut('post', {})).toBeNull();
    });
  });

  describe('email', () => {
    const payload = {
      subject: 'Your spot is open',
      preheader: 'Run one session today.',
      body: ['Hi', 'Welcome'],
      cta: 'Open Codepet',
      seq: [
        { when: 'Day 0', title: 'A', open: 'x' },
        { when: 'Day 3', title: 'B', open: 'y' },
      ],
    };
    it('leads with the subject and folds in cta + sequence', () => {
      const out = deriveOut('email', payload)!;
      expect(out).toContain('subject: "Your spot is open"');
      expect(out).toContain('Run one session today.');
      expect(out).toContain('CTA: Open Codepet.');
      expect(out).toContain('2-step follow-up (Day 0, Day 3)');
    });
    it('needs only a subject to produce output', () => {
      const out = deriveOut('email', { subject: 'Hey' });
      expect(out).toContain('subject: "Hey"');
    });
    it('returns null without a subject', () => {
      expect(deriveOut('email', { preheader: 'x', cta: 'y' })).toBeNull();
    });
  });

  describe('legal', () => {
    const payload = {
      docTitle: 'Privacy Policy',
      sections: [
        { h: 'Data we collect', p: '...' },
        { h: 'Your rights', p: '...' },
      ],
      flag: 'Have a lawyer review before publishing.',
    };
    it('summarizes title, section count, headings, and the reviewer flag', () => {
      const out = deriveOut('legal', payload)!;
      expect(out).toContain('Privacy Policy drafted — 2 sections');
      expect(out).toContain('Data we collect · Your rights');
      expect(out).toContain('Reviewer note: Have a lawyer review before publishing.');
    });
    it('returns null without any section headings', () => {
      expect(deriveOut('legal', { docTitle: 'X', sections: [], flag: 'y' })).toBeNull();
      expect(deriveOut('legal', { docTitle: 'X', sections: [{ h: '', p: 'z' }] })).toBeNull();
    });
  });

  describe('screens', () => {
    const payload = {
      screens: [
        { name: 'Connect', time: '0:15', title: 'Link your project' },
        { name: 'Session', time: '0:45', title: 'Run your first task' },
        { name: 'Recap', time: '0:30', title: 'See what you built' },
      ],
    };
    it('lists screen names and per-screen detail', () => {
      const out = deriveOut('screens', payload)!;
      expect(out).toContain('3 screens: Connect · Session · Recap');
      expect(out).toContain('Connect (0:15) — Link your project');
      expect(out).toContain('Recap (0:30) — See what you built');
    });
    it('uses no decorative arrows in the summary', () => {
      const out = deriveOut('screens', payload)!;
      expect(out).not.toContain('->');
      expect(out).not.toContain('→');
    });
    it('returns null when screens have no names', () => {
      expect(deriveOut('screens', { screens: [] })).toBeNull();
      expect(deriveOut('screens', { screens: [{ time: '0:15' }] })).toBeNull();
    });
  });

  describe('dms', () => {
    const payload = {
      messages: [
        { name: 'Alex', note: 'replied twice', msg: 'Hey Alex...' },
        { name: 'Priya', note: 'joined day one', msg: 'Hi Priya...' },
      ],
    };
    it('summarizes count, target names, and the swap-then-send instruction', () => {
      const out = deriveOut('dms', payload)!;
      expect(out).toContain('2 personalized outreach drafts ready');
      expect(out).toContain('a per-person DM, not a broadcast');
      expect(out).toContain('Alex · Priya');
      expect(out).toContain('Swap each placeholder name');
    });
    it('handles a single draft (singular)', () => {
      const out = deriveOut('dms', { messages: [{ name: 'Sam', note: 'n', msg: 'm' }] })!;
      expect(out).toContain('1 personalized outreach draft ready');
      expect(out).not.toContain('drafts ready');
    });
    it('uses no decorative arrows', () => {
      const out = deriveOut('dms', payload)!;
      expect(out).not.toContain('->');
      expect(out).not.toContain('→');
    });
    it('returns null when there are no named messages', () => {
      expect(deriveOut('dms', { messages: [] })).toBeNull();
      expect(deriveOut('dms', { messages: [{ note: 'x', msg: 'y' }] })).toBeNull();
      expect(deriveOut('dms', {})).toBeNull();
    });
  });

  describe('calendar', () => {
    const payload = {
      weeks: [
        {
          label: 'Week 1',
          items: [
            { day: 'Mon', kind: 'Thread', body: 'Term of the week' },
            { day: 'Thu', kind: 'Build log', body: 'What shipped' },
          ],
        },
        {
          label: 'Week 2',
          items: [{ day: 'Mon', kind: 'Story', body: 'A tester before/after' }],
        },
      ],
    };
    it('summarizes week count, total posts, and per-week slots', () => {
      const out = deriveOut('calendar', payload)!;
      expect(out).toContain('2-week content calendar ready — 3 posts');
      expect(out).toContain('Week 1: Mon Thread · Thu Build log');
      expect(out).toContain('Week 2: Mon Story');
    });
    it('uses no decorative arrows', () => {
      const out = deriveOut('calendar', payload)!;
      expect(out).not.toContain('->');
      expect(out).not.toContain('→');
    });
    it('skips weeks with no usable items and returns null when none remain', () => {
      const out = deriveOut('calendar', {
        weeks: [
          { label: 'Week 1', items: [] },
          { label: 'Week 2', items: [{ day: 'Mon', kind: 'Story', body: 'Real' }] },
        ],
      })!;
      expect(out).toContain('1-week content calendar ready — 1 post');
      expect(out).toContain('Week 2: Mon Story');
      expect(deriveOut('calendar', { weeks: [] })).toBeNull();
      expect(deriveOut('calendar', {})).toBeNull();
    });
  });

  describe('checklist', () => {
    const payload = {
      items: [
        { t: 'Create the beta group', done: true },
        { t: 'Upload the build', done: false },
        { t: 'Write invite copy', done: false },
      ],
    };
    it('summarizes step count, done count, and marks each item', () => {
      const out = deriveOut('checklist', payload)!;
      expect(out).toContain('3-step checklist ready — 1/3 done');
      expect(out).toContain('✓ Create the beta group');
      expect(out).toContain('☐ Upload the build');
    });
    it('uses no decorative arrows', () => {
      const out = deriveOut('checklist', payload)!;
      expect(out).not.toContain('->');
      expect(out).not.toContain('→');
    });
    it('skips items with no label and returns null when none remain', () => {
      const out = deriveOut('checklist', {
        items: [
          { t: '', done: true },
          { t: 'Real step', done: false },
        ],
      })!;
      expect(out).toContain('1-step checklist ready — 0/1 done');
      expect(out).toContain('☐ Real step');
      expect(deriveOut('checklist', { items: [] })).toBeNull();
      expect(deriveOut('checklist', {})).toBeNull();
    });
  });
});
