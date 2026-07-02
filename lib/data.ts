// Codepet v1.2 — data model (ported verbatim from the v2 web draft).
// The large SITE_* strings, DEPTS, OUTCOMES, PHASES, ENV, and roadmap graph
// are preserved exactly as authored in the draft.

export type Who = 'does' | 'draft' | 'you';

export interface Task {
  t: string;
  d?: string;
  who: Who;
  run?: 'route' | 'draft';
  out: string;
  done?: boolean;
  // Explicit deliverable type for tasks with no payload yet (e.g. byte-generated
  // stage tasks). artType() honours this first; authored tasks omit it and are
  // typed by the payload/run they carry.
  kind?: string;
  // optional rich-outcome payloads merged from OUTCOMES / authored inline:
  site?: string;
  // byte's structured site spec (what `site` HTML was rendered from) — kept so a
  // revise pass edits the spec rather than re-parsing the generated markup.
  siteSpec?: Record<string, unknown>;
  screens?: any[];
  sheet?: any;
  plan?: any;
  post?: any;
  email?: any;
  calendar?: any;
  legal?: any;
  dms?: any[];
  checklist?: any[];
  // runtime annotations:
  _item?: LibItem;
  _rev?: string;
  [key: string]: any;
}

export interface Dept {
  k: string;
  name: string;
  ab: string;
  status: 'attention' | 'ready' | 'idle';
  pend: number;
  need: string;
  byte: string;
  tasks: Task[];
}

export interface Stage {
  n: number;
  name: string;
  status: 'done' | 'now' | 'next';
  why: string;
  a: Array<string | { t: string; o?: string }>;
}
export interface Phase {
  name: string;
  stages: Stage[];
}

export interface EnvItem {
  n: string;
  ab: string;
  d: string;
  s: number;
  rec?: number;
  why?: string;
}

export interface LibItem {
  title: string;
  dept: string;
  k: string;
  ab: string;
  type: string;
  out: string;
  file: string;
  head: string;
  tag: string;
  site?: string;
  screens?: any[];
  sheet?: any;
  post?: any;
  email?: any;
  calendar?: any;
  legal?: any;
  dms?: any[];
  checklist?: any[];
  plan?: any;
}

/* ===== real, shippable sites byte builds (rendered live in iframes) ===== */
export const SITE_CODEPET = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Codepet — Stop shipping code you can't explain</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@400;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--page:#efece4;--ink:#2b2a26;--ink2:#5d5b53;--accent:#6E8E68;--accent2:#557150;--gold:#C9A227;--card:#fbf9f4;--line:#e3ddd0}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,system-ui,sans-serif;background:var(--page);color:var(--ink);line-height:1.5;-webkit-font-smoothing:antialiased}
.wrap{max-width:1080px;margin:0 auto;padding:0 28px}
nav{display:flex;align-items:center;gap:26px;padding:22px 0}
.logo{font-family:'Pixelify Sans',monospace;font-weight:700;font-size:20px;display:flex;align-items:center;gap:9px}
.logo .b{width:26px;height:26px;border-radius:7px;background:var(--accent);display:inline-block;position:relative;flex:none}
.logo .b:before{content:"";position:absolute;left:6px;top:9px;width:4px;height:4px;background:#fff;box-shadow:10px 0 #fff}
nav .nl{margin-left:auto;display:flex;gap:24px;font-size:14px;color:var(--ink2)}
nav a{color:inherit;text-decoration:none}
.btn{font-family:inherit;font-size:14px;font-weight:600;padding:10px 18px;border-radius:10px;border:0;cursor:pointer;text-decoration:none;display:inline-block}
.btn.p{background:var(--accent);color:#fff}
.btn.g{background:transparent;color:var(--ink);border:1px solid var(--line)}
header{text-align:center;padding:66px 0 24px}
.kicker{font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent2);margin-bottom:20px}
h1{font-family:'Pixelify Sans',monospace;font-size:60px;line-height:1.05;letter-spacing:-.5px;margin-bottom:22px}
h1 .hl{color:var(--accent)}
.sub{font-size:19px;color:var(--ink2);max-width:600px;margin:0 auto 30px}
.cta{display:flex;gap:12px;justify-content:center}
.shot{margin:52px auto 0;max-width:880px;background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:0 30px 60px -30px rgba(40,38,30,.32);overflow:hidden}
.shot .bar{display:flex;gap:7px;padding:13px 15px;border-bottom:1px solid var(--line)}
.shot .bar i{width:11px;height:11px;border-radius:50%;background:#d9d3c5;display:inline-block}
.shot .body{display:grid;grid-template-columns:1fr 1.25fr;gap:18px;padding:24px;text-align:left}
.recap{background:var(--page);border:1px solid var(--line);border-radius:12px;padding:18px}
.recap h4{font-family:'Pixelify Sans',monospace;font-size:15px;margin-bottom:10px}
.recap p{font-size:13px;color:var(--ink2);margin-bottom:8px}
.tag{display:inline-block;font-family:'JetBrains Mono',monospace;font-size:11px;background:rgba(110,142,104,.14);color:var(--accent2);padding:3px 9px;border-radius:99px;margin:3px 4px 0 0}
section{padding:60px 0}
.eyebrow{font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent2);text-align:center;margin-bottom:12px}
h2{font-family:'Pixelify Sans',monospace;font-size:36px;text-align:center;margin-bottom:44px}
.steps,.feat{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}
.step,.fcard{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:26px}
.step .n{font-family:'Pixelify Sans',monospace;font-size:13px;color:#fff;background:var(--accent);width:30px;height:30px;border-radius:8px;display:grid;place-items:center;margin-bottom:16px}
.step h3,.fcard h3{font-family:'Pixelify Sans',monospace;font-size:18px;margin-bottom:8px}
.step p,.fcard p{font-size:14px;color:var(--ink2)}
.quote{text-align:center;max-width:720px;margin:0 auto;font-size:25px;font-family:'Pixelify Sans',monospace;line-height:1.4}
.quote span{color:var(--ink2);font-family:Inter;font-size:14px;display:block;margin-top:18px}
.final{background:var(--accent);color:#fff;border-radius:20px;text-align:center;padding:58px 28px;margin:24px 0 64px}
.final h2{color:#fff;margin-bottom:14px}
.final .btn.p{background:#fff;color:var(--accent2)}
footer{border-top:1px solid var(--line);padding:26px 0;display:flex;align-items:center;gap:16px;font-size:13px;color:var(--ink2)}
footer .logo{font-size:16px}
@media(max-width:760px){h1{font-size:40px}.shot .body,.steps,.feat{grid-template-columns:1fr}nav .nl{display:none}}
</style></head><body>
<div class="wrap"><nav>
  <div class="logo"><span class="b"></span>Codepet</div>
  <div class="nl"><a href="#how">How it works</a><a href="#features">Features</a><a href="#">Build log</a></div>
  <a class="btn p" href="#">Download for macOS</a>
</nav></div>
<div class="wrap"><header>
  <div class="kicker">macOS · works with Claude Code</div>
  <h1>Stop shipping code<br>you <span class="hl">can't explain.</span></h1>
  <p class="sub">After every Claude Code session, byte recaps what you built in plain language, remembers what you're still learning, and grows with you.</p>
  <div class="cta"><a class="btn p" href="#">Download for macOS</a><a class="btn g" href="#">Join the waitlist</a></div>
  <div class="shot">
    <div class="bar"><i></i><i></i><i></i></div>
    <div class="body">
      <div class="recap"><h4>byte · session recap</h4>
        <p>You wired OAuth into the login flow and refactored the session store.</p>
        <p>One thing worth understanding:</p>
        <span class="tag">async/await</span><span class="tag">@EnvironmentObject</span><span class="tag">OAuth</span>
      </div>
      <div class="recap" style="background:var(--card)"><h4>Learns from your own code</h4>
        <p>byte tracks each concept from Encountered → Used → Mastered, pulled from the code you actually write.</p>
        <p style="color:var(--accent2);font-weight:600">3 terms leveled up this week ↑</p>
      </div>
    </div>
  </div>
</header></div>
<div class="wrap" id="how"><section>
  <div class="eyebrow">How it works</div>
  <h2>Three steps. Two minutes.</h2>
  <div class="steps">
    <div class="step"><div class="n">1</div><h3>Connect</h3><p>Point byte at the project you're working in. No code leaves your machine.</p></div>
    <div class="step"><div class="n">2</div><h3>Code as usual</h3><p>Run your Claude Code sessions like always. byte watches, quietly.</p></div>
    <div class="step"><div class="n">3</div><h3>Get your recap</h3><p>A plain-language recap of what you built — and one thing worth understanding.</p></div>
  </div>
</section></div>
<div class="wrap" id="features"><section>
  <div class="eyebrow">Why Codepet</div>
  <h2>Comprehension, not just code.</h2>
  <div class="feat">
    <div class="fcard"><h3>Plain-language recaps</h3><p>Every session, distilled into what you actually changed — no jargon wall.</p></div>
    <div class="fcard"><h3>Project-aware Dictionary</h3><p>Terms pulled from your own code, tracked from Encountered to Mastered.</p></div>
    <div class="fcard"><h3>Grows with you</h3><p>byte remembers what you're still learning and brings it back at the right moment.</p></div>
  </div>
</section></div>
<div class="wrap"><section><p class="quote">"Claude writes it. Codepet makes sure you get it."<span>— the senior dev who roots for you</span></p></section></div>
<div class="wrap"><div class="final">
  <h2>Build something you understand.</h2>
  <p style="opacity:.9;margin-bottom:24px;font-size:17px">The macOS beta opens to the first 100 this week.</p>
  <a class="btn p" href="#">Download for macOS</a>
</div></div>
<div class="wrap"><footer>
  <div class="logo"><span class="b"></span>Codepet</div>
  <span style="margin-left:auto">© 2026 Codepet · code-pet.com</span>
  <a href="#" style="color:inherit">Privacy</a><a href="#" style="color:inherit">Build log</a>
</footer></div>
</body></html>`;

/* a REAL help center page byte ships — native <details> accordions, no JS needed */
export const SITE_HELP = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Codepet — Help Center</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@400;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">
<style>
:root{--page:#efece4;--ink:#2b2a26;--ink2:#5d5b53;--accent:#6E8E68;--accent2:#557150;--card:#fbf9f4;--line:#e3ddd0}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,system-ui,sans-serif;background:var(--page);color:var(--ink);line-height:1.55;-webkit-font-smoothing:antialiased}
.wrap{max-width:760px;margin:0 auto;padding:0 26px}
header{text-align:center;padding:54px 0 34px}
.logo{font-family:'Pixelify Sans',monospace;font-weight:700;font-size:18px;display:inline-flex;align-items:center;gap:8px;margin-bottom:26px}
.logo .b{width:22px;height:22px;border-radius:6px;background:var(--accent);display:inline-block;position:relative}
.logo .b:before{content:"";position:absolute;left:5px;top:8px;width:3px;height:3px;background:#fff;box-shadow:8px 0 #fff}
h1{font-family:'Pixelify Sans',monospace;font-size:38px;margin-bottom:14px}
.search{display:flex;align-items:center;gap:10px;max-width:460px;margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px;color:var(--ink2);font-size:14px}
.search .mag{width:15px;height:15px;border:2px solid var(--ink2);border-radius:50%;position:relative;flex:none}
.search .mag:after{content:"";position:absolute;width:6px;height:2px;background:var(--ink2);transform:rotate(45deg);right:-4px;bottom:0}
.cats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:8px 0 44px}
.cat{background:var(--card);border:1px solid var(--line);border-radius:13px;padding:18px;text-align:center}
.cat .ic{font-family:'Pixelify Sans',monospace;font-size:18px;color:#fff;background:var(--accent);width:36px;height:36px;border-radius:10px;display:grid;place-items:center;margin:0 auto 11px}
.cat h3{font-family:'Pixelify Sans',monospace;font-size:14px;margin-bottom:4px}
.cat p{font-size:12px;color:var(--ink2)}
h2{font-family:'Pixelify Sans',monospace;font-size:22px;margin-bottom:16px}
details{background:var(--card);border:1px solid var(--line);border-radius:11px;margin-bottom:10px;overflow:hidden}
summary{padding:15px 18px;font-weight:600;font-size:14.5px;cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center}
summary::-webkit-details-marker{display:none}
summary:after{content:"+";font-family:'JetBrains Mono',monospace;color:var(--accent2);font-size:18px}
details[open] summary:after{content:"–"}
details p{padding:0 18px 16px;font-size:13.5px;color:var(--ink2)}
.contact{text-align:center;background:var(--accent);color:#fff;border-radius:16px;padding:34px;margin:40px 0 60px}
.contact h2{color:#fff;margin-bottom:8px}
.contact p{opacity:.9;font-size:14px;margin-bottom:18px}
.contact a{display:inline-block;background:#fff;color:var(--accent2);font-weight:600;font-size:14px;padding:10px 20px;border-radius:10px;text-decoration:none}
</style></head><body>
<div class="wrap">
<header>
  <div class="logo"><span class="b"></span>Codepet Help</div>
  <h1>How can byte help?</h1>
  <div class="search"><span class="mag"></span>Search the docs — “privacy”, “sessions”, “Dictionary”…</div>
</header>
<div class="cats">
  <div class="cat"><div class="ic">1</div><h3>Getting started</h3><p>Connect & your first recap</p></div>
  <div class="cat"><div class="ic">2</div><h3>Privacy</h3><p>What stays on your machine</p></div>
  <div class="cat"><div class="ic">3</div><h3>How byte learns</h3><p>The Dictionary & recaps</p></div>
</div>
<h2>Top questions</h2>
<details open><summary>Does Codepet send my code anywhere?</summary><p>No. Codepet reads your project on-device only. Your source is never uploaded or sold — byte stores only concept signals (which terms appeared), never the code itself.</p></details>
<details><summary>Which tools does it work with?</summary><p>Claude Code first. Cursor and Copilot support are next on the roadmap.</p></details>
<details><summary>Do I have to study?</summary><p>No. byte only resurfaces terms that look like they're slipping — a two-tap check, never homework.</p></details>
<details><summary>What's the pet actually for?</summary><p>byte grows as your understanding does. It's a companion that remembers what you're learning — not a toy and not a mascot.</p></details>
<details><summary>Will it write code for me?</summary><p>No, by design. Claude Code writes the code; Codepet makes sure you understand what shipped.</p></details>
<details><summary>How do I get to my first recap?</summary><p>Connect a project, run one normal Claude Code session, and byte hands you a plain-language recap in under two minutes.</p></details>
<div class="contact">
  <h2>Still stuck?</h2>
  <p>byte's team reads every message during the beta.</p>
  <a href="#">Message support</a>
</div>
</div>
</body></html>`;

/* ===== departments ===== */
export const DEPTS: Dept[] = [
  {
    k: 'eng',
    name: 'Engineering',
    ab: 'En',
    status: 'attention',
    pend: 2,
    need: 'Ship the two things the beta hinges on: a way to measure if testers stick, and the project-aware Dictionary.',
    byte: "Engineering is your strongest muscle, so I'll prep the work and draft a clear code-change plan for the buildable parts — the goal, the approach, and what it touches. You approve, then hand it to your coding agent to ship.",
    tasks: [
      {
        t: 'Instrument the dual go/no-go signal',
        d: 'Track "understands their code" + "feels more capable" after a week — the real beta question.',
        who: 'draft',
        out: 'Code-change plan ready — measure whether testers understand their code and feel more capable after a week.\n\nApproach:\n  1. Add four funnel events to the analytics seam (no new SDK).\n  2. Fire them at signup, the first recap, a review, and the day-7 check.\n  3. Assemble a comprehension + capability funnel.\n\nHand this plan to your coding agent to implement.',
      },
      {
        t: 'Ship the project-aware Dictionary',
        d: 'Surface terms from the user’s own code with Encountered → Used → Mastered tracking.',
        who: 'draft',
        out: 'Code-change plan ready — surface terms from the user’s own code with Encountered → Used → Mastered tracking.\n\nApproach:\n  1. Run an extraction pass over the active project to pull real terms.\n  2. Model an evolution state machine: Encountered → Used → Mastered.\n  3. Log a rep automatically when a term reappears in the user’s code.\n\nHand this plan to your coding agent to implement.',
      },
      {
        t: 'Spec the session-detection layer',
        d: 'Local-first transcript + hooks. Gates the entire post-beta coach model.',
        who: 'draft',
        out: 'SESSION DETECTION — SPEC v1\n\nGoal: know a Claude Code session happened, locally, without uploading code.\n\nApproach (local-first):\n  1. Watch ~/.claude transcripts + hook events\n  2. Extract concept signals (which terms/APIs appeared), then hash them\n  3. Store only the concept events — never the source\n\nPrivacy: nothing leaves the device by default; opt-in sync later.\nRecommendation: transcript as the primary signal, hooks as backup.\nGates: the Debrief, the Learner Model, and every coaching skill.',
      },
    ],
  },
  {
    k: 'mkt',
    name: 'Marketing',
    ab: 'Mk',
    status: 'attention',
    pend: 4,
    need: 'Activate the 1,504-person waitlist with the new positioning — and start the teaching-in-public loop.',
    byte: 'This is mostly writing and sequencing — I can do the heavy lifting and hand you drafts to approve in your voice.',
    tasks: [
      {
        t: 'Build the Codepet landing page',
        d: 'A real, shippable marketing site for launch — hero, how-it-works, features, CTA. byte builds and runs it.',
        who: 'does',
        run: 'route',
        site: SITE_CODEPET,
        out: 'Codepet landing page — built, ran in the sandbox on localhost:3001, verified in-browser. Ready to ship to code-pet.com.',
      },
      {
        t: 'Write the launch announcement post',
        d: 'For X + the waitlist, in the new "stop shipping code you can’t explain" frame.',
        who: 'does',
        run: 'draft',
        out: 'LAUNCH POST — for X + the waitlist\n\nVibe coding gives you code. Codepet gives you comprehension.\n\nAfter every Claude Code session, byte recaps what you built in plain language, remembers what you’re still learning, and grows with you. The macOS beta opens to the first 100 from the waitlist this week.\n\nStop shipping code you can’t explain. → code-pet.com\n\nHook variants to A/B:\n  1. “Claude writes it. Codepet makes sure you get it.”\n  2. “The pet that remembers what you’re still learning.”\n  3. “You shipped it with AI — but do you get it? byte does, and now you will too.”',
      },
      {
        t: 'Build the waitlist conversion email',
        d: 'Milestone-tied onboarding sequence from waitlist → active tester.',
        who: 'does',
        run: 'draft',
        out: 'WAITLIST → ACTIVE — 3-email sequence\n\nEmail 1 · you’re in\n“Your spot’s open. Run one session today — byte will recap what you built and flag one thing worth understanding. That’s it.”\n\nEmail 2 · day 3\n“Here’s what byte noticed in your code this week — and the term that keeps showing up. 30 seconds to lock it in.”\n\nEmail 3 · day 7\n“A week in — do you read what Claude’s doing more clearly than when you started? Two-tap check-in inside.”\n\nEach sends only when its TestFlight milestone is hit.',
      },
      {
        t: 'Plan a teaching-in-public content calendar',
        d: '2 posts/week around the agentic-coding movement.',
        who: 'draft',
        out: 'TEACHING-IN-PUBLIC — 2-week calendar (2 posts/wk)\n\nWeek 1\n  • Mon — “Term of the week from real code”: closures, explained like an envelope\n  • Thu — build-in-public thread: what shipped, what byte caught\n\nWeek 2\n  • Mon — a tester’s before/after: “code I couldn’t explain → can now”\n  • Thu — short clip: byte’s post-session recap in action\n\nVoice: the senior dev who roots for you. No hype.',
      },
    ],
  },
  {
    k: 'ops',
    name: 'Operations',
    ab: 'Op',
    status: 'attention',
    pend: 2,
    need: 'Stand up the machinery to run a 50–100 person closed beta and learn fast.',
    byte: 'Process work — I’ll set up the pipeline and the checklist; you just plug in your accounts.',
    tasks: [
      {
        t: 'Set up the TestFlight beta',
        d: 'Build distribution + a tight onboarding that hits first value in under 2 minutes.',
        who: 'you',
        out: 'TESTFLIGHT LAUNCH — checklist (you run, I track)\n\n  ☐ Create the “Codepet Beta” TestFlight group\n  ☐ Upload build 1.0 (b12) + export compliance\n  ☐ Invite copy: warm, 2 lines, one CTA\n  ☐ First-run script: connect → run a session → see your first recap (≤ 2 min)\n  ☐ Seed 10 internal testers before the 100 invites\n\nNeeds your Apple account — I’ll walk you through each step when you’re ready.',
      },
      {
        t: 'Wire the feedback + interview pipeline',
        d: 'In-app ratings → a place they collect, plus interview scheduling.',
        who: 'does',
        run: 'route',
        out: '✓ Built & verified.\n\n  • In-app feedback toast → writes to Firestore `feedback`\n  • A scheduling link for 15-min tester interviews\n  • 6 interview questions drafted (comprehension + capability focused)\n\nVerified: submitting the toast wrote a record and logged the event.\nOpen item before launch: add a Firestore create rule for `feedback`.',
      },
    ],
  },
  {
    k: 'fin',
    name: 'Finance',
    ab: 'Fi',
    status: 'ready',
    pend: 2,
    need: 'Validate the $10–15/mo price under a learning-companion frame before launch.',
    byte: 'I’ll build the model and structure the willingness-to-pay test; the decision stays yours.',
    tasks: [
      {
        t: 'Build the pricing model',
        d: 'A working model: price × waitlist × conversion → projected MRR/ARR, with the tier structure. Drag the inputs.',
        who: 'does',
        run: 'route',
        sheet: {
          inputs: [
            { k: 'price', label: 'Pro price / mo', val: 12, min: 6, max: 20, step: 1, pre: '$' },
            { k: 'wl', label: 'Waitlist size', val: 1504, min: 200, max: 5000, step: 1 },
            { k: 'conv', label: 'Waitlist → paid', val: 8, min: 1, max: 25, step: 1, suf: '%' },
            { k: 'churn', label: 'Monthly churn', val: 5, min: 1, max: 15, step: 1, suf: '%' },
          ],
        },
        out: 'Pricing model — built and stress-tested. At $12/mo and 8% waitlist conversion, the 1,504-person list seeds ~$1,444 MRR before any new acquisition. Tiers: Free (recaps only) · Pro $12 (Dictionary + history) · Team $20/seat. Drag the inputs to see the band.',
      },
      {
        t: 'Run a willingness-to-pay survey',
        d: 'Van Westendorp-style, framed vs. Duolingo/Mimo, not Cursor seats.',
        who: 'does',
        run: 'draft',
        out: 'WILLINGNESS-TO-PAY — survey (learning-companion frame)\n\nIntro: “Codepet is a coach for building with AI — closer to Duolingo than to a code editor.”\n\n  1. At what monthly price would Codepet be too expensive to consider?\n  2. At what price would it be a great deal?\n  3. At what price would it feel too cheap to trust?\n  4. Which feels right: $8 / $12 / $15 / other?\n\nVan Westendorp-style. I’ll turn responses into a recommended price band.',
      },
    ],
  },
  {
    k: 'legal',
    name: 'Legal',
    ab: 'Lg',
    status: 'ready',
    pend: 2,
    need: 'Cover the legal minimum for shipping a macOS app that reads local code.',
    byte: 'I can draft these from templates tuned to your local-first posture; have a lawyer glance before launch.',
    tasks: [
      {
        t: 'Draft a privacy policy',
        d: 'Centered on local-first: code never leaves the device.',
        who: 'does',
        run: 'draft',
        out: 'PRIVACY POLICY — draft (privacy-first)\n\n  • Your code is read on-device. It is never uploaded or sold.\n  • Codepet stores only concept signals (which terms appeared), not your source.\n  • Minimal analytics: app events only, never code contents. Opt-out available.\n  • Export or delete everything from Settings, any time.\n\n[Flagged for legal review: the analytics clause and the retention window.]',
      },
      {
        t: 'Draft terms of service',
        d: 'Standard SaaS terms for a subscription macOS app.',
        who: 'does',
        run: 'draft',
        out: 'TERMS OF SERVICE — draft\n\nAdapted from a vetted SaaS template for a subscription macOS app:\n  • Subscription, billing, and cancellation terms\n  • Acceptable use + license scope\n  • “As-is” / limitation of liability\n  • Governing-law placeholder\n\nReady for a lawyer’s pass before launch.',
      },
    ],
  },
  {
    k: 'design',
    name: 'Design',
    ab: 'De',
    status: 'ready',
    pend: 1,
    need: 'Tighten the first-run so a new user feels value fast.',
    byte: 'I’ll propose the flow as real screens; you make the taste calls.',
    tasks: [
      {
        t: 'Refine onboarding to first value < 2 min',
        d: 'Get a new user to their first Reflection recap quickly — byte mocks the actual screens.',
        who: 'draft',
        screens: [
          {
            name: 'Connect',
            time: '0:15',
            kick: 'Step 1 of 3',
            title: 'Point byte at your project',
            sub: 'byte watches the project you’re working in. Your code stays on your machine.',
            art: 'connect',
            cta: 'Choose a project',
            note: 'No account needed yet',
          },
          {
            name: 'Run a session',
            time: '1:00',
            kick: 'Step 2 of 3',
            title: 'Just code like you always do',
            sub: 'Run your Claude Code session. byte follows along, quietly.',
            art: 'session',
            cta: '',
            note: 'Detecting your session…',
          },
          {
            name: 'First recap',
            time: '0:30',
            kick: 'Step 3 of 3',
            title: 'Here’s what you just built',
            sub: '',
            art: 'recap',
            cta: 'This is what you get every session',
            note: '',
          },
        ],
        out: 'ONBOARDING → FIRST VALUE < 2 MIN\n\nScreen 1 · Connect (15s) — one button, no account wall yet.\nScreen 2 · Run a session (60s) — progress dots fill as byte detects the session.\nScreen 3 · First recap (30s) — plain-language recap + one term to remember.\n\nDrop-off guard: no session in 90s → byte offers a 20-second demo session.',
      },
    ],
  },
  {
    k: 'sales',
    name: 'Sales',
    ab: 'Sa',
    status: 'idle',
    pend: 1,
    need: 'Land your first 20 testers personally — no broadcasting.',
    byte: 'For a 12+ consumer app this is light: warm DMs, not a pipeline.',
    tasks: [
      {
        t: 'Shortlist & draft outreach to 20 waitlisters',
        d: 'Pick the most engaged, draft a personal DM each.',
        who: 'does',
        run: 'draft',
        out: 'FIRST 20 — outreach (personal, no broadcast)\n\nShortlist: the 20 most-engaged waitlisters (replied, shared, or joined early).\n\nDM template:\n“Hey [name] — you signed up for Codepet early. We’re letting the first 100 in this week and I’d love you specifically in it. 2-min setup, and byte recaps your next session. Want a code?”\n\n3 variants by warmth. You send; I’ll track replies and who activates.',
      },
    ],
  },
  {
    k: 'support',
    name: 'Support',
    ab: 'Su',
    status: 'ready',
    pend: 1,
    need: 'Help testers help you — low-friction docs and triage.',
    byte: 'I’ll build a real Help Center you can publish, then keep triage running quietly.',
    tasks: [
      {
        t: 'Build the Help Center page',
        d: 'A real, publishable help page — search, categories, and the top-10 FAQ. byte builds and runs it.',
        who: 'does',
        run: 'route',
        site: SITE_HELP,
        out: 'Codepet Help Center — built, ran in the sandbox, verified in-browser. Top-10 FAQ, getting-started cards, contact. Ready to publish at help.code-pet.com.',
      },
    ],
  },
];

/* ===== tangible outcomes — real artifacts attached to specific tasks (keyed by title) ===== */
export const OUTCOMES: Record<string, any> = {
  'Write the launch announcement post': {
    post: {
      author: 'Codepet',
      handle: '@codepet',
      stats: { likes: 128, reposts: 34, replies: 9 },
      variants: [
        {
          label: 'Original',
          body: `Vibe coding gives you code. Codepet gives you comprehension.\n\nAfter every Claude Code session, byte recaps what you built in plain language, remembers what you're still learning, and grows with you. The macOS beta opens to the first 100 from the waitlist this week.\n\nStop shipping code you can't explain. → code-pet.com`,
        },
        {
          label: 'Hook A',
          body: `Claude writes it. Codepet makes sure you get it.\n\nAfter every Claude Code session, byte recaps what you built and tracks what you're still learning. macOS beta — first 100 off the waitlist this week.\n\n→ code-pet.com`,
        },
        {
          label: 'Hook B',
          body: `The pet that remembers what you're still learning.\n\nbyte recaps every Claude Code session in plain language and grows with you. Stop shipping code you can't explain.\n\nmacOS beta opening now → code-pet.com`,
        },
        {
          label: 'Hook C',
          body: `You shipped it with AI — but do you get it? byte does, and now you will too.\n\nPlain-language recaps after every Claude Code session. macOS beta, first 100 this week.\n\n→ code-pet.com`,
        },
      ],
    },
  },
  'Build the waitlist conversion email': {
    email: {
      from: 'byte at Codepet',
      fromAddr: 'hey@code-pet.com',
      subject: "You're in — run one session today",
      preheader: "Your spot just opened. Here's the 2-minute first run.",
      body: [
        `Your spot's open.`,
        `Run one session today — byte will recap what you built and flag one thing worth understanding. That's it.`,
        `No setup marathon: connect your project, run a Claude Code session, and byte hands you a plain-language recap plus one term worth remembering.`,
      ],
      cta: 'Open Codepet',
      seq: [
        {
          when: 'Now',
          title: "You're in",
          open: 'Run one session today — byte recaps what you built.',
        },
        {
          when: 'Day 3',
          title: 'What byte noticed',
          open: "Here's the term that keeps showing up in your code.",
        },
        {
          when: 'Day 7',
          title: 'A week in',
          open: "Do you read Claude's changes more clearly now?",
        },
      ],
    },
  },
  'Plan a teaching-in-public content calendar': {
    calendar: {
      weeks: [
        {
          label: 'Week 1',
          items: [
            {
              day: 'Mon',
              kind: 'Thread',
              body: 'Term of the week from real code — closures, explained like an envelope',
            },
            {
              day: 'Thu',
              kind: 'Build log',
              body: 'What shipped this week + the one thing byte caught',
            },
          ],
        },
        {
          label: 'Week 2',
          items: [
            {
              day: 'Mon',
              kind: 'Story',
              body: "A tester's before/after: code I couldn't explain → can now",
            },
            {
              day: 'Thu',
              kind: 'Clip',
              body: "byte's post-session recap in action (15s screen capture)",
            },
          ],
        },
      ],
    },
  },
  'Draft a privacy policy': {
    legal: {
      docTitle: 'Privacy Policy',
      updated: 'Draft v1 · for legal review',
      sections: [
        {
          h: '1. Your code stays on your machine',
          p: 'Codepet reads your project on-device to build recaps. Your source code is never uploaded, shared, or sold.',
        },
        {
          h: '2. What we store',
          p: 'Only concept signals — which terms and APIs appeared in a session — never the source itself.',
        },
        {
          h: '3. Analytics',
          p: 'Minimal, app-level events only (never code contents). You can opt out at any time in Settings.',
        },
        { h: '4. Your control', p: 'Export or delete everything from Settings, any time.' },
      ],
      flag: 'Flagged for legal review: the analytics clause and the retention window.',
    },
  },
  'Draft terms of service': {
    legal: {
      docTitle: 'Terms of Service',
      updated: 'Draft v1 · for legal review',
      sections: [
        {
          h: '1. The subscription',
          p: 'Codepet is a subscription macOS app. Billing, renewal, and cancellation follow these terms.',
        },
        {
          h: '2. Acceptable use',
          p: 'Use Codepet for your own projects. No reverse engineering, abuse, or resale of the service.',
        },
        {
          h: '3. License scope',
          p: 'We grant you a personal, non-transferable license for the term of your subscription.',
        },
        {
          h: '4. As-is & liability',
          p: 'Codepet is provided "as is." Liability is limited to the amount paid in the last 12 months.',
        },
        { h: '5. Governing law', p: '[Governing-law placeholder — to be set with counsel.]' },
      ],
      flag: "Ready for a lawyer's pass before launch.",
    },
  },
  'Shortlist & draft outreach to 20 waitlisters': {
    dms: [
      {
        name: 'Alex Rivera',
        note: 'replied twice · shared on X',
        msg: `Hey Alex — you signed up for Codepet early and you've been one of the most engaged. We're letting the first 100 in this week and I'd love you specifically in it. 2-min setup, and byte recaps your next session. Want a code?`,
      },
      {
        name: 'Priya Shah',
        note: 'joined day one',
        msg: `Hi Priya — you were one of the very first on the Codepet waitlist. Opening the beta to the first 100 now. Setup's 2 minutes and byte recaps what you build. Want in?`,
      },
      {
        name: 'Marcus Lee',
        note: 'opened every email',
        msg: `Marcus — you've opened every update we've sent, so you clearly want this. Beta's opening to the first 100 this week. Can I save you a spot?`,
      },
      {
        name: 'Dana Kim',
        note: 'referred a friend',
        msg: `Dana — thanks for referring a friend to Codepet, that meant a lot. We're letting the first 100 in this week and I'd love you in the group. 2-min setup. Want a code?`,
      },
    ],
  },
  'Set up the TestFlight beta': {
    checklist: [
      { t: 'Create the "Codepet Beta" TestFlight group', done: true },
      { t: 'Upload build 1.0 (b12) + export compliance', done: true },
      { t: 'Invite copy — warm, 2 lines, one CTA', done: false },
      { t: 'First-run script: connect → run a session → first recap (≤ 2 min)', done: false },
      { t: 'Seed 10 internal testers before the 100 invites', done: false },
    ],
  },
  'Instrument the dual go/no-go signal': {
    plan: {
      goal: 'Measure whether testers understand their code and feel more capable after a week — the real beta question.',
      steps: [
        'Add four funnel events to the analytics seam (no new SDK).',
        'Fire them at signup, the first recap, a completed review, and the day-7 check.',
        'Assemble a comprehension + capability funnel in the dashboard.',
      ],
      changes: [
        {
          area: 'Analytics layer',
          edit: 'Declare signup_completed, first_reflection_opened, dictionary_review_done, week1_check_shown.',
        },
        { area: 'Onboarding flow', edit: 'Emit signup_completed when the account is created.' },
        { area: 'Recap view', edit: 'Emit first_reflection_opened on the first recap.' },
      ],
      verify: [
        'Confirm signup_completed fires on a real onboarding run.',
        'Add a test asserting each event emits exactly once.',
      ],
      risks: 'The day-7 check needs a survey trigger to exist — build that first if it does not.',
    },
  },
  'Ship the project-aware Dictionary': {
    plan: {
      goal: 'Surface terms from the user’s own code with Encountered → Used → Mastered tracking.',
      steps: [
        'Run an extraction pass over the active project to pull real terms.',
        'Model an evolution state machine: Encountered → Used → Mastered.',
        'Log a rep automatically when a term reappears in the user’s code.',
      ],
      changes: [
        { area: 'Dictionary module', edit: 'Hold the term list and each term’s evolution state.' },
        { area: 'Term store', edit: 'Persist per-term reps and the current state.' },
        { area: 'Session scanner', edit: 'Extract terms from the active project each session.' },
      ],
      verify: [
        'Confirm a handful of terms populate from a real session.',
        'Point it at a second repo to check extraction generalizes.',
      ],
      risks:
        'Extraction quality varies by language — validate on a non-Swift repo before shipping.',
    },
  },
};
DEPTS.forEach((d) =>
  d.tasks.forEach((t) => {
    const o = OUTCOMES[t.t];
    if (o) Object.assign(t, o);
  }),
);

/* ===== roadmap phases ===== */
export const PHASES: Phase[] = [
  {
    name: 'Find',
    stages: [
      {
        n: 1,
        name: 'Validate the idea',
        status: 'done',
        why: 'Prove a real person has this problem before you build a line of code.',
        a: [
          {
            t: 'Name the problem & who has it',
            o: 'A one-sentence problem tied to a specific person, not "everyone".',
          },
          {
            t: 'Interview 5–10 target users',
            o: 'Real quotes confirming the pain is sharp and frequent.',
          },
          {
            t: 'Write the one-line value proposition',
            o: 'A promise you can repeat in every conversation.',
          },
          {
            t: 'Map the competitive landscape',
            o: 'What they use today and why you’re different, not just better.',
          },
          {
            t: 'Name your riskiest assumption',
            o: 'The single belief that, if wrong, kills the idea.',
          },
          { t: 'Set a kill criterion', o: 'A clear signal that tells you to stop or pivot.' },
          { t: 'Size the opportunity', o: 'A rough market big enough to be worth the years.' },
        ],
      },
    ],
  },
  {
    name: 'Build',
    stages: [
      {
        n: 2,
        name: 'Shape the product',
        status: 'done',
        why: 'Define the smallest thing that delivers the core value — and cut the rest.',
        a: [
          { t: 'Define the ONE core job', o: 'The single outcome the product must nail first.' },
          { t: 'Map the happy path end-to-end', o: 'Every screen from entry to the “aha” moment.' },
          { t: 'Cut scope to an MVP', o: 'An explicit list of what you’re NOT building yet.' },
          {
            t: 'Choose the stack & AI tooling',
            o: 'Decisions you won’t have to revisit mid-build.',
          },
          { t: 'Design the core flow', o: 'A clickable prototype you can test on a stranger.' },
          { t: 'Write the data model', o: 'The entities and relationships the app runs on.' },
          { t: 'Spike the riskiest technical bet', o: 'Proof the hard part is actually feasible.' },
        ],
      },
      {
        n: 3,
        name: 'Build the core',
        status: 'done',
        why: 'Build the one feature it lives or dies on — working, end to end.',
        a: [
          { t: 'Build the happy path end-to-end', o: 'A working flow from sign-in to core value.' },
          { t: 'Add accounts & authentication', o: 'Real users can sign up and come back.' },
          { t: 'Wire persistence & sync', o: 'Data survives reloads and devices.' },
          { t: 'Instrument baseline analytics', o: 'You can see what people actually do.' },
          { t: 'Set up CI & a deploy pipeline', o: 'Ship to production in minutes, safely.' },
          { t: 'Dogfood it daily', o: 'You hit the rough edges before testers do.' },
          { t: 'Cut everything non-essential', o: 'A focused build, not a feature swamp.' },
        ],
      },
    ],
  },
  {
    name: 'Ship',
    stages: [
      {
        n: 4,
        name: 'Make it shippable',
        status: 'done',
        why: 'Get it safe, legal, and reliable enough for a stranger to use.',
        a: [
          {
            t: 'Write a privacy policy & terms',
            o: 'Legal cover so a stranger can use it safely.',
          },
          { t: 'Run a security & secrets pass', o: 'No leaked keys, sane auth, least privilege.' },
          { t: 'Handle errors & empty states', o: 'The app degrades gracefully, never blanks.' },
          { t: 'Register the domain', o: 'Your address on the internet, locked in early.' },
          {
            t: 'Set up transactional email & deliverability',
            o: 'Resets and receipts land in the inbox, not spam.',
          },
          { t: 'Add observability & alerts', o: 'You hear about breakage before users tweet it.' },
          { t: 'Build the landing page', o: 'A real page that explains and converts.' },
          {
            t: 'Tune onboarding to first value',
            o: 'New users reach the “aha” in under two minutes.',
          },
        ],
      },
      {
        n: 5,
        name: 'Brand & story',
        status: 'done',
        why: 'Give people a story they can remember and repeat — before the software.',
        a: [
          { t: 'Name, logo & one-liner', o: 'An identity people can remember and repeat.' },
          { t: 'Nail the positioning', o: 'The category you own in the user’s mind.' },
          { t: 'Define voice & messaging pillars', o: 'Consistent tone across every surface.' },
          {
            t: 'Produce screenshots & a demo',
            o: 'Proof-in-pictures for the site, store, and press.',
          },
          { t: 'Write the “why now” narrative', o: 'The story that makes people care today.' },
          { t: 'Claim & set up social profiles', o: 'Consistent handles and a place to be found.' },
        ],
      },
    ],
  },
  {
    name: 'Launch',
    stages: [
      {
        n: 6,
        name: 'Run the closed beta',
        status: 'now',
        why: 'Put it in 50–100 real hands and learn fast — the make-or-break stretch.',
        a: [
          {
            t: 'Recruit a focused tester cohort',
            o: '50–100 from the waitlist, not a public free-for-all.',
          },
          {
            t: 'Stand up TestFlight + tight onboarding',
            o: 'Testers reach first value in one sitting.',
          },
          {
            t: 'Wire the feedback & interview pipeline',
            o: 'Signal flows in and gets scheduled, never lost.',
          },
          {
            t: 'Ship the marketing site & Help Center',
            o: 'A place to land and a place to get unstuck.',
          },
          { t: 'Run weekly tester interviews', o: 'The qualitative “why” behind the metrics.' },
          { t: 'Triage feedback into a build queue', o: 'The top issues become the next sprint.' },
          { t: 'Lock the positioning across surfaces', o: 'One consistent story everywhere.' },
        ],
      },
      {
        n: 7,
        name: 'Measure what matters',
        status: 'next',
        why: 'Make the launch go/no-go a number, not a gut feel.',
        a: [
          {
            t: 'Instrument the dual go/no-go signal',
            o: 'See comprehension AND capability move, weekly.',
          },
          {
            t: 'Define activation & retention events',
            o: 'Signup → activation → week-1 return, all tracked.',
          },
          { t: 'Build the pricing model', o: 'A defensible price band from real inputs.' },
          { t: 'Run a willingness-to-pay survey', o: 'Evidence for the number, not a guess.' },
          { t: 'Stand up a metrics dashboard', o: 'One screen the whole company trusts.' },
          {
            t: 'Set the launch go/no-go bar',
            o: 'The threshold that says “ship it” or “not yet”.',
          },
        ],
      },
    ],
  },
  {
    name: 'Run & grow',
    stages: [
      {
        n: 8,
        name: 'Launch & operations',
        status: 'next',
        why: 'Stand up the company behind the product so you can charge and operate.',
        a: [
          { t: 'Make the go/no-go decision', o: 'A dated, evidence-backed call to launch.' },
          { t: 'Incorporate the company', o: 'A legal entity that can sign, hire, and raise.' },
          { t: 'Open a business bank account', o: 'Company money cleanly separate from personal.' },
          { t: 'Set up billing & subscriptions', o: 'You can charge, refund, and reconcile.' },
          { t: 'Publish to the App Store', o: 'A public, reviewed, installable build.' },
          { t: 'Finalize privacy policy & terms', o: 'Compliant docs, lawyer-reviewed.' },
          { t: 'Set up bookkeeping & tax', o: 'Clean books from day one, not a Q4 scramble.' },
          { t: 'Put real support in place', o: 'A genuine way for users to reach a human.' },
        ],
      },
      {
        n: 9,
        name: 'Build the coach model',
        status: 'next',
        why: 'Build the comprehension layer that compounds — the post-beta moat.',
        a: [
          {
            t: 'Ship local-first session detection',
            o: 'Know a session happened without uploading code.',
          },
          {
            t: 'Build the project-aware Dictionary',
            o: 'Terms from the user’s own code, tracked over time.',
          },
          { t: 'Ship Session Debrief v1', o: 'A plain-language recap after every session.' },
          {
            t: 'Model the two-axis Learner Model',
            o: 'Track comprehension and capability separately.',
          },
          { t: 'Wire spaced-retrieval review', o: 'The right term resurfaces at the right time.' },
          { t: 'Build the first coaching skill', o: 'One end-to-end loop you can generalize.' },
          { t: 'Make it tool-agnostic', o: 'Works beyond Claude Code — not locked in.' },
        ],
      },
      {
        n: 10,
        name: 'Grow & distribute',
        status: 'next',
        why: 'Turn a working product into compounding, repeatable growth.',
        a: [
          { t: 'Run teaching-in-public content', o: 'Two posts a week that compound into reach.' },
          { t: 'Grow social presence', o: 'An audience that hears your launches.' },
          {
            t: 'Build the waitlist → activation flow',
            o: 'New signups become active users on autopilot.',
          },
          { t: 'Gather & qualify prospects', o: 'A list worth working, not a spray.' },
          { t: 'Run cold outreach to your ICP', o: 'Targeted pipeline beyond inbound.' },
          { t: 'Stand up SEO & a content engine', o: 'Compounding organic traffic over months.' },
          {
            t: 'Test a paid acquisition channel',
            o: 'A measurable, repeatable way to buy growth.',
          },
          {
            t: 'Build a referral / invite loop',
            o: 'Users bring users, lowering acquisition cost.',
          },
        ],
      },
    ],
  },
];

/* ===== onboarding constants ===== */
export const OB_ROLES: [string, string][] = [
  ['Founder building a product', 'founder'],
  ['Engineer / developer', 'eng'],
  ['Designer who codes', 'design'],
  ['Product manager', 'product'],
  ['Marketing / growth', 'mkt'],
  ['Operations / business', 'ops'],
  ['Solo / indie hacker', 'solo'],
  ['Something else', 'other'],
];
export const OB_TECH: [string, string][] = [
  ['I write the code myself', 'hands'],
  ['I direct engineers / build with AI', 'direct'],
  ["I'm not on the technical side", 'non'],
];
export const OB_STAGES: string[] = [
  'Just an idea',
  'Prototype',
  'Private beta',
  'Public beta',
  'Launched',
  'Growing',
];
export const OB_NOTES: string[] = [
  "Perfect — I'll focus on shaping the idea and pressure-testing it.",
  "Great — let's turn the prototype into something testable.",
  "I'll help you run a tight private beta and learn fast.",
  "I'll focus on measurement, polish, and getting to launch.",
  "I'll help you grow distribution and tighten the funnel.",
  "I'll focus on scaling what already works.",
];
export const OB_PHASES: string[] = ['About you', 'Your project', 'byte reads it', 'Your company'];
// Quick-select product categories shown as chips on the project step.
export const OB_CATEGORIES: string[] = [
  'Web app',
  'Mobile app',
  'SaaS',
  'Dev tool',
  'AI / ML',
  'Marketplace',
  'Game',
  'Other',
];
export const OB_TOTAL = 8;

/* ===== department colors ===== */
export const DCOL: Record<string, string> = {
  eng: '--blue',
  mkt: '--clay',
  ops: '--teal',
  fin: '--gold',
  legal: '--violet',
  design: '--violet',
  sales: '--accent',
  support: '--rose',
};

/* ===== environment (Claude Code setup) ===== */
export const ENV: Record<string, EnvItem[]> = {
  skills: [
    {
      n: 'Web research',
      ab: 'Wr',
      d: 'byte searches the web and cites sources in its drafts.',
      s: 0,
    },
    {
      n: 'PRD writer',
      ab: 'Pr',
      d: 'Turn a rough idea into a structured product spec.',
      s: 1,
      rec: 1,
      why: 'Turn each beta feature into a clear spec before byte builds it.',
    },
    {
      n: 'Code review',
      ab: 'Cr',
      d: 'Reviews diffs for bugs before anything ships.',
      s: 0,
      rec: 1,
      why: 'Catch bugs before they reach your beta testers.',
    },
    { n: 'Changelog', ab: 'Ch', d: 'Auto-drafts release notes from your commits.', s: 0 },
  ],
  connectors: [
    {
      n: 'GitHub',
      ab: 'Gh',
      d: 'Read repos, open PRs, track issues.',
      s: 1,
      rec: 1,
      why: 'byte reads your repo and opens PRs as it ships beta work.',
    },
    {
      n: 'Notion',
      ab: 'No',
      d: 'Sync briefs, roadmaps, and docs.',
      s: 0,
      rec: 1,
      why: 'You collect beta feedback in Notion — connect it so byte can write there.',
    },
    { n: 'Figma', ab: 'Fi', d: 'Pull designs and components into context.', s: 0 },
    { n: 'Slack', ab: 'Sl', d: 'Post updates and gather feedback.', s: 0 },
    { n: 'Linear', ab: 'Li', d: 'Create and update issues from your tasks.', s: 0 },
  ],
  agents: [
    { n: 'Code Reviewer', ab: 'Cr', d: 'A subagent that audits changes for correctness.', s: 0 },
    { n: 'Explorer', ab: 'Ex', d: 'Searches the codebase to answer questions fast.', s: 1 },
    {
      n: 'Test Writer',
      ab: 'Tw',
      d: 'Generates tests for new code.',
      s: 0,
      rec: 1,
      why: 'Writes tests as byte ships each new beta feature.',
    },
    { n: 'Migrator', ab: 'Mg', d: 'Runs large, repetitive refactors safely.', s: 0 },
  ],
};
// Pristine deep-clone snapshots of the seed catalogs, captured at module load BEFORE
// any runtime mutation. The data-access layer resets the mutable DEPTS/ENV singletons
// to these on every sign-in, so one account's edits can never linger into another
// account's session (per-account isolation for the in-memory layer).
export const DEPTS_SEED: Dept[] = structuredClone(DEPTS);
export const ENV_SEED: Record<string, EnvItem[]> = structuredClone(ENV);
export const ENV_CATS: [string, string, string, string, string][] = [
  ['skills', 'Skills', 'sk', 'Add', 'Active'],
  ['connectors', 'Connectors', 'cn', 'Connect', 'Connected'],
  ['agents', 'Agents', 'ag', 'Enable', 'Enabled'],
];
export const ENV_META: Record<string, { label: string; col: string; add: string; on: string }> = {
  skills: { label: 'Skill', col: '--accent', add: 'Turn on', on: 'byte turned this on' },
  connectors: { label: 'Connector', col: '--blue', add: 'Connect', on: 'Connected' },
  agents: { label: 'Agent', col: '--teal', add: 'Turn on', on: 'byte turned this on' },
};

/* ===== site revision variants + pure revisers ===== */
export const HEROVAR: Record<string, { h1: string; sub: string }> = {
  punch: {
    h1: `Ship code you<br><span class="hl">actually understand.</span>`,
    sub: `byte recaps every Claude Code session in plain language and tracks what you’re still learning — so you’re never flying blind.`,
  },
  warm: {
    h1: `Your code, finally<br><span class="hl">making sense.</span>`,
    sub: `After each session, byte takes a minute with you: here’s what you built, and the one idea worth keeping.`,
  },
  tech: {
    h1: `A comprehension layer for<br><span class="hl">agentic coding.</span>`,
    sub: `byte parses each Claude Code session locally, extracts the concepts you touched, and tracks them Encountered → Used → Mastered.`,
  },
  privacy: {
    h1: `Your code never<br><span class="hl">leaves your machine.</span>`,
    sub: `byte reads your project on-device, recaps what you built, and remembers what you’re learning — without uploading a single line.`,
  },
};
export function reviseSite(site: string, note: string): string {
  const n = note.toLowerCase();
  let v;
  if (/privacy|local|device/.test(n)) v = HEROVAR.privacy;
  else if (/tech/.test(n)) v = HEROVAR.tech;
  else if (/warm|friendl|soft/.test(n)) v = HEROVAR.warm;
  else v = HEROVAR.punch;
  return site
    .replace(/<h1>[\s\S]*?<\/h1>/, `<h1>${v.h1}</h1>`)
    .replace(/<p class="sub">[\s\S]*?<\/p>/, `<p class="sub">${v.sub}</p>`);
}
export function reviseText(out: string, note: string): string {
  const n = note.toLowerCase(),
    lines = out.split('\n');
  if (/short|tight|trim|cut/.test(n)) {
    const kept = lines.filter((l, k) => k < 2 || /^\s*[•☐\d]/.test(l)).slice(0, 9);
    return kept.join('\n') + '\n\n(trimmed to the essentials — ' + note + ')';
  }
  let lead;
  if (/warm|friendl/.test(n)) lead = 'Warmer pass:\n\n';
  else if (/specific|detail|concrete/.test(n)) lead = 'With sharper specifics:\n\n';
  else if (/punch|bold|hook/.test(n)) lead = 'Punchier — leading with the hook:\n\n';
  else lead = 'Revised — ' + note + ':\n\n';
  return lead + out;
}

/* ===== library taxonomy ===== */
export const LIB_TAG: Record<string, string> = {
  site: 'live site',
  screens: 'prototype',
  sheet: 'live model',
  build: 'shipped & verified',
  doc: 'draft',
  prep: 'checklist for you',
  post: 'social post',
  email: 'email',
  calendar: 'content plan',
  legal: 'legal draft',
  dms: 'outreach DMs',
  checklist: 'checklist',
  plan: 'code-change plan',
};
export const LIB_BUCKET: Record<string, string> = {
  site: 'Sites',
  screens: 'Prototypes',
  sheet: 'Models',
  plan: 'Plans',
  build: 'Builds',
  post: 'Posts',
  email: 'Emails',
  calendar: 'Plans',
  dms: 'Outreach',
  legal: 'Docs',
  doc: 'Docs',
  checklist: 'Checklists',
  prep: 'Checklists',
};
export const LIB_BORDER: string[] = [
  'Sites',
  'Prototypes',
  'Models',
  'Builds',
  'Posts',
  'Emails',
  'Plans',
  'Outreach',
  'Docs',
  'Checklists',
];
export const LIB_TC: Record<string, string> = {
  site: 'var(--accent)',
  screens: 'var(--violet)',
  sheet: 'var(--accent)',
  plan: 'var(--blue)',
  build: 'var(--accent)',
  post: 'var(--clay)',
  email: 'var(--clay)',
  calendar: 'var(--clay)',
  dms: 'var(--accent)',
  legal: 'var(--violet)',
  doc: '#B7AE9E',
  checklist: 'var(--gold-deep)',
  prep: 'var(--gold-deep)',
};
/* per-type preview skin — light hue tint + same-hue border + readable label ink */
export const LIB_SKIN: Record<string, { tint: string; line: string; ink: string }> = {
  site: { tint: '#fff', line: 'var(--hairline)', ink: 'var(--accent-deep)' },
  screens: { tint: 'var(--violet-tint)', line: 'var(--violet-line)', ink: '#7A23C0' },
  sheet: { tint: 'var(--accent-tint)', line: 'var(--accent-line)', ink: 'var(--accent-deep)' },
  plan: { tint: 'var(--blue-tint)', line: 'var(--blue-line)', ink: '#1D4ED8' },
  build: { tint: 'var(--blue-tint)', line: 'var(--blue-line)', ink: '#1D4ED8' },
  post: { tint: 'var(--clay-tint)', line: 'var(--clay-line)', ink: '#C2410C' },
  email: { tint: 'var(--clay-tint)', line: 'var(--clay-line)', ink: '#C2410C' },
  calendar: { tint: 'var(--clay-tint)', line: 'var(--clay-line)', ink: '#C2410C' },
  dms: { tint: 'var(--accent-tint)', line: 'var(--accent-line)', ink: 'var(--accent-deep)' },
  legal: { tint: 'var(--violet-tint)', line: 'var(--violet-line)', ink: '#7A23C0' },
  doc: { tint: 'var(--well)', line: 'var(--hairline)', ink: 'var(--t-3)' },
  checklist: { tint: 'var(--gold-tint)', line: 'var(--gold-line)', ink: 'var(--gold-deep)' },
  prep: { tint: 'var(--gold-tint)', line: 'var(--gold-line)', ink: 'var(--gold-deep)' },
};

/* ===== roadmap graph ===== */
export const GRAPH: Record<number, { x: number; y: number; deps: number[] }> = {
  1: { x: 72, y: 212, deps: [] },
  2: { x: 240, y: 212, deps: [1] },
  3: { x: 408, y: 212, deps: [2] },
  4: { x: 582, y: 116, deps: [3] },
  5: { x: 582, y: 308, deps: [3] },
  6: { x: 762, y: 212, deps: [4, 5] },
  7: { x: 938, y: 212, deps: [6] },
  8: { x: 1122, y: 116, deps: [7] },
  9: { x: 1122, y: 308, deps: [7] },
  10: { x: 1122, y: 430, deps: [7] },
};
export const NODES: any[] = [];
PHASES.forEach((p) =>
  p.stages.forEach((s) => NODES.push(Object.assign({ ph: p.name }, s, GRAPH[s.n]))),
);
export const STAGE_TASKS: Record<number, [string, string][]> = {
  6: [
    ['ops', 'Set up the TestFlight beta'],
    ['ops', 'Wire the feedback + interview pipeline'],
    ['mkt', 'Build the Codepet landing page'],
    ['mkt', 'Write the launch announcement post'],
    ['mkt', 'Build the waitlist conversion email'],
    ['sales', 'Shortlist & draft outreach to 20 waitlisters'],
    ['support', 'Build the Help Center page'],
    ['design', 'Refine onboarding to first value < 2 min'],
  ],
  7: [
    ['eng', 'Instrument the dual go/no-go signal'],
    ['fin', 'Build the pricing model'],
    ['fin', 'Run a willingness-to-pay survey'],
  ],
  8: [
    ['legal', 'Draft a privacy policy'],
    ['legal', 'Draft terms of service'],
  ],
  9: [
    ['eng', 'Ship the project-aware Dictionary'],
    ['eng', 'Spec the session-detection layer'],
    ['mkt', 'Plan a teaching-in-public content calendar'],
  ],
};
export const byN = (n: number): any => NODES.find((x: any) => x.n === n);
