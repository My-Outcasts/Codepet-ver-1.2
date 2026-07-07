// First-run "spotlight handoff" logic for the Overview, kept pure so it is
// unit-testable under the node-env Vitest (the stack has no React Testing
// Library). The React components — OverviewView / OverviewIntro / ByteGuide —
// are thin consumers of these functions.

// The cyan guide-star color the beacon node is painted with on the map, and the
// one contextual color the spotlight teaches. Mirrors BEACON_HEX in OverviewView.
export const GUIDE_HEX = '#7DE3FF';

export type IntroPhase = 'intro' | 'spotlight' | 'done';

// Where a fresh mount starts: show the intro only if the user hasn't seen it.
export function introInitialPhase(seen: boolean): IntroPhase {
  return seen ? 'done' : 'intro';
}

// CTA pressed in the intro → frame the next move.
export function onReveal(): IntroPhase {
  return 'spotlight';
}

// Spotlight acknowledged (Start, timeout) → settle back to the plain map.
export function onSettle(): IntroPhase {
  return 'done';
}

// "? how to read this map" pressed → reopen the explainer.
export function onReopen(): IntroPhase {
  return 'intro';
}

export interface HereLike {
  dept: unknown;
  task: unknown;
}

// What the CTA can actually do: fly to the beacon if there's a live next move,
// otherwise just recenter the whole map (an honest fallback, never a dead fly).
export function revealAction(here: HereLike | null): 'fly' | 'recenter' {
  return here ? 'fly' : 'recenter';
}
