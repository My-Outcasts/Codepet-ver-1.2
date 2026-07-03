import { test } from 'node:test';
import assert from 'node:assert/strict';
import { narrate, extractLastAssistantText } from './narrate.mjs';

test('extractLastAssistantText pulls the last assistant text (type:assistant)', () => {
  const jsonl = [
    JSON.stringify({ type: 'user', message: { content: 'hi' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'first' }] } }),
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'hmm' },
          { type: 'text', text: 'second' },
          { type: 'tool_use', name: 'Edit', input: {} },
        ],
      },
    }),
  ].join('\n');
  assert.equal(extractLastAssistantText(jsonl), 'second');
});

test('extractLastAssistantText supports type:message role:assistant', () => {
  const jsonl = JSON.stringify({
    type: 'message',
    role: 'assistant',
    message: { content: [{ type: 'text', text: 'hey' }] },
  });
  assert.equal(extractLastAssistantText(jsonl), 'hey');
});

test('extractLastAssistantText skips malformed lines and empties safely', () => {
  assert.equal(extractLastAssistantText('not json\n{bad'), '');
  assert.equal(extractLastAssistantText(''), '');
  assert.equal(extractLastAssistantText(null), '');
});

test('narrate classifies test intent', () => {
  assert.equal(
    narrate('I will add a test for login'),
    "Claude's running tests — nice, playing it safe 🧪",
  );
});

test('narrate classifies fix intent', () => {
  assert.equal(narrate('Fixing the bug in auth'), "Claude's patching something up 🔧");
});

test('narrate classifies build intent', () => {
  assert.equal(narrate('I will implement the form'), "Claude's building a new piece ✨");
});

test('narrate classifies tidy intent', () => {
  assert.equal(narrate('Let me refactor this module'), "Claude's tidying up the code 🧹");
});

test('narrate falls back to a cleaned snippet with no intent keyword', () => {
  const line = narrate('Here is the **plan** we should follow now.');
  assert.match(line, /^Byte sees Claude: "/);
  assert.ok(!line.includes('**'), 'markdown stripped');
});

test('narrate caps the snippet length', () => {
  const line = narrate('word '.repeat(80).trim()); // long, no keywords
  assert.ok(line.length <= 160, `got ${line.length}`);
});

test('narrate falls back to the tool name on empty text', () => {
  assert.equal(narrate('', 'Edit'), 'Byte sees Claude working with Edit…');
});

test('narrate handles no text and no tool', () => {
  assert.equal(narrate('', ''), "Claude's thinking it through…");
});

test('narrate never throws on odd input', () => {
  assert.doesNotThrow(() => narrate(null));
  assert.doesNotThrow(() => narrate(undefined, null));
});
