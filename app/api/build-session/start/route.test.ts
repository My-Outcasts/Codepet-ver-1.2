import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockedFunction } from 'vitest';

vi.mock('@/lib/liveSession/engine', () => ({
  startSession: vi.fn(),
  stopSession: vi.fn(),
}));

vi.mock('@/lib/installer/capability.mjs', () => ({
  detectCapability: vi.fn(),
}));

vi.mock('@/lib/armSession', () => ({
  buildOpeningPrompt: vi.fn((plan, brief) => `Prompt for ${brief}`),
}));

import { POST } from './route';
import { startSession } from '@/lib/liveSession/engine';
import { detectCapability } from '@/lib/installer/capability.mjs';

const mockStartSession = startSession as MockedFunction<typeof startSession>;
const mockDetectCapability = detectCapability as MockedFunction<typeof detectCapability>;

const plan = { title: 'T', steps: ['a'], budgetActions: 8 };
const body = (b: unknown) =>
  new Request('http://localhost/api/build-session/start', {
    method: 'POST',
    body: JSON.stringify(b),
  });

beforeEach(() => {
  mockStartSession.mockClear();
  mockDetectCapability.mockReset();
});

describe('POST /api/build-session/start', () => {
  it('refuses in remote mode without spawning', async () => {
    mockDetectCapability.mockReturnValue({ mode: 'remote' } as any);
    const res = await POST(body({ buildSessionId: 'b1', projectDir: '/p', plan, brief: 'x' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, reason: 'remote' });
    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it('starts a session in local mode', async () => {
    mockDetectCapability.mockReturnValue({ mode: 'local' } as any);
    const res = await POST(body({ buildSessionId: 'b1', projectDir: '/p', plan, brief: 'do it' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockStartSession).toHaveBeenCalledTimes(1);
    const arg = mockStartSession.mock.calls[0][0];
    expect(arg.buildSessionId).toBe('b1');
    expect(arg.projectDir).toBe('/p');
    expect(typeof arg.openingPrompt).toBe('string');
    expect(arg.openingPrompt).toContain('do it');
  });

  it('rejects a bad body in local mode', async () => {
    mockDetectCapability.mockReturnValue({ mode: 'local' } as any);
    const res = await POST(body({ buildSessionId: '', projectDir: '', plan: null, brief: '' }));
    expect(res.status).toBe(400);
    expect(mockStartSession).not.toHaveBeenCalled();
  });
});
