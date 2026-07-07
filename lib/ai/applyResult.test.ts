import { describe, it, expect } from 'vitest';
import { hasDeliverablePayload } from './applyResult';

describe('hasDeliverablePayload', () => {
  const T = (extra: object = {}) => ({ t: 'x', done: false, ...extra }) as any;
  it('false for a scaffold-only rich task (only kind, no payload)', () => {
    for (const type of [
      'post',
      'email',
      'legal',
      'dms',
      'calendar',
      'checklist',
      'screens',
      'sheet',
      'site',
    ]) {
      expect(hasDeliverablePayload(T(), type)).toBe(false);
    }
  });
  it('true when the payload is present', () => {
    expect(hasDeliverablePayload(T({ post: { variants: [] } }), 'post')).toBe(true);
    expect(hasDeliverablePayload(T({ email: {} }), 'email')).toBe(true);
    expect(hasDeliverablePayload(T({ dms: [{ name: 'a' }] }), 'dms')).toBe(true);
    expect(hasDeliverablePayload(T({ site: '<html>' }), 'site')).toBe(true);
  });
  it('empty arrays count as no payload', () => {
    expect(hasDeliverablePayload(T({ dms: [] }), 'dms')).toBe(false);
    expect(hasDeliverablePayload(T({ screens: [] }), 'screens')).toBe(false);
  });
  it('text types check out', () => {
    expect(hasDeliverablePayload(T({ out: 'hello' }), 'doc')).toBe(true);
    expect(hasDeliverablePayload(T({ out: '   ' }), 'doc')).toBe(false);
    expect(hasDeliverablePayload(T({}), 'prep')).toBe(false);
  });
});
