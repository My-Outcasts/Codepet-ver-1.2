# Codepet — v1.2

> Your AI building companion. Run your whole company with AI, department by department — **byte** drafts and builds with you, and you approve every move.

This is the Next.js implementation of Codepet, ported from the v2 web draft into a real, componentized web app.

## Stack

- **Next.js (App Router)** + **React 19** + **TypeScript**
- Hand-tuned CSS (no framework) — design tokens matched to the macOS Swift app
- Single-page, desktop-style UI (view switching, no URL routes) backed by a small React context store

## What's inside

A simulated AI cofounder experience:

- **Onboarding** — splash → an 8-step intake (about you, your project, stage) that always shows on load
- **Company** — your eight departments as cover-art folder cards
- **Roadmap** — a branching journey graph (idea → growth) with computed SVG edges and a stage detail drawer
- **Department detail** — what each department needs, with tasks byte can do, draft, or hand to you
- **Tasks** — every task grouped by who it waits on (Needs you / byte is doing / Done)
- **Library** — everything byte has shipped or drafted, kept in one place (live-site previews, PRs, posts, emails, models, checklists…)
- **Environment** — guided-first Claude Code setup (skills, connectors, agents)
- **Artifact flow** — run a task and watch byte **Execute → Deliver**, review the real artifact, **request changes** (byte runs another pass), and **approve** to ship it to your Library

## Project layout

```
app/            layout, page, globals.css (the hand-tuned styles)
components/      shell (Topbar/Sidebar/Copilot), Onboarding, views/, artifact/ (modal + viewers)
lib/            data.ts (DEPTS, PHASES, ENV, sites…), helpers.ts, roadmap.ts, store.tsx
public/         covers/, byte.png, splash.png, Minecraft.ttf
```

## Develop

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build + type-check
```
