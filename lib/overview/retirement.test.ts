import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('Roadmap tab is retired', () => {
  it('AppRoot no longer imports or renders RoadmapView', () => {
    expect(read('components/AppRoot.tsx')).not.toMatch(/RoadmapView/);
  });
  it('Sidebar has no roadmap nav entry', () => {
    expect(read('components/Sidebar.tsx')).not.toMatch(/view:\s*'roadmap'/);
  });
  it('the store View type no longer includes roadmap and never sets it', () => {
    const src = read('lib/store.tsx');
    expect(src).not.toMatch(/\|\s*'roadmap'/); // union member gone
    expect(src).not.toMatch(/setView\('roadmap'\)/); // no route to it
  });
  it('SummaryView does not navigate to the roadmap view', () => {
    expect(read('components/views/SummaryView.tsx')).not.toMatch(/show\('roadmap'\)/);
  });
});
