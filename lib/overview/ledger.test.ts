import { describe, it, expect } from 'vitest';
import {
  eventKey,
  eventFromLibItem,
  eventFromDecision,
  eventFromTaskDone,
  eventFromStageAdvance,
} from './ledger';

describe('eventKey', () => {
  it('is deterministic and Firestore-safe (no slashes)', () => {
    expect(eventKey('library', 'abc/123')).toBe(eventKey('library', 'abc/123'));
    expect(eventKey('library', 'abc/123')).not.toContain('/');
    expect(eventKey('library', 'a')).not.toBe(eventKey('decision', 'a'));
  });
});

describe('eventFromLibItem', () => {
  it('produces a deliverable_approved event carrying id + createdAt', () => {
    const e = eventFromLibItem({ id: 'L1', title: 'API v1', k: 'eng', createdAt: 42 });
    expect(e.type).toBe('deliverable_approved');
    expect(e.deptK).toBe('eng');
    expect(e.ts).toBe(42);
    expect(e.refId).toBe('L1');
    expect(e.summary).toContain('API v1');
  });
});

describe('eventFromDecision', () => {
  it('maps topic/statement/updatedAt and indexes when there is no id', () => {
    const e = eventFromDecision({ topic: 'Pricing', statement: 'Charge $9/mo', updatedAt: 7 }, 3);
    expect(e.type).toBe('decision_made');
    expect(e.ts).toBe(7);
    expect(e.refId).toBe('3');
    expect(e.summary).toContain('Charge $9/mo');
  });
});

describe('eventFromTaskDone', () => {
  it('produces a task_run event with dept, ts, and a summary', () => {
    const e = eventFromTaskDone('eng', 'Engineering', { t: 'Ship b12', done: true } as any, 1000);
    expect(e.type).toBe('task_run');
    expect(e.deptK).toBe('eng');
    expect(e.ts).toBe(1000);
    expect(e.title).toContain('Ship b12');
    expect(e.summary.length).toBeGreaterThan(0);
  });
});

describe('eventFromStageAdvance', () => {
  it('produces a stage_advanced founder event', () => {
    const e = eventFromStageAdvance(2, 'Launch', 5000);
    expect(e.type).toBe('stage_advanced');
    expect(e.actor).toBe('founder');
    expect(e.refType).toBe('stage');
    expect(e.refId).toBe('2');
  });
});
