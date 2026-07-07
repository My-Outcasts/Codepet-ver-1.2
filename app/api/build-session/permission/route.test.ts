import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockedFunction } from 'vitest';

vi.mock('@/lib/liveSession/engine', () => ({ resolvePermission: vi.fn() }));
vi.mock('@/lib/installer/capability.mjs', () => ({ detectCapability: vi.fn() }));

import { POST } from './route';
import { resolvePermission } from '@/lib/liveSession/engine';
import { detectCapability } from '@/lib/installer/capability.mjs';

const mockResolve = resolvePermission as MockedFunction<typeof resolvePermission>;
const mockCap = detectCapability as MockedFunction<typeof detectCapability>;

const body = (b: unknown) =>
  new Request('http://localhost/api/build-session/permission', {
    method: 'POST',
    body: JSON.stringify(b),
  });

beforeEach(() => {
  mockResolve.mockReset();
  mockCap.mockReset();
});

describe('POST /api/build-session/permission', () => {
  it('refuses in remote mode', async () => {
    mockCap.mockReturnValue({ mode: 'remote', reason: 'test' });
    const res = await POST(body({ buildSessionId: 'b1', requestId: 'r1', decision: 'allow' }));
    expect(res.status).toBe(409);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('resolves an allow decision', async () => {
    mockCap.mockReturnValue({ mode: 'local', reason: 'test' });
    mockResolve.mockReturnValue(true);
    const res = await POST(body({ buildSessionId: 'b1', requestId: 'r1', decision: 'allow' }));
    expect(res.status).toBe(200);
    expect(mockResolve).toHaveBeenCalledWith('b1', 'r1', { decision: 'allow' });
  });

  it('maps a deny decision', async () => {
    mockCap.mockReturnValue({ mode: 'local', reason: 'test' });
    mockResolve.mockReturnValue(true);
    await POST(body({ buildSessionId: 'b1', requestId: 'r1', decision: 'deny' }));
    expect(mockResolve).toHaveBeenCalledWith('b1', 'r1', { decision: 'deny' });
  });

  it('rejects a bad decision value', async () => {
    mockCap.mockReturnValue({ mode: 'local', reason: 'test' });
    const res = await POST(body({ buildSessionId: 'b1', requestId: 'r1', decision: 'maybe' }));
    expect(res.status).toBe(400);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('reports not_found when the request is unknown', async () => {
    mockCap.mockReturnValue({ mode: 'local', reason: 'test' });
    mockResolve.mockReturnValue(false);
    const res = await POST(body({ buildSessionId: 'b1', requestId: 'ghost', decision: 'allow' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, reason: 'not_found' });
  });
});
