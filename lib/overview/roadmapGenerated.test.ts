import { describe, it, expect } from 'vitest';
import { roadmapFromGenerated, type GeneratedRoadmap } from './roadmapGenerated';

const gen: GeneratedRoadmap = {
  tasks: [
    { phase: 'foundation', dept: 'legal', title: 'Incorporate LLC', deps: [] },
    { phase: 'build', dept: 'eng', title: 'Core product flow', deps: ['Incorporate LLC'] },
    { phase: 'ship', dept: 'fin', title: 'Set up billing', deps: ['Core product flow'] },
  ],
};

describe('roadmapFromGenerated', () => {
  it('converts tasks and resolves deps (by title) into dependsOn ids', () => {
    const out = roadmapFromGenerated(gen);
    expect(out.map((t) => t.title)).toEqual([
      'Incorporate LLC',
      'Core product flow',
      'Set up billing',
    ]);
    const byTitle = (t: string) => out.find((x) => x.title === t)!;
    expect(byTitle('Core product flow').dependsOn).toEqual([byTitle('Incorporate LLC').id]);
    expect(byTitle('Set up billing').dependsOn).toEqual([byTitle('Core product flow').id]);
    expect(byTitle('Incorporate LLC').dependsOn).toEqual([]);
  });

  it('assigns unique ids even when two titles slugify the same', () => {
    const out = roadmapFromGenerated({
      tasks: [
        { phase: 'build', dept: 'eng', title: 'Ship it!', deps: [] },
        { phase: 'ship', dept: 'eng', title: 'Ship it', deps: [] },
      ],
    });
    expect(new Set(out.map((t) => t.id)).size).toBe(2);
  });

  it('drops tasks with an unknown phase or department', () => {
    const out = roadmapFromGenerated({
      tasks: [
        { phase: 'nonsense', dept: 'eng', title: 'A', deps: [] },
        { phase: 'build', dept: 'wizardry', title: 'B', deps: [] },
        { phase: 'build', dept: 'eng', title: 'C', deps: [] },
      ],
    });
    expect(out.map((t) => t.title)).toEqual(['C']);
  });

  it('ignores a dependency whose task is not present', () => {
    const out = roadmapFromGenerated({
      tasks: [{ phase: 'build', dept: 'eng', title: 'Only', deps: ['Ghost task'] }],
    });
    expect(out[0].dependsOn).toEqual([]);
  });

  it('handles empty / null input', () => {
    expect(roadmapFromGenerated({ tasks: [] })).toEqual([]);
    expect(roadmapFromGenerated(null)).toEqual([]);
  });

  it('carries the founder/byte actor through, defaulting to byte', () => {
    const out = roadmapFromGenerated({
      tasks: [
        { phase: 'find', dept: 'mkt', title: 'Define the core problem', actor: 'you', deps: [] },
        { phase: 'find', dept: 'mkt', title: 'Draft the outreach', actor: 'byte', deps: [] },
        { phase: 'build', dept: 'eng', title: 'Build the MVP', deps: [] }, // actor omitted
        // an invalid actor value falls back to byte rather than leaking through
        {
          phase: 'ship',
          dept: 'fin',
          title: 'Set pricing',
          actor: 'nonsense' as unknown as 'you',
          deps: [],
        },
      ],
    });
    const actor = (t: string) => out.find((x) => x.title === t)!.actor;
    expect(actor('Define the core problem')).toBe('you'); // founder-owned → needsYou gate
    expect(actor('Draft the outreach')).toBe('byte');
    expect(actor('Build the MVP')).toBe('byte'); // omitted → default
    expect(actor('Set pricing')).toBe('byte'); // invalid → default
  });
});
