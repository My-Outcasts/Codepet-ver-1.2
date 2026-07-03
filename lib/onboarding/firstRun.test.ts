import { describe, it, expect } from 'vitest';
import { buildRevealSummary, buildFirstRunGreeting } from './firstRun';
import type { Dept } from '../data';

const dept = (k: string, name: string, tasks: Array<[string, boolean]>, later = false): Dept => ({
  k,
  name,
  ab: name.slice(0, 2).toUpperCase(),
  status: 'attention',
  pend: 0,
  need: '',
  byte: '',
  later,
  tasks: tasks.map(([t, done]) => ({ t, who: 'you', out: '', done })),
});

describe('buildRevealSummary', () => {
  const depts: Dept[] = [
    dept('eng', 'Engineering', [
      ['Ship the beta', false],
      ['Old thing', true],
    ]),
    dept('mkt', 'Marketing', [['Draft the landing page', false]]),
    dept('legal', 'Legal', [['Privacy policy', false]]),
    dept('fin', 'Finance', [['Pricing model', false]]),
    dept('later', 'Growth', [['Referral loop', false]], true), // dormant — excluded
  ];

  it('counts only active (non-later) departments and open tasks', () => {
    const s = buildRevealSummary(depts, true);
    expect(s.ok).toBe(true);
    expect(s.deptCount).toBe(4); // 'Growth' is later → excluded
    expect(s.taskCount).toBe(4); // open tasks across active depts (the 'Old thing' done task excluded)
  });

  it('samples up to 3 department names and 3 first-open task titles', () => {
    const s = buildRevealSummary(depts, true);
    expect(s.sampleDepts).toEqual(['Engineering', 'Marketing', 'Legal']);
    expect(s.sampleTasks).toEqual(['Ship the beta', 'Draft the landing page', 'Privacy policy']);
  });

  it('carries the ok flag through (scaffold-failed reveal still returns seed-derived numbers)', () => {
    const s = buildRevealSummary(depts, false);
    expect(s.ok).toBe(false);
    expect(s.deptCount).toBe(4);
  });
});

describe('buildFirstRunGreeting', () => {
  const ns = { deptK: 'mkt', taskTitle: 'Draft the landing page', why: '' };

  it('addresses the founder, names the project, and offers an inline action', () => {
    const g = buildFirstRunGreeting({ founderName: 'Mona', projectName: 'Codepet' }, ns);
    expect(g.text).toContain('Mona');
    expect(g.text).toContain('Codepet');
    expect(g.text).toContain('Draft the landing page');
    expect(g.action).toEqual({
      label: 'Do it with me: Draft the landing page',
      deptK: 'mkt',
      taskTitle: 'Draft the landing page',
      inline: true,
    });
  });

  it('falls back to a warm nudge with no action when there is no next step', () => {
    const g = buildFirstRunGreeting({ projectName: 'Codepet' }, null);
    expect(g.action).toBeUndefined();
    expect(g.text).toContain('Codepet');
    expect(g.text.length).toBeGreaterThan(0);
  });

  it('handles a missing founder name gracefully', () => {
    const g = buildFirstRunGreeting({ projectName: 'Codepet' }, ns);
    expect(g.text).not.toContain('undefined');
    expect(g.action?.inline).toBe(true);
  });
});
