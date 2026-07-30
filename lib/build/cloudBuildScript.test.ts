import { describe, it, expect } from 'vitest';
import { cloudBuildScript, DEMO_DIR_CLOUD, BUILD_TOKEN_CAP } from './cloudBuildScript';

const base = {
  openingPrompt: "Let's build: a coffee shop landing page",
  apiUrl: 'https://app.codepet.com',
  companyId: 'co1',
  token: 'ingest-123',
  buildSessionId: 'b-9',
};

describe('cloudBuildScript', () => {
  it('seeds the demo dir, runs claude watch-only, self-reports and finalizes', () => {
    const s = cloudBuildScript(base);
    expect(s).toContain(DEMO_DIR_CLOUD);
    expect(s).toContain('claude');
    expect(s).toContain('--output-format stream-json');
    expect(s).toContain('--permission-mode bypassPermissions');
    expect(s).toContain('/api/track/live');
    expect(s).toContain('/api/build/cloud-finalize');
    expect(s).toContain('b-9'); // buildSessionId baked in
    expect(s).toContain('ingest-123'); // ingest token baked in
  });

  it('bakes the token cap and a trap so it finalizes even on error', () => {
    expect(cloudBuildScript(base)).toContain(String(BUILD_TOKEN_CAP));
    expect(cloudBuildScript(base)).toContain('trap');
  });

  it('never embeds the anthropic key (that comes from sandbox env)', () => {
    expect(cloudBuildScript(base)).not.toContain('ANTHROPIC_API_KEY=');
  });

  it('respects a custom token cap', () => {
    expect(cloudBuildScript({ ...base, tokenCap: 42 })).toContain('42');
  });
});
