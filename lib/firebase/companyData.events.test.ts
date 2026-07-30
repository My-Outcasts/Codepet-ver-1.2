import { describe, it, expect } from 'vitest';
import { eventKey } from '../overview/ledger';

describe('appendEvent id strategy', () => {
  it('derives a stable id from refType+refId', () => {
    expect(eventKey('task', 'eng:Ship b12')).toBe(eventKey('task', 'eng:Ship b12'));
    expect(eventKey('task', 'eng:Ship b12')).not.toContain(' ');
  });
});
