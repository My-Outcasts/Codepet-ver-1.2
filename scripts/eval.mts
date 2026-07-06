// byte quality-eval runner (on-demand: `npm run eval`). For each golden case it generates
// the deliverable via the REAL pipeline (composeProjectModel + the real KINDS schema +
// instruction), then has a cheaper model judge it against the rubric, then prints a
// pass/fail table + aggregate. NOT wired into CI (it calls the paid API); needs
// ANTHROPIC_API_KEY (read from .env.local) and a positive credit balance.
//
// The scoring logic lives in lib/ai/eval/rubric.ts (pure, unit-tested); this is just the
// wiring. Fidelity note: GEN_SYSTEM mirrors the route's BYTE_SYSTEM (voice + grounding
// clause); the substance under test — company context + the real per-type instruction +
// schema — is imported directly, so it can't drift.
import { readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { composeProjectModel } from '../lib/ai/projectModel';
import { STRUCTURED_SCHEMAS, DELIVERABLE_INSTRUCTIONS } from '../lib/ai/deliverableSchemas';
import { generateJson, generateText } from '../lib/ai/client';
import { GOLDEN_CASES } from '../lib/ai/eval/goldens';
import {
  JUDGE_SCHEMA,
  JUDGE_SYSTEM,
  buildJudgePrompt,
  summarize,
  verdictAverage,
  type Verdict,
  type EvalResult,
} from '../lib/ai/eval/rubric';

const GEN_SYSTEM =
  'You are byte, the AI building companion inside Codepet. You produce real, ready-to-use deliverables for a founder building their company with AI — not descriptions of deliverables.\n\nGround everything in the company context you’re given: use the founder’s real product, names, numbers, audience, and decisions. Never invent facts — no made-up metrics, customers, integrations, or features. Prefer depth over length.\n\nVoice: warm, plain-language, confident, specific. No hype, no emoji, no clichés.';

function loadKey(): string {
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  const m = env.match(/ANTHROPIC_API_KEY=(.+)/);
  const key = m?.[1]?.trim().replace(/^["']|["']$/g, '');
  if (!key) throw new Error('ANTHROPIC_API_KEY not found in .env.local');
  return key;
}

function genPrompt(context: string, taskTitle: string, kind: string): string {
  return [
    `Company context: ${context}`,
    '',
    `Task: ${taskTitle}`,
    '',
    DELIVERABLE_INSTRUCTIONS[kind as keyof typeof DELIVERABLE_INSTRUCTIONS],
    '',
    'Produce the deliverable now.',
  ].join('\n');
}

async function main() {
  const client = new Anthropic({ apiKey: loadKey(), maxRetries: 3 });
  const results: EvalResult[] = [];

  for (const c of GOLDEN_CASES) {
    const context = composeProjectModel({ brief: c.brief }) || '';
    try {
      // 1) Generate the deliverable through the real schema + instruction (Opus).
      const payload = await generateJson<unknown>({
        client,
        system: GEN_SYSTEM,
        prompt: genPrompt(context, c.taskTitle, c.kind),
        maxTokens: 4096,
        label: `eval-gen:${c.id}`,
        schema: STRUCTURED_SCHEMAS[c.kind],
      });
      const output = JSON.stringify(payload, null, 2);

      // 2) Judge it against the rubric (cheaper model).
      const verdict = await generateJson<Verdict>({
        client,
        model: 'claude-sonnet-5',
        system: JUDGE_SYSTEM,
        prompt: buildJudgePrompt(context, c.taskTitle, c.kind, output),
        maxTokens: 1024,
        label: `eval-judge:${c.id}`,
        schema: JUDGE_SCHEMA,
      });

      results.push({ label: c.id, verdict });
      const avg = verdictAverage(verdict).toFixed(2);
      console.info(
        `  ${c.id.padEnd(16)} avg ${avg}  g${verdict.grounded} s${verdict.specific} h${verdict.honest} a${verdict.actionable}` +
          (verdict.honest < 4 ? `  ⚠ honest: ${verdict.honestWhy}` : ''),
      );
    } catch (err) {
      console.error(`  ${c.id.padEnd(16)} FAILED: ${(err as Error).message}`);
    }
  }

  const s = summarize(results);
  console.info('\n===== byte quality eval =====');
  console.info(
    `cases scored: ${s.n}/${GOLDEN_CASES.length}   pass: ${s.passed}/${s.n} (${Math.round(
      s.passRate * 100,
    )}%)   overall avg: ${s.overall.toFixed(2)}`,
  );
  console.info(
    `by dimension: grounded ${s.byDimension.grounded.toFixed(2)}  specific ${s.byDimension.specific.toFixed(2)}  honest ${s.byDimension.honest.toFixed(2)}  actionable ${s.byDimension.actionable.toFixed(2)}`,
  );
  if (s.failures.length) {
    console.info('\nfailing cases:');
    for (const f of s.failures) {
      console.info(`  ${f.label} (avg ${f.average.toFixed(2)}) — ${f.verdict.honestWhy}`);
    }
  }
  process.exitCode = s.n > 0 && s.passRate < 0.8 ? 1 : 0;
}

main().catch((err) => {
  console.error('eval run failed:', err);
  process.exitCode = 1;
});
