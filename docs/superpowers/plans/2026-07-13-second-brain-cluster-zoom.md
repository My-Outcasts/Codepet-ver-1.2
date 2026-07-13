# Second Brain Phase B — Cinematic Zoom Into a Cluster (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a feature-area cluster flies the camera in and enters an immersive focus (that cluster lit + labeled, everything else dimmed); ESC / a breadcrumb / a background click return to the whole galaxy.

**Architecture:** Pure front-end state + render changes in `components/views/OverviewView.tsx` only. A `focusCluster` id drives camera (`flyTo`/`fitView`), dimming (existing `DIM_NODE`/`DIM_LINK` + focus callbacks), labels (focus-aware `nodeThreeObject` + a `refresh()`), and auto-rotate pause. No data/schema/backend change. v2-only; classic Overview untouched.

**Tech Stack:** Next.js/React, react-force-graph-3d, three.js, inline styles. No unit tests for this view — verified by typecheck + lint + build + a visual run.

## Global Constraints

- Change **only** `SECOND_BRAIN_V2 === true` behavior. Non-v2 Overview renders exactly as before.
- 2 levels only (universe ↔ inside-a-cluster). No deeper nesting; no opening a star to full content (Phase C).
- The approved interaction is option (a): keep item positions, **fly in + dim the rest** — do NOT re-lay-out the cluster.
- Cluster hubs are `kind: 'dept'` GNodes with `id === 'cluster:N'`; a knowledge node's cluster id is its `deptK`.
- Keep the build clean: `npm run typecheck` clean, `npm run lint` introduces no new errors (the file has ~20 pre-existing `no-explicit-any`), `npm run build` succeeds, and `npm test` stays green (no logic tests change).
- Follow the existing inline-style idiom; reuse `flyTo`, `fitView`, `DIM_NODE`, `DIM_LINK`, `linkId`.

## File Structure

- **Modify** `components/views/OverviewView.tsx` — the only file. Task 1 adds state + cluster id on nodes + enter/exit navigation + auto-rotate pause; Task 2 layers the focus visuals (dim + labels).

---

### Task 1: Enter/exit navigation, state, and cluster ids

**Files:**

- Modify: `components/views/OverviewView.tsx`

**Interfaces:**

- Consumes existing: `flyTo(nodeId, ms)`, `fitView()`, the v2 `useMemo` graph build, `onNodeClick`, the auto-rotate effect, the `<ForceGraph3D>` element.
- Produces: `focusCluster` state, `GNode.clusterId`, a `nodeCluster: Map<string,string>` returned from the `useMemo` (consumed by Task 2's `linkColor`), and a working enter/exit with camera fly. After this task, clicking a cluster flies in and ESC/breadcrumb/background-click return — but nothing is dimmed/labeled yet (that's Task 2).

- [ ] **Step 1: Add `clusterId` to the `GNode` interface**

In the `GNode` interface (near `deptColor?: string;`), add:

```ts
  clusterId?: string;
```

- [ ] **Step 2: Set `clusterId` on every node + return a `nodeCluster` map from the v2 `useMemo`**

In the v2 branch, add `clusterId` to the `common` object (the object spread into every returned node), just after `deptColor`:

```ts
          deptColor: hex,
          clusterId: n.kind === 'department' ? n.id : n.deptK,
```

Then, right before the v2 `return { data: { nodes: vnodes, links: vlinks }, adj: vadj };`, build a node→cluster map and include it:

```ts
const nodeCluster = new Map<string, string>();
for (const v of vnodes) if (v.clusterId) nodeCluster.set(v.id, v.clusterId);
return { data: { nodes: vnodes, links: vlinks }, adj: vadj, nodeCluster };
```

In the **non-v2** branch's return (`return { data: { nodes, links }, adj };`), add an empty map so the shape matches:

```ts
return { data: { nodes, links }, adj, nodeCluster: new Map<string, string>() };
```

Update the destructure (`const { data, adj } = useMemo(...)`) to:

```ts
  const { data, adj, nodeCluster } = useMemo(() => {
```

- [ ] **Step 3: Add `focusCluster` state + an `exitCluster` helper**

Near the other `useState` calls (e.g. beside `hoverId`), add:

```ts
const [focusCluster, setFocusCluster] = useState<string | null>(null);
```

After `fitView` is defined, add:

```ts
// Leave a focused cluster: back to the whole galaxy.
const exitCluster = () => {
  setFocusCluster(null);
  fitView();
};
```

- [ ] **Step 4: Enter a cluster on hub click**

In `onNodeClick`'s v2 branch, replace the current cluster-hub line
`if (n.kind === 'dept') return flyTo(n.id);` with:

```ts
if (n.kind === 'dept') {
  setFocusCluster(n.id);
  flyTo(n.id, 900);
  return;
}
```

(Leave the library/deliverable routing above it unchanged.)

- [ ] **Step 5: Exit via ESC and background click**

Add an effect (near the other effects) for the ESC key:

```ts
useEffect(() => {
  if (!focusCluster) return;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setFocusCluster(null);
      fitView();
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [focusCluster]);
```

Add the background-click handler to `<ForceGraph3D ...>` (alongside `onNodeClick`):

```tsx
            onBackgroundClick={() => {
              if (focusCluster) exitCluster();
            }}
```

- [ ] **Step 6: Breadcrumb "← All areas" button (with the current cluster name)**

Render it only in v2 while focused. Place it as an absolutely-positioned element at top-left (near the title block — put it just before or inside the title block, with `pointerEvents: 'auto'` and a `zIndex` above the map, e.g. 6):

```tsx
{
  SECOND_BRAIN_V2 && focusCluster && (
    <button
      onClick={exitCluster}
      style={{
        position: 'absolute',
        top: 20,
        left: 26,
        zIndex: 6,
        pointerEvents: 'auto',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontFamily: 'inherit',
        fontSize: 12.5,
        fontWeight: 700,
        color: '#7DE3FF',
        background: 'rgba(16,14,28,0.85)',
        border: '1px solid rgba(125,227,255,0.4)',
        borderRadius: 999,
        padding: '6px 14px',
        cursor: 'pointer',
      }}
    >
      ← All areas
      <span style={{ color: 'rgba(245,243,255,.6)', fontWeight: 600 }}>
        {data.nodes.find((n) => n.id === focusCluster)?.name ?? ''}
      </span>
    </button>
  );
}
```

(If the title `<h1>`/subtitle would overlap it, guard the title so it doesn't show while `focusCluster` is set — hide the title block when `SECOND_BRAIN_V2 && focusCluster`.)

- [ ] **Step 7: Pause auto-rotate while focused**

In the auto-rotate effect (currently `c.autoRotate = !here;`), change to:

```ts
c.autoRotate = !here && !focusCluster;
```

and add `focusCluster` to that effect's dependency array.

- [ ] **Step 8: Typecheck + lint**

Run: `npm run typecheck && npx eslint components/views/OverviewView.tsx`
Expected: typecheck clean; no new eslint errors (the added `eslint-disable-next-line` covers the ESC effect's deps).

- [ ] **Step 9: Build + visual check**

Run: `npm run build` (expect success), then `NEXT_PUBLIC_SECOND_BRAIN_V2=1 npm run dev`.
On the Second Brain screen: click a cluster hub → camera flies in and the auto-spin stops; a `← All areas` button with the cluster name appears top-left. Pressing ESC, clicking the button, or clicking empty space returns to the framed galaxy and the spin resumes. (No dimming/labels yet — that's Task 2.) No console errors.

- [ ] **Step 10: Commit**

```bash
git add components/views/OverviewView.tsx
git commit -m "feat(second-brain): enter/exit a cluster — fly in, breadcrumb + ESC + background-click out"
```

---

### Task 2: Focus visuals — dim the rest, label the focused cluster

**Files:**

- Modify: `components/views/OverviewView.tsx`

**Interfaces:**

- Consumes from Task 1: `focusCluster`, `GNode.clusterId`, `nodeCluster` map.
- Produces: the immersive look — out-of-cluster nodes/links dimmed, focused cluster's item labels shown, node objects rebuilt on focus change.

- [ ] **Step 1: Dim out-of-cluster nodes**

In the `nodeColor` callback, add the focus check before the existing hover/tour logic:

```ts
            nodeColor={(n) => {
              if (tourDim) return tourLit(n.id) ? n.color : DIM_NODE;
              if (focusCluster && n.clusterId !== focusCluster) return DIM_NODE;
              return inFocus(n.id) ? n.color : DIM_NODE;
            }}
```

- [ ] **Step 2: Dim links that aren't inside the focused cluster**

In the `linkColor` callback, add at the very top (before the hover/path logic):

```ts
            linkColor={(l) => {
              if (focusCluster) {
                const sc = nodeCluster.get(linkId(l.source));
                const tc = nodeCluster.get(linkId(l.target));
                if (sc !== focusCluster || tc !== focusCluster) return DIM_LINK;
              }
              // …existing hover / pathLinkIds / default logic unchanged…
```

- [ ] **Step 3: Show labels for the focused cluster in `nodeThreeObject`**

In the v2 branch of `nodeThreeObject` (after the firefly/aura sprites are added, where the old label block used to be), add a label when this node belongs to the focused cluster and isn't the company root:

```ts
// Phase B: while a cluster is focused, label its members (hubs + items) so the
// founder can read the area. Universe view stays label-free (hover tooltip only).
if (focusCluster && n.clusterId === focusCluster && !isRoot) {
  const lbl = new SpriteText(n.name);
  lbl.color = '#FFFFFF';
  lbl.textHeight = isDept ? 4.3 : 3.4;
  lbl.fontFace = 'Inter, system-ui, sans-serif';
  lbl.fontWeight = '700';
  (lbl as any).backgroundColor = 'rgba(7,9,20,0.5)';
  (lbl as any).padding = 2.5;
  (lbl as any).borderRadius = 3;
  lbl.strokeColor = 'rgba(3,4,12,0.95)';
  lbl.strokeWidth = 1;
  (lbl as any).position.set(0, size * 0.9 + 7, 0);
  group.add(lbl);
}
```

(`SpriteText` is already imported and used by the non-v2 branch; `size`, `isDept`, `isRoot`, `group` are already in scope in the v2 block.)

- [ ] **Step 4: Rebuild node objects when focus changes**

`react-force-graph` caches node objects, so `nodeThreeObject` won't re-run on a `focusCluster` change without a nudge. Add an effect:

```ts
useEffect(() => {
  (fgRef.current as any)?.refresh?.();
}, [focusCluster]);
```

(Positions are preserved; only the node objects re-render, so labels appear/disappear.)

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npx eslint components/views/OverviewView.tsx`
Expected: typecheck clean; no new eslint errors.

- [ ] **Step 6: Build + visual check**

Run: `npm run build`, then `NEXT_PUBLIC_SECOND_BRAIN_V2=1 npm run dev`.
Click a cluster: the rest of the galaxy fades to `DIM_NODE`/`DIM_LINK`, the focused cluster stays lit, and its item labels appear. Exit (ESC/button/background): dimming clears, labels hide, galaxy re-frames. Enter a different cluster: labels/dim update for the new cluster (refresh works). No console errors.

- [ ] **Step 7: Commit**

```bash
git add components/views/OverviewView.tsx
git commit -m "feat(second-brain): immersive cluster focus — dim the rest, label the focused area"
```

---

## Final verification

- [ ] `npm run typecheck && npm run lint && npm test && npm run build` — all pass; no new lint errors; suite green.
- [ ] With `NEXT_PUBLIC_SECOND_BRAIN_V2=1`: click a cluster → fly in, others dim, focused labels show, spin pauses; ESC / `← All areas` / background-click all exit to the framed galaxy with spin resumed and labels hidden; switching clusters updates the focus correctly.
- [ ] With `NEXT_PUBLIC_SECOND_BRAIN_V2` unset: Overview unchanged.

## Self-Review Notes

- **Spec coverage:** `focusCluster` state + `clusterId`/`nodeCluster` (T1 S1–S3); enter on hub click (T1 S4); three exits — ESC + background (T1 S5), breadcrumb (T1 S6); auto-rotate pause (T1 S7); dim nodes (T2 S1) + links (T2 S2); focused labels (T2 S3) + refresh (T2 S4). All covered.
- **Placeholder scan:** none — concrete code per step (T2 S2's "existing logic unchanged" refers to code already in the file, not a placeholder).
- **Type consistency:** `nodeCluster: Map<string,string>` returned from both `useMemo` branches and consumed in T2's `linkColor`; `clusterId` added to `GNode` (T1 S1) and read in T2 S1/S3; hub `id === 'cluster:N'` used consistently for enter (T1 S4) and name lookup (T1 S6).
