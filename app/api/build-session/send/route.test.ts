import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockedFunction } from 'vitest';

vi.mock('@/lib/liveSession/engine', () => ({ sendTurn: vi.fn() }));
vi.mock('@/lib/installer/capability.mjs', () => ({ detectCapability: vi.fn() }));

import { POST } from './route';
import { sendTurn } from '@/lib/liveSession/engine';
import { detectCapability } from '@/lib/installer/capability.mjs';

const mockSend = sendTurn as MockedFunction<typeof sendTurn>;
const mockCap = detectCapability as MockedFunction<typeof detectCapability>;

const body = (b: unknown) =>
  new Request('http://localhost/api/build-session/send', {
    method: 'POST',
    body: JSON.stringify(b),
  });

beforeEach(() => {
  mockSend.mockReset();
  mockCap.mockReset();
});

describe('POST /api/build-session/send', () => {
  it('refuses in remote mode', async () => {
    mockCap.mockReturnValue({ mode: 'remote', reason: 'test' });
    const res = await POST(body({ buildSessionId: 'b1', text: 'hi' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, reason: 'remote' });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('sends a turn in local mode', async () => {
    mockCap.mockReturnValue({ mode: 'local', reason: 'test' });
    mockSend.mockReturnValue(true);
    const res = await POST(body({ buildSessionId: 'b1', text: 'now add tests' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockSend).toHaveBeenCalledWith('b1', 'now add tests');
  });

  it('rejects a bad body', async () => {
    mockCap.mockReturnValue({ mode: 'local', reason: 'test' });
    const res = await POST(body({ buildSessionId: '', text: '' }));
    expect(res.status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('reports not_running when sendTurn fails', async () => {
    mockCap.mockReturnValue({ mode: 'local', reason: 'test' });
    mockSend.mockReturnValue(false);
    const res = await POST(body({ buildSessionId: 'b1', text: 'hi' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, reason: 'not_running' });
  });
});
