// Local narration for the Build Coach live hook. Pure, framework-free, and
// unit-tested with `node --test`. The installed live hook (codepet-live.mjs)
// imports these to turn Claude's raw assistant text into ONE short Byte-voice
// line — WITHOUT the raw text ever leaving the machine. Kept beside the hook so
// the relative `import './narrate.mjs'` resolves in-repo and after install.
// See docs/superpowers/specs/2026-07-03-build-coach-response-narration-design.md.

const SNIPPET_CAP = 120;

/** Concatenate the LAST assistant message's text blocks from a transcript JSONL
 *  string. Accepts both observed entry shapes. Returns '' when none/unparseable. */
export function extractLastAssistantText(jsonl) {
  if (typeof jsonl !== 'string' || !jsonl.trim()) return '';
  let last = null;
  for (const line of jsonl.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let entry;
    try {
      entry = JSON.parse(t);
    } catch {
      continue;
    }
    const isAssistant =
      entry?.type === 'assistant' ||
      (entry?.type === 'message' && entry?.role === 'assistant') ||
      entry?.role === 'assistant';
    if (isAssistant) last = entry;
  }
  if (!last) return '';
  const content = last?.message?.content ?? last?.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/** Strip markdown noise, collapse whitespace, take the first sentence, hard-cap. */
function snippet(text) {
  const clean = text
    .replace(/```[\s\S]*?```/g, ' ') // fenced code
    .replace(/`[^`]*`/g, ' ') // inline code
    .replace(/[*_#>~]/g, ' ') // emphasis / headers / quotes
    .replace(/\s+/g, ' ')
    .trim();
  const firstSentence = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
  return firstSentence.length > SNIPPET_CAP
    ? firstSentence.slice(0, SNIPPET_CAP).trim() + '…'
    : firstSentence;
}

/** Turn Claude's raw assistant text (and, as a fallback, the active tool name)
 *  into one short Byte-voice line. Deterministic; total (never throws). */
export function narrate(text, toolName) {
  const t = typeof text === 'string' ? text : '';
  const low = t.toLowerCase();
  if (/\btest(s|ing|ed)?\b/.test(low)) return "Claude's running tests — nice, playing it safe 🧪";
  if (/\b(fix|fixing|bug|error|broken)\b/.test(low)) return "Claude's patching something up 🔧";
  if (/\b(add|adding|create|implement|build|building|new)\b/.test(low))
    return "Claude's building a new piece ✨";
  if (/\b(refactor|clean|tidy|rename)\b/.test(low)) return "Claude's tidying up the code 🧹";
  if (t.trim()) return `Byte sees Claude: "${snippet(t)}"`;
  if (typeof toolName === 'string' && toolName.trim())
    return `Byte sees Claude working with ${toolName.trim()}…`;
  return "Claude's thinking it through…";
}
