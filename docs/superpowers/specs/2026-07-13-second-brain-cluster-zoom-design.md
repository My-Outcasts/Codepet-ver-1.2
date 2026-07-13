# Second Brain — Phase B: cinematic zoom into a cluster (2-level focus)

**Date:** 2026-07-13
**Scope:** `SECOND_BRAIN_V2` galaxy only, in `components/views/OverviewView.tsx`. Adds a
2-level "enter a feature-area cluster" focus mode on top of Phase A's clustered galaxy.
No new data, no backend, no schema change. Non-v2 Overview unchanged.

## Goal

Clicking a feature-area cluster flies the camera in and enters an **immersive focus**:
the chosen cluster's nodes stay fully lit with their labels shown, every other node and
link fades out, and the founder can read just that area. Three ways back out to the whole
"universe": a breadcrumb button, the ESC key, and clicking empty space. Two levels only
(universe ↔ inside-a-cluster); deeper nesting and opening a star to full content are later
phases (C).

## Current state (grounded in code)

- Phase A clusters the galaxy: cluster **hubs** are `kind: 'dept'` GNodes with `id: 'cluster:N'`;
  knowledge nodes carry their cluster id on `deptK` (in the KG) but the **GNode does NOT yet
  carry the cluster id** — the v2 `useMemo` mapping copies `id/name/kind/sbLabel/refType/refId/
  color/val/deptColor` only.
- Focus/dim already exists: `inFocus(id)` (`:551`) lights a node if it's the hovered node or a
  neighbor; `nodeColor` (`:1380`) returns `inFocus(n.id) ? n.color : DIM_NODE`; `linkColor`
  (`:1398`) dims non-hovered links; `DIM_NODE`/`DIM_LINK` are defined at `:66-67`.
- `flyTo(nodeId, ms=900)` glides the camera to a node; `fitView()` frames the whole galaxy.
- Auto-rotate is controlled in an effect (`:879`: `c.autoRotate = !here`).
- Labels are hover-only (in-scene `SpriteText` was removed; names show via the built-in tooltip).
- `onNodeClick` (`:1444`) already, in v2, flies to a cluster hub (`if (n.kind === 'dept') return flyTo(n.id);`).

## Target design

### State
Add to the component: `const [focusCluster, setFocusCluster] = useState<string | null>(null);`
`null` = universe view; otherwise the entered cluster's id (`cluster:N`).

### GNode carries its cluster id
- Add `clusterId?: string` to the `GNode` interface.
- In the v2 `useMemo` node mapping, set it: a hub's cluster id is its own id; a knowledge node's
  is its `deptK` (the cluster id). i.e. `clusterId: n.kind === 'department' ? n.id : n.deptK`.
- Return a `nodeCluster: Map<string, string>` (node id → cluster id) from the `useMemo` alongside
  `data`/`adj`, so `linkColor` can test a link's endpoints without re-deriving.

### Enter a cluster
In `onNodeClick`'s v2 branch, replace the current cluster-hub line:
```ts
if (n.kind === 'dept') { setFocusCluster(n.id); flyTo(n.id, 900); return; }
```
(Keep the knowledge-node routing above it — clicking a library-backed node still opens the
deliverable.) Camera flies close to the cluster hub. Clicking a knowledge node's behavior is
unchanged (full content view is Phase C).

### Focus dimming (compose with existing hover focus)
- `nodeColor` (`:1380`): before the hover logic, add — when focused, dim everything outside the
  cluster:
  ```ts
  if (focusCluster && n.clusterId !== focusCluster) return DIM_NODE;
  ```
  In-cluster nodes then still honor the existing `inFocus`/`tourDim` logic. (Result: out-of-cluster
  nodes go dim; the focused cluster stays lit.)
- `nodeVal`/size: unchanged.
- `linkColor` (`:1398`): when focused, dim any link that isn't fully inside the focused cluster —
  add near the top of the callback:
  ```ts
  if (focusCluster) {
    const sc = nodeCluster.get(linkId(l.source));
    const tc = nodeCluster.get(linkId(l.target));
    if (sc !== focusCluster || tc !== focusCluster) return DIM_LINK;
  }
  ```
  (Place before the existing hover/path logic so focus wins.)

### Labels for the focused cluster
When focused, the cluster's member nodes show a `SpriteText` label (as the pre-trim galaxy did),
so the founder can read the area's items; in universe view, no in-scene labels (unchanged).
- `nodeThreeObject` becomes focus-aware: for a v2 node, if `focusCluster && n.clusterId === focusCluster`
  and the node is not the company root, add a small `SpriteText` label (reuse the pre-existing label
  styling — white text, subtle scrim, lifted above the glow). Hubs always show their label when focused.
- Because `react-force-graph` caches node objects, force a rebuild when focus changes: in an effect
  keyed on `focusCluster`, call `fgRef.current?.refresh()` (positions are preserved; only the node
  objects re-render). If `nodeThreeObject` is a `useCallback`, add `focusCluster` to its deps so the
  accessor identity changes too.

### Exit (all three)
A single `exitCluster()` = `setFocusCluster(null); fitView();`. Wired to:
1. **Breadcrumb button** — rendered only when `focusCluster != null`, top-left (near the title),
   showing `← All areas` plus the current cluster's name (resolve via
   `data.nodes.find((n) => n.id === focusCluster)?.name`). `onClick={exitCluster}`. `pointerEvents:auto`.
2. **ESC key** — an effect adding a `keydown` listener: on `Escape`, if `focusCluster` is set, call
   `exitCluster()` and `preventDefault()`. Cleaned up on unmount / dep change.
3. **Background click** — add `onBackgroundClick={() => { if (focusCluster) exitCluster(); }}` to
   `<ForceGraph3D>`.

### Auto-rotate
While focused, hold the map still: change the auto-rotate effect (`:879`) to
`c.autoRotate = !here && !focusCluster;` and ensure exiting re-enables it. Add `focusCluster` to that
effect's deps.

## Data flow
No new data. `focusCluster` is transient UI state. `clusterId` and `nodeCluster` are derived in the
existing `useMemo` from the Phase A cluster assignment already on the KG nodes.

## Out of scope (later)
- Deeper nesting (cluster → sub-cluster).
- Opening a star to its full content / how-it-works / ask panel (Phase C).
- Re-laying-out the cluster's items into a fresh centered constellation (we keep their existing
  positions and just fly in + dim the rest — the approved option (a)).

## Success criteria
- With `NEXT_PUBLIC_SECOND_BRAIN_V2=1` and clustered events: clicking a cluster flies the camera in,
  dims every other node/link, shows the focused cluster's item labels, and pauses auto-rotate.
- ESC, the `← All areas` breadcrumb, and a background click each return to the full galaxy (`fitView`,
  auto-rotate resumes, labels hide).
- No console errors; deterministic; `npm run typecheck` + `npm run lint` (no new errors) + `npm run build`
  pass; full test suite still green (no logic tests change).
- Non-v2 Overview unchanged.
