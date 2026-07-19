import { describe, it, expect } from 'vitest';
import { repoBuildScript, REPO_BUILD_TOKEN_CAP } from './repoBuildScript';

const base = {
  openingPrompt: "Let's build: add a contact form",
  apiUrl: 'https://app.codepet.com',
  companyId: 'co1',
  ingestToken: 'ingest-123',
  buildSessionId: 'b-9',
  repo: { owner: 'acme', name: 'web' },
  installToken: 'ghs_installtoken',
};

describe('repoBuildScript', () => {
  it('clones the repo, branches, runs claude watch-only, self-reports, finalizes', () => {
    const s = repoBuildScript(base);
    expect(s).toContain('git clone');
    expect(s).toContain('acme/web');
    expect(s).toContain('codepet/b-9'); // the branch
    expect(s).toContain('--permission-mode bypassPermissions');
    expect(s).toContain('/api/track/live');
    expect(s).toContain('/api/build/repo-finalize');
    expect(s).toContain('ingest-123');
    expect(s).toContain(String(REPO_BUILD_TOKEN_CAP));
    expect(s).toContain('trap');
  });
  it('passes the install token via env, never claude/anthropic keys inline', () => {
    const s = repoBuildScript(base);
    expect(s).toContain('ghs_installtoken');
    expect(s).not.toContain('ANTHROPIC_API_KEY=');
    expect(s).not.toContain('GITHUB_APP_PRIVATE_KEY');
  });
});
