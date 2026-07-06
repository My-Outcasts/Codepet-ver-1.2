// Deterministic radial layout for the Overview map. Departments sit on an even
// ring in the x-y plane; tasks sit on a small ring around their department. A
// little depth (DEPTH of the radius) is kept so the pinned disc parallaxes
// gently as the camera auto-rotates — it is NOT a full sphere. Positions are
// pinned (fx/fy/fz) so the force sim can't re-scatter them. Pure + unit-tested;
// OverviewView is a thin consumer.

export const DEPT_R = 140; // department ring radius
export const TASK_R = 46; // task ring radius around a department
export const DEPTH = 0.25; // fraction of the radius kept as z-depth (parallax)
export const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export interface Pos {
  x: number;
  y: number;
  z: number;
  fx: number;
  fy: number;
  fz: number;
}

const pin = (x: number, y: number, z: number): Pos => ({ x, y, z, fx: x, fy: y, fz: z });

// Department `index` of `count`, evenly spaced starting at the top, clockwise.
// count >= 1 (there is always at least the calling department), so no div-by-zero.
export function deptRingPosition(index: number, count: number): Pos {
  const a = -Math.PI / 2 + (index / count) * Math.PI * 2;
  return pin(
    Math.cos(a) * DEPT_R,
    Math.sin(a) * DEPT_R,
    Math.sin(GOLDEN * index) * DEPT_R * DEPTH,
  );
}

// Task `index` of `total` in a small ring around its department. total >= 1.
export function taskRingPosition(
  dept: { x: number; y: number; z: number },
  index: number,
  total: number,
): Pos {
  const a = (index / total) * Math.PI * 2;
  return pin(
    dept.x + Math.cos(a) * TASK_R,
    dept.y + Math.sin(a) * TASK_R,
    dept.z + Math.sin(GOLDEN * (index + 1)) * TASK_R * DEPTH,
  );
}
