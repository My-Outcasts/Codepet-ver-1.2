import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockedFunction } from 'vitest';

vi.mock('@/lib/liveSession/engine', () => ({ stopSession: vi.fn() }));
vi.mock('@/lib/installer/capability.mjs', () => ({ detectCapability: vi.fn() }));

import { POST } from './route';
import { stopSession } from '@/lib/liveSession/engine';
import { detectCapability } from '@/lib/installer/capability.mjs';

const mockStop = stopSession as MockedFunction<typeof stopSession>;
const mockCap = detectCapability as MockedFunction<typeof detectCapability>;

const body = (b: unknown) =>
  new Request('http://localhost/api/build-session/stop', {
    method: 'POST',
    body: JSON.stringify(b),
  });

beforeEach(() => {
  mockStop.mockReset();
  mockCap.mockReset();
});

describe('POST /api/build-session/stop', () => {
  it('refuses in remote mode', async () => {
    mockCap.mockReturnValue({ mode: 'remote', reason: 'test' });
    const res = await POST(body({ buildSessionId: 'b1' }));
    expect(res.status).toBe(409);
    expect(mockStop).not.toHaveBeenCalled();
  });

  it('stops the session in local mode', async () => {
    mockCap.mockReturnValue({ mode: 'local', reason: 'test' });
    const res = await POST(body({ buildSessionId: 'b1' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockStop).toHaveBeenCalledWith('b1');
  });

  it('rejects a bad body', async () => {
    mockCap.mockReturnValue({ mode: 'local', reason: 'test' });
    const res = await POST(body({ buildSessionId: '' }));
    expect(res.status).toBe(400);
    expect(mockStop).not.toHaveBeenCalled();
  });
});
