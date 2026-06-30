---
name: code-review
description: Use when reviewing a diff before it ships — checks correctness, edge cases, and clarity, and reports findings by severity.
---

# Code Review

Review the current diff for correctness and clarity.

## Checklist
- Correctness: does it do what the change intends? Off-by-one, null/empty, error paths.
- Edge cases: boundary inputs, concurrency, failure modes.
- Clarity: names match behavior; no dead code; no accidental scope creep.

Report findings grouped as Critical / Important / Minor, each with a file:line and a one-line fix.
