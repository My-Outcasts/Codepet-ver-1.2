'use client';
// The stage detail drawer — lifted out of the retired RoadmapView so the
// Overview can open it when a ribbon phase is clicked. Behavior unchanged:
// the stage's why, its authored checklist, and byte's next move / advance-stage.
import { useApp } from '@/lib/store';
import { byN, DEPTS } from '@/lib/data';
import { companionById } from '@/lib/companions';
import { eff } from '@/lib/roadmap';
import { resolveBeaconTask } from '@/lib/overview/beaconTarget';
import { stageComplete, nextStageOf } from '@/lib/stages';

export const Lock = () => (
  <svg className="lockic" viewBox="0 0 16 16" fill="none">
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
    <path d="M5.5 7V5.2a2.5 2.5 0 015 0V7" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

export function StageDrawer() {
  const {
    selStage,
    drawerOpen,
    closeStage,
    nextStep,
    portalToTask,
    advanceStage,
    brief,
    companionId,
  } = useApp();
  const companionName = companionById(companionId).name;
  const n = byN(selStage);
  if (!n) return null;
  const e = eff(n);
  const readyToAdvance = e === 'now' && stageComplete();
  const nextStage = nextStageOf(brief.stage);

  const here = (() => {
    const hit = resolveBeaconTask(nextStep, DEPTS);
    if (!hit) return null;
    const d = DEPTS.find((x) => x.k === hit.deptK);
    const t = d?.tasks[hit.index];
    return d && t ? { d, t } : null;
  })();
  const sLbl =
    e === 'done' ? 'Complete' : e === 'now' ? 'In progress' : e === 'next' ? 'Up next' : 'Locked';
  const sCls =
    e === 'done' ? 'st-done' : e === 'now' ? 'st-draft' : e === 'next' ? 'st-you' : 'st-locked';
  const CHK = (
    <svg viewBox="0 0 16 16" width="10" height="10" fill="none">
      <path
        d="M3 8l3.5 3.5L13 4"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  const Checklist = () => (
    <div className="jd-acts">
      {n.a.map((it: any, i: number) => {
        const t = typeof it === 'string' ? it : it.t;
        const o = typeof it === 'object' ? it.o : '';
        return (
          <div className={`jd-a ${e === 'done' ? 'done' : ''}`} key={i}>
            <span className="b">{e === 'done' ? CHK : ''}</span>
            <div className="jd-a-tx">
              <div className="jd-a-t">{t}</div>
              {o && <div className="jd-a-o">{o}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );

  const cta: React.ReactNode =
    e === 'next' ? (
      <span className="lock">
        <Lock /> Up next — you&apos;ll get here as you progress. Start one early from its department
        any time.
      </span>
    ) : null;

  const nextMove =
    readyToAdvance && nextStage ? (
      <div className="jd-next">
        <div className="jd-next-lbl">Stage complete</div>
        <div className="jd-next-t">You&apos;ve finished this stage&apos;s work.</div>
        <div className="jd-next-s">Ready to move to {nextStage}?</div>
        <button className="jd-next-go" onClick={advanceStage}>
          Advance to {nextStage}
        </button>
      </div>
    ) : e === 'now' && here ? (
      <div className="jd-next">
        <div className="jd-next-lbl">{companionName}&apos;s next move</div>
        <div className="jd-next-t">{here.t.t}</div>
        <div className="jd-next-s">{here.d.name}</div>
        <button className="jd-next-go" onClick={() => portalToTask(here.d.k, here.t.t)}>
          Start
        </button>
      </div>
    ) : null;

  const body = (
    <>
      {nextMove}
      <div className="jdr-lbl">Checklist</div>
      <Checklist />
    </>
  );

  return (
    <aside className={`jdrawer${drawerOpen ? ' open' : ''}`}>
      <div className="jdr-head">
        <span className="jd-ph">{n.ph}</span>
        <span className={`tstate ${sCls}`}>
          <i />
          {sLbl}
        </span>
        <button className="jdr-x" onClick={closeStage}>
          ✕
        </button>
      </div>
      <div className="jdr-title">{n.name}</div>
      <div className="jd-why">{n.why}</div>
      {body}
      {cta && <div className="jd-cta">{cta}</div>}
    </aside>
  );
}
