import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockedFunction } from 'vitest';

vi.mock('@/lib/github/state', () => ({
  verifyState: vi.fn(),
}));

vi.mock('@/lib/firebase/companyDataAdmin', () => ({
  setCompanyGithub: vi.fn(),
  setCompanyGithubUserToken: vi.fn(),
}));

vi.mock('@/lib/github/appAuth', () => ({
  exchangeUserCode: vi.fn(),
}));

import { GET } from './route';
import { verifyState } from '@/lib/github/state';
import { setCompanyGithub, setCompanyGithubUserToken } from '@/lib/firebase/companyDataAdmin';
import { exchangeUserCode } from '@/lib/github/appAuth';

const mockVerifyState = verifyState as MockedFunction<typeof verifyState>;
const mockSetCompanyGithub = setCompanyGithub as MockedFunction<typeof setCompanyGithub>;
const mockSetCompanyGithubUserToken = setCompanyGithubUserToken as MockedFunction<
  typeof setCompanyGithubUserToken
>;
const mockExchangeUserCode = exchangeUserCode as MockedFunction<typeof exchangeUserCode>;

function req(query: string): Request {
  return new Request(`https://app/api/github/callback${query}`);
}

beforeEach(() => {
  mockVerifyState.mockReset();
  mockSetCompanyGithub.mockReset();
  mockSetCompanyGithub.mockResolvedValue(undefined);
  mockSetCompanyGithubUserToken.mockReset();
  mockSetCompanyGithubUserToken.mockResolvedValue(undefined);
  mockExchangeUserCode.mockReset();
});

describe('GET /api/github/callback', () => {
  it('401s on a bad/forged state and does NOT bind an installation to any company', async () => {
    mockVerifyState.mockReturnValue(null);
    const res = await GET(req('?installation_id=123&state=forged'));
    expect(res.status).toBe(401);
    expect(mockSetCompanyGithub).not.toHaveBeenCalled();
  });

  it('400s when installation_id is missing (valid state)', async () => {
    mockVerifyState.mockReturnValue({ companyId: 'co1', nonce: 'abc' });
    const res = await GET(req('?state=good'));
    expect(res.status).toBe(400);
    expect(mockSetCompanyGithub).not.toHaveBeenCalled();
  });

  it('400s when installation_id is blank (valid state)', async () => {
    mockVerifyState.mockReturnValue({ companyId: 'co1', nonce: 'abc' });
    const res = await GET(req('?installation_id=&state=good'));
    expect(res.status).toBe(400);
    expect(mockSetCompanyGithub).not.toHaveBeenCalled();
  });

  it('binds the installation to the verified companyId and redirects, on success', async () => {
    mockVerifyState.mockReturnValue({ companyId: 'co1', nonce: 'abc' });
    const res = await GET(req('?installation_id=123&state=good&setup_action=install'));
    expect(mockSetCompanyGithub).toHaveBeenCalledWith('co1', { installationId: '123', login: '' });
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
  });

  it('exchanges the code for a user token and stores it, when exchange succeeds', async () => {
    mockVerifyState.mockReturnValue({ companyId: 'co1', nonce: 'abc' });
    mockExchangeUserCode.mockResolvedValue('ghu_token');
    const res = await GET(req('?installation_id=123&state=good&code=abc123'));
    expect(mockExchangeUserCode).toHaveBeenCalledWith('abc123');
    expect(mockSetCompanyGithubUserToken).toHaveBeenCalledWith('co1', 'ghu_token');
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
  });

  it('does not store a user token when the exchange fails, but still binds and redirects', async () => {
    mockVerifyState.mockReturnValue({ companyId: 'co1', nonce: 'abc' });
    mockExchangeUserCode.mockResolvedValue(null);
    const res = await GET(req('?installation_id=123&state=good&code=abc123'));
    expect(mockExchangeUserCode).toHaveBeenCalledWith('abc123');
    expect(mockSetCompanyGithubUserToken).not.toHaveBeenCalled();
    expect(mockSetCompanyGithub).toHaveBeenCalledWith('co1', { installationId: '123', login: '' });
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
  });

  it('does not attempt an exchange when no code is present, but still binds and redirects', async () => {
    mockVerifyState.mockReturnValue({ companyId: 'co1', nonce: 'abc' });
    const res = await GET(req('?installation_id=123&state=good'));
    expect(mockExchangeUserCode).not.toHaveBeenCalled();
    expect(mockSetCompanyGithubUserToken).not.toHaveBeenCalled();
    expect(mockSetCompanyGithub).toHaveBeenCalledWith('co1', { installationId: '123', login: '' });
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
  });
});
