// Pure derivation for the Overview's stage ribbon: the 5 PHASES as segments,
// each read as done / current / future purely by position vs the stage
// watermark (same source the retired Roadmap used, so they can't disagree).
// Exactly one segment is ever `current` — the phase holding the watermark.
import { PHASES } from '../data';
import { eff } from '../roadmap';

export type PhaseState = 'done' | 'current' | 'future';

export interface RibbonSegment {
  /** Phase name (e.g. "Build"). */
  name: string;
  /** Position of this phase relative to where the founder is now. */
  state: PhaseState;
  /** Stage number to open when the segment is clicked: the phase's "now"
   *  stage if it's current, otherwise the phase's first stage. */
  stageN: number;
}

export function ribbonSegments(): RibbonSegment[] {
  return PHASES.map((p) => {
    // eff() only reads `.n`; a phase's stage carries it, so pass it directly.
    const states = p.stages.map((s) => eff(s));
    const state: PhaseState = states.includes('now')
      ? 'current'
      : states.every((x) => x === 'done')
        ? 'done'
        : 'future';
    const nowStage = p.stages.find((s) => eff(s) === 'now');
    const stageN = state === 'current' && nowStage ? nowStage.n : p.stages[0].n;
    return { name: p.name, state, stageN };
  });
}
