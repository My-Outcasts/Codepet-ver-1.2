'use client';
import type { LiveRun } from '@/lib/ai/liveRun';

// What each deliverable type is actually made of. These are the sections the schema in
// lib/ai/deliverableSchemas.ts produces — the outline is a true statement about the
// shape of the result, shown before the content exists.
const OUTLINE: Record<string, string[]> = {
  doc: ['Summary', 'Sections', 'Next steps'],
  site: ['Hero', 'How it works', 'Features', 'Call to action'],
  post: ['Hook', 'Body', 'Call to action'],
  email: ['Subject', 'Body', 'Sign-off'],
  checklist: ['Steps'],
  plan: ['Phases', 'Milestones'],
  sheet: ['Inputs', 'Projection'],
  screens: ['Screens', 'Flow'],
  legal: ['Clauses'],
  dms: ['Messages'],
  calendar: ['Schedule'],
  prep: ['Steps'],
};

export function RunCanvas({ run }: { run: LiveRun }) {
  const sections = OUTLINE[run.type] ?? ['Deliverable'];
  const text = run.result?.text?.trim();

  if (run.status === 'done') {
    return (
      <section className="rt-canvas" aria-label="Deliverable">
        {text ? (
          <div className="rt-out">{text}</div>
        ) : (
          <div className="rt-out rt-muted">Ready — open it to read the full deliverable.</div>
        )}
      </section>
    );
  }

  return (
    <section className="rt-canvas" aria-label="Deliverable preview">
      {sections.map((s, i) => (
        <div
          className="rt-sec"
          key={s}
          data-s={run.activePhase === 'generate' && i === 0 ? 'active' : 'pending'}
        >
          <div className="rt-sec-h">{s}</div>
          {run.activePhase === 'generate' && i === 0 ? (
            <div className="rt-skel" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          ) : null}
        </div>
      ))}
      {run.status === 'failed' || run.status === 'limited' ? (
        <div className="rt-sec-note">
          {run.status === 'limited'
            ? 'Held before writing — nothing was charged for the part that did not run.'
            : 'Not written — the run stopped before this point.'}
        </div>
      ) : null}
    </section>
  );
}
