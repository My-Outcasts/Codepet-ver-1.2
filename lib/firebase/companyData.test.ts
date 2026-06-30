import { describe, it, expect } from 'vitest';
import { envStateFromCatalog } from './companyData';
import { ENV, ENV_CATS } from '../data';

describe('envStateFromCatalog', () => {
  it('snapshots every catalog category as a name→boolean map', () => {
    const state = envStateFromCatalog();
    for (const [cat] of ENV_CATS) {
      expect(state[cat], `category ${cat}`).toBeDefined();
      for (const item of ENV[cat]) {
        expect(typeof state[cat][item.n]).toBe('boolean');
      }
    }
  });
  it('reflects the catalog default on/off state (s flag)', () => {
    const state = envStateFromCatalog();
    for (const [cat] of ENV_CATS) {
      for (const item of ENV[cat]) {
        expect(state[cat][item.n]).toBe(item.s === 1);
      }
    }
  });
});
