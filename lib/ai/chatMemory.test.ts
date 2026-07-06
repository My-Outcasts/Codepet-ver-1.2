import { describe, it, expect } from 'vitest';
import { worthExtracting, buildChatExtractPrompt, CHAT_MEMORY_SCHEMA } from './chatMemory';
import type { DecisionEntry } from './projectModel';

describe('worthExtracting', () => {
  it('keeps a substantive statement of fact', () => {
    expect(worthExtracting('We just crossed 300 people on the waitlist.')).toBe(true);
    expect(worthExtracting("We're dropping the free tier and going paid-only.")).toBe(true);
  });

  it('rejects messages that are too short', () => {
    expect(worthExtracting('ok')).toBe(false);
    expect(worthExtracting('thanks!')).toBe(false);
    expect(worthExtracting('   ')).toBe(false);
  });

  it('rejects task commands to byte (handled by run_task, not memory)', () => {
    expect(worthExtracting('run the launch email for me')).toBe(false);
    expect(worthExtracting('draft a pricing page please')).toBe(false);
    expect(worthExtracting('Open the marketing department now')).toBe(false);
  });

  it('rejects a bare question with no declarative clause', () => {
    expect(worthExtracting('what should I do next with marketing?')).toBe(false);
    expect(worthExtracting('how does the dictionary feature work?')).toBe(false);
  });

  it('keeps a statement even if it ends with a question, when it also asserts a fact', () => {
    // Declarative clause present (has a period) → let the extractor judge it.
    expect(worthExtracting('Our waitlist is at 300. Should we launch now?')).toBe(true);
  });
});

describe('buildChatExtractPrompt', () => {
  const existing: DecisionEntry[] = [
    { topic: 'pricing', statement: 'Pro tier is $12/mo', updatedAt: 1 },
  ];

  it('shows existing memory so the model can update a topic instead of duplicating', () => {
    const p = buildChatExtractPrompt('waitlist is at 300 now', existing);
    expect(p).toContain('pricing: Pro tier is $12/mo');
    expect(p).toContain('UPDATES it');
  });

  it('embeds the founder message and forbids invention', () => {
    const p = buildChatExtractPrompt('we hit 300 on the waitlist', []);
    expect(p).toContain('we hit 300 on the waitlist');
    expect(p).toMatch(/never infer or invent/i);
    expect(p).toContain('(none yet)');
  });

  it('clips an overlong message', () => {
    const p = buildChatExtractPrompt('x'.repeat(4000), []);
    expect(p.length).toBeLessThan(2500);
  });
});

describe('CHAT_MEMORY_SCHEMA', () => {
  it('is a strict object schema listing every property in required', () => {
    const item = (CHAT_MEMORY_SCHEMA.properties as Record<string, { items?: unknown }>).memory
      .items as {
      additionalProperties: boolean;
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(item.additionalProperties).toBe(false);
    // required must list topic + statement (the non-optional keys)
    expect(item.required).toContain('topic');
    expect(item.required).toContain('statement');
  });
});
