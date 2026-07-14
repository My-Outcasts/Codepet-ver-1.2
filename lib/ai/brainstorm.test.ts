import { describe, it, expect } from 'vitest';
import {
  sanitizeBrainstormInput,
  buildBrainstormPrompt,
  BRAINSTORM_SCHEMA,
} from './brainstorm';

describe('sanitizeBrainstormInput', () => {
  it('keeps valid byte/user turns and trims text', () => {
    const out = sanitizeBrainstormInput({
      conversation: [
        { role: 'byte', text: '  who is it for?  ' },
        { role: 'user', text: 'solo founders' },
      ],
    });
    expect(out).toEqual({
      conversation: [
        { role: 'byte', text: 'who is it for?' },
        { role: 'user', text: 'solo founders' },
      ],
    });
  });

  it('returns null without at least one user turn', () => {
    expect(sanitizeBrainstormInput({ conversation: [{ role: 'byte', text: 'hi' }] })).toBeNull();
    expect(sanitizeBrainstormInput({ conversation: [] })).toBeNull();
  });

  it('returns null for non-object / missing conversation', () => {
    expect(sanitizeBrainstormInput(null)).toBeNull();
    expect(sanitizeBrainstormInput({})).toBeNull();
    expect(sanitizeBrainstormInput({ conversation: 'nope' })).toBeNull();
  });

  it('drops malformed turns and caps text length', () => {
    const long = 'a'.repeat(500);
    const out = sanitizeBrainstormInput({
      conversation: [
        { role: 'alien', text: 'x' },
        { role: 'user', text: '' },
        { role: 'user', text: long },
      ],
    });
    expect(out?.conversation).toHaveLength(1);
    expect(out?.conversation[0].text.length).toBe(400);
  });

  it('keeps only the most recent 12 turns', () => {
    const conversation = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'byte' : 'user',
      text: `t${i}`,
    }));
    const out = sanitizeBrainstormInput({ conversation });
    expect(out?.conversation).toHaveLength(12);
    expect(out?.conversation[0].text).toBe('t8');
  });

  it('keeps a trimmed project and omits a blank one', () => {
    expect(
      sanitizeBrainstormInput({
        conversation: [{ role: 'user', text: 'x' }],
        project: '  Growth  ',
      })?.project,
    ).toBe('Growth');
    expect(
      sanitizeBrainstormInput({ conversation: [{ role: 'user', text: 'x' }], project: '  ' })
        ?.project,
    ).toBeUndefined();
  });
});

describe('buildBrainstormPrompt', () => {
  it('renders the transcript and the count of questions asked', () => {
    const p = buildBrainstormPrompt({
      conversation: [
        { role: 'byte', text: 'who is it for?' },
        { role: 'user', text: 'solo founders' },
        { role: 'byte', text: 'what problem?' },
        { role: 'user', text: 'tracking tokens' },
      ],
    });
    expect(p).toContain('Founder: solo founders');
    expect(p).toContain('Byte: who is it for?');
    expect(p).toContain('2 question');
  });

  it('includes the project when present and omits it otherwise', () => {
    const conversation = [{ role: 'user' as const, text: 'a' }];
    expect(buildBrainstormPrompt({ conversation, project: 'Growth' })).toContain('Growth');
    expect(buildBrainstormPrompt({ conversation })).not.toContain('Growth');
  });
});

describe('BRAINSTORM_SCHEMA', () => {
  it('is a strict object with kind enum and required text', () => {
    expect(BRAINSTORM_SCHEMA.additionalProperties).toBe(false);
    expect(BRAINSTORM_SCHEMA.required as string[]).toEqual(['kind', 'text']);
    const props = BRAINSTORM_SCHEMA.properties as Record<string, { type?: string; enum?: string[] }>;
    expect(props.kind?.enum).toEqual(['question', 'ready']);
    expect(props.text?.type).toBe('string');
  });
});
