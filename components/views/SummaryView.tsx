'use client';
// Summary — a value-first recap of what Codepet is doing FOR the user. Every block
// answers "what did Byte do for me, and what's the next win?" and is derived from
// the real company state (DEPTS / library / roadmap) — only the greeting line,
// achievements, and level are still playful static copy. Light theme tokens; see
// the .sum-* rules in globals.css.
import { useApp } from '@/lib/store';
import { DEPTS, NODES } from '@/lib/data';
import { eff, stageTasks, stageProgress } from '@/lib/roadmap';
import type { Dept, Task } from '@/lib/data';
import { Byte } from '../Byte';

const LEVEL = 4;

// "Momentum" badges — static for now (habits Codepet nudges the user toward).
const ACHIEVEMENTS: Array<{ text: string; done: boolean }> = [
  { text: 'think like an owner', done: true },
  { text: 'spend coins wisely', done: true },
  { text: 'double-check before done', done: false },
  { text: 'help Byte remember', done: false },
];

interface Here {
  stageN: number;
  stageName: string;
  phase: string;
  prog: { done: number; total: number };
  dept: Dept;
  task: Task;
}

// The live "you are here" stage + the single next action that owns it — mirrors
// the Overview map's HereCard so the two views agree on what's next.
function currentHere(): Here | null {
  const now = NODES.find((n) => eff(n) === 'now');
  if (!now) return null;
  const refs = stageTasks(now.n);
  const open = refs.filter((r) => !r.task.done);
  const pick =
    open.find((r) => r.task.who === 'you') ||
    open.find((r) => r.task.who === 'draft') ||
    open[0] ||
    refs[refs.length - 1];
  if (!pick) return null;
  return {
    stageN: now.n as number,
    stageName: now.name as string,
    phase: now.ph as string,
    prog: stageProgress(now.n),
    dept: pick.dept,
    task: pick.task,
  };
}

export function SummaryView() {
  const { show, openDept, runTask, library, tracking, tick } = useApp();
  void tick; // re-read the mutable DEPTS singleton whenever the store changes

  // ---- live metrics from the real company state (no mock numbers) ----
  const tasks = DEPTS.flatMap((d) => d.tasks);
  const done = tasks.filter((t) => t.done).length;
  const total = tasks.length;
  const autopilot = tasks.filter((t) => !t.done && t.who === 'does').length;
  const needsYou = tasks.filter((t) => !t.done && (t.who === 'you' || t.who === 'draft')).length;
  const active = autopilot + needsYou;
  const autopilotPct = active ? Math.round((autopilot / active) * 100) : 100;

  const here = currentHere();
  const stagePct =
    here && here.prog.total ? Math.round((here.prog.done / here.prog.total) * 100) : 0;

  // Real Claude Code activity, when the tracking hook has reported any. Until then
  // every tracked block falls back to a sensible DEPTS/library-derived view.
  const hasTracking = tracking.sessions > 0;
  const chips = hasTracking
    ? [
        { value: String(tracking.sessions), label: 'sessions' },
        { value: String(tracking.commits), label: 'commits' },
        { value: String(tracking.prs), label: 'PRs' },
      ]
    : [
        { value: String(DEPTS.length), label: 'departments' },
        { value: String(done), em: `/${total}`, label: 'tasks done' },
        { value: String(library.length), label: 'shipped & saved' },
      ];
  const wins = hasTracking
    ? tracking.recentWins.map((w, i) => ({
        key: `w${i}`,
        title: w.title,
        meta: w.repo ?? 'Claude Code',
      }))
    : library
        .slice(0, 3)
        .map((it) => ({ key: `${it.k}-${it.title}`, title: it.title, meta: it.dept }));
  const winsCount = hasTracking ? tracking.commits : library.length;

  const openNext = () => {
    if (!here) return show('tasks');
    if (here.task.who === 'you' || here.task.who === 'draft')
      runTask(here.task, here.dept, here.task.who === 'you');
    else openDept(here.dept.k);
  };

  return (
    <section className="view on" id="v-summary">
      <div className="vhead">
        <h1>Summary</h1>
        <div className="sub">What Byte got done for you</div>
      </div>

      <div className="sum-body">
        {/* Value hero */}
        <div className="sum-hero">
          <Byte size="s28" className="sum-hero-byte" />
          <div className="sum-hero-text">
            <div className="sum-hero-title">
              {autopilot > 0
                ? `Byte's on a roll — running ${autopilot} ${autopilot === 1 ? 'task' : 'tasks'} for you 🙌`
                : 'All clear — Byte has nothing on its plate right now ✨'}
            </div>
            <div className="sum-hero-sub">
              {hasTracking
                ? `${tracking.sessions} sessions · ${tracking.commits} commits · ~${tracking.hoursSaved}h saved`
                : `${done}/${total} tasks moved · ${DEPTS.length} departments`}
            </div>
          </div>
          <span className="sum-lvl">Lv {LEVEL}</span>
        </div>

        {/* Autopilot — the "it works for me, I just approve" payload */}
        <div className="sum-auto">
          <div className="sum-auto-top">
            <div>
              <div className="sum-auto-pct">{autopilotPct}%</div>
              <div className="sum-auto-cap">on autopilot</div>
            </div>
            <div className="sum-auto-legend">
              <span>
                <i className="dot teal" /> Byte handles {autopilot}
              </span>
              <span>
                <i className="dot gold" /> you weigh in on {needsYou}
              </span>
            </div>
          </div>
          <div className="sum-auto-bar">
            <div className="seg teal" style={{ flex: autopilot || (active ? 0 : 1) }} />
            <div className="seg gold" style={{ flex: needsYou }} />
          </div>
        </div>

        {/* Secondary stat chips — real Claude Code activity when available */}
        <div className="sum-chips">
          {chips.map((c) => (
            <div className="sum-chip" key={c.label}>
              <b>
                {c.value}
                {c.em && <em>{c.em}</em>}
              </b>
              <span>{c.label}</span>
            </div>
          ))}
        </div>

        {/* You are here — momentum toward launch */}
        <div className="sum-here" onClick={() => show('roadmap')} role="button" tabIndex={0}>
          <div className="sum-here-label">You are here →</div>
          {here ? (
            <>
              <div className="sum-here-stage">
                Stage {here.stageN}/{NODES.length} · {here.stageName}
              </div>
              <div className="sum-here-phase">{here.phase}</div>
              <div className="sum-here-track">
                <div className="sum-here-fill" style={{ width: `${stagePct}%` }} />
              </div>
              <div className="sum-here-meta">
                {here.prog.done}/{here.prog.total} done this stage
              </div>
            </>
          ) : (
            <div className="sum-here-stage">Every stage complete 🎉</div>
          )}
        </div>

        {/* Recent wins — real commits (from Claude Code) or approved Library items */}
        <div className="sum-builds">
          <div className="sum-builds-head">
            Recent wins {winsCount > 0 && <span className="sum-builds-ct">{winsCount}</span>}
          </div>
          {wins.length > 0 ? (
            wins.map((w) => (
              <div className="sum-build" key={w.key}>
                <span className="sum-build-ic">✓</span>
                <span className="sum-build-title">{w.title}</span>
                <span className="sum-build-meta">{w.meta}</span>
              </div>
            ))
          ) : (
            <div className="sum-empty" onClick={() => show('tasks')} role="button" tabIndex={0}>
              Nothing shipped yet — approve a draft or run Claude Code and your wins land here. →
            </div>
          )}
        </div>

        {/* Achievements — momentum badges */}
        <div className="sum-ach">
          <div className="sum-ach-label">You&apos;ve nailed these! ⭐</div>
          <div className="sum-ach-pills">
            {ACHIEVEMENTS.map((a) => (
              <span className={`sum-pill${a.done ? ' done' : ''}`} key={a.text}>
                {a.done ? '✓' : '⏳'} {a.text}
              </span>
            ))}
          </div>
        </div>

        {/* Next best action — the one real win, one tap away */}
        {here ? (
          <div className="sum-next">
            <div className="sum-next-text">
              <div className="sum-next-label">Next best action</div>
              <div className="sum-next-task">{here.task.t}</div>
              <div className="sum-next-dept">{here.dept.name}</div>
            </div>
            <button className="sum-cta" onClick={openNext}>
              Do this with Byte →
            </button>
          </div>
        ) : (
          <button className="sum-cta" onClick={() => show('tasks')}>
            Let&apos;s build something with Byte! →
          </button>
        )}
      </div>
    </section>
  );
}
