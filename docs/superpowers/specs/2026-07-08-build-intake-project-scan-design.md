# Let's build: project-first intake with a scan-grounded brainstorm (2026-07-08)

The intake flips order: **pick the project first**, then Byte reads it (a quick
scan) and brainstorms with questions grounded in the real codebase, then plans
and builds. Scanning must also work when the app is deployed (hosted): the scan
CLI on the founder's machine uploads a compact per-project summary, and hosted
intake reads that stored summary.

## Flow

1. **Tap "🔨 Let's build"** → Byte posts a project-picker card in chat
   (dropdown of scanned projects, or a typed path when none). "Never mind"
   still exits.
2. **Pick a project** → the app fetches a `ProjectBrief`:
   - **Local:** scan the directory live (server action; fs is this machine).
   - **Hosted:** use the stored brief the scan CLI uploaded (may be a little
     stale — good enough for questions). None stored → generic intake.
     Byte opens with what it saw: framework, key deps, folders.
3. **Brainstorm** — each founder turn calls `/api/build-intake` (authed like
   `/api/build-plan`): scan text + conversation so far → ONE short, concrete
   follow-up question grounded in the project (or "I have enough"). Scripted
   lines remain the fallback on any failure; "Turn this into a plan →" is
   always offered after the first answer. At most ~3 AI questions.
4. **Plan** — `PlanInput` gains `context` (the scan text) so steps match the
   real codebase. The plan card no longer shows a project picker (already
   chosen; a read-only row instead). Autonomy dial + Start building unchanged.

## Pieces

- `lib/installer/projectBrief.mjs` — pure-ish summarizer shared by the scan CLI
  and the server action: package.json deps, README first lines, top-2-level
  folder names (node_modules/.git/build dirs skipped), framework detection.
  Emits a bounded `brief` object + `briefText()` (prompt-ready, ~1000 chars).
- Schema/ingest — `ScannedProject.brief?` stored per project;
  `sanitizeProjects` bounds it; the scan CLI includes briefs in its POST
  (still no file contents beyond README excerpt + dependency names).
- `app/actions/build.ts#scanProject(dir)` — local, on-demand brief.
- `lib/ai/intake.ts` + `/api/build-intake` — sanitize {context?, turns[]},
  prompt, INTAKE_SCHEMA `{say, enough}`; same auth/key/model pattern as
  build-plan. Client helper `requestIntakeReply` throws typed errors so the
  store can fall back to scripted copy.
- Store — new chat card kind `buildPick`; `chooseBuildProject(name)` (marks the
  card, scans, posts the scan-informed opening); `buildScan` state feeds both
  intake calls and `generateBuildPlan`; intake follow-ups are AI with scripted
  fallback, capped at 3 questions.
- Copilot — renders the picker card; the plan card's picker becomes a
  read-only "Project: X" row.

## Error handling

- Scan fails / no stored brief → Byte's opening is the generic one; intake
  still works (context just absent).
- `/api/build-intake` fails or is slow → the scripted follow-up + to-plan
  button appear, exactly the old behavior.
- Cancel intake also retires any un-chosen picker card.

## Testing

- Summarizer: node --test on a temp fixture dir (framework/dep/dir caps).
- sanitizeProjects with briefs (bounds, garbage).
- plan prompt with `context`; intake sanitize/prompt/schema.
- buildFlow scan-opening line.
- Manual: local pick→scan→question grounded in deps; hosted with uploaded
  brief; hosted without brief (generic).
