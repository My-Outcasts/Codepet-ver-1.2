// Unit tests for the pure helpers in the E2B sandbox runner (cloud-run.mjs). Only the
// side-effect-free logic is covered here — the streaming/spawn/git/network runtime is
// exercised by the manual E2E in docs/e2b-template.md. Lives under e2b/ (excluded from
// tsconfig) but is still collected by vitest's `**/*.test.ts` glob.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs runner module, resolved by vitest/esbuild (no types).
import {
  usageTokens,
  liveEventsFor,
  includeDemoFile,
  repoFinalizeStatus,
  demoFinalizeStatus,
} from './cloud-run.mjs';

describe('usageTokens', () => {
  it('sums the four usage fields like tokenReportSuffix', () => {
    expect(
      usageTokens({
        input_tokens: 10,
        output_tokens: 20,
        cache_creation_input_tokens: 3,
        cache_read_input_tokens: 100,
      }),
    ).toBe(133);
  });
  it('treats missing / non-numeric fields as 0', () => {
    expect(usageTokens({ input_tokens: 5 })).toBe(5);
    expect(usageTokens({ input_tokens: 'x', output_tokens: NaN })).toBe(0);
    expect(usageTokens(null)).toBe(0);
    expect(usageTokens(undefined)).toBe(0);
  });
});

describe('liveEventsFor', () => {
  it('maps system/init to a start event', () => {
    expect(liveEventsFor({ type: 'system', subtype: 'init', session_id: 's' })).toEqual([
      { kind: 'start' },
    ]);
  });
  it('maps each assistant tool_use block to a tool event', () => {
    const obj = {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Edit' },
          { type: 'text', text: 'ignored when a tool is present' },
          { type: 'tool_use', name: 'Bash' },
        ],
      },
    };
    expect(liveEventsFor(obj)).toEqual([
      { kind: 'tool', tool: 'Edit' },
      { kind: 'tool', tool: 'Bash' },
    ]);
  });
  it('maps an assistant text-only message to a turn (truncated to 160)', () => {
    const long = 'x'.repeat(200);
    const [ev] = liveEventsFor({
      type: 'assistant',
      message: { content: [{ type: 'text', text: long }] },
    });
    expect(ev.kind).toBe('turn');
    expect(ev.say).toHaveLength(160);
  });
  it('maps a result line to a turn from its result text', () => {
    expect(liveEventsFor({ type: 'result', result: 'done' })).toEqual([
      { kind: 'turn', say: 'done' },
    ]);
  });
  it('skips user / tool-result / empty lines', () => {
    expect(liveEventsFor({ type: 'user', message: { content: [] } })).toEqual([]);
    expect(liveEventsFor({ type: 'assistant', message: { content: [] } })).toEqual([]);
    expect(liveEventsFor(null)).toEqual([]);
  });
});

describe('includeDemoFile', () => {
  it('keeps web/text files', () => {
    expect(includeDemoFile('index.html')).toBe(true);
    expect(includeDemoFile('assets/app.css')).toBe(true);
    expect(includeDemoFile('src/main.tsx')).toBe(true);
  });
  it('drops dotfiles, node_modules, and traversal / non-web files', () => {
    expect(includeDemoFile('.env')).toBe(false);
    expect(includeDemoFile('node_modules/react/index.js')).toBe(false);
    expect(includeDemoFile('.git/config')).toBe(false);
    expect(includeDemoFile('../escape.html')).toBe(false);
    expect(includeDemoFile('bin/tool')).toBe(false); // no web extension
    expect(includeDemoFile('')).toBe(false);
  });
});

describe('finalize status', () => {
  it('repo charges only on a real pushed PR', () => {
    expect(repoFinalizeStatus({ pushed: true, prUrl: 'https://github.com/o/r/pull/1' })).toBe('ok');
    expect(repoFinalizeStatus({ pushed: true, prUrl: undefined })).toBe('error');
    expect(repoFinalizeStatus({ pushed: false, prUrl: 'https://x' })).toBe('error');
  });
  it('demo charges only on a clean completion', () => {
    expect(demoFinalizeStatus({ capped: false, exitCode: 0 })).toBe('ok');
    expect(demoFinalizeStatus({ capped: true, exitCode: 0 })).toBe('capped');
    expect(demoFinalizeStatus({ capped: false, exitCode: 1 })).toBe('error');
  });
});
