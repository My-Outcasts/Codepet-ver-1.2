// The bundled, real Claude Code toolkit Codepet installs into ~/.claude.
// `id` is a kebab-case slug; `source` is relative to the repo `toolkit/` dir.
export const TOOLKIT = [
  {
    id: 'prd-writer',
    name: 'PRD writer',
    type: 'skill',
    source: 'skills/prd-writer/SKILL.md',
    desc: 'Turn a rough idea into a structured product spec.',
  },
  {
    id: 'code-review',
    name: 'Code review',
    type: 'skill',
    source: 'skills/code-review/SKILL.md',
    desc: 'Review a diff for bugs before it ships.',
  },
  {
    id: 'test-writer',
    name: 'Test Writer',
    type: 'agent',
    source: 'agents/test-writer.md',
    desc: 'A subagent that writes tests for new code.',
  },
];
