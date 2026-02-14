# UMAP Neighborhood Graph Visualization – Implementation Plan

**Date:** 2026-02-14  
**Status:** In Progress

Goal: surface UMAP's fuzzy simplicial set edges on the `/chunks` view so users can see which chunk-to-chunk relationships actually influenced the layout.

Architecture recap:
- `useUmapLayout` already runs `umap-js` step-by-step on the client and keeps the embedding positions in a `Float32Array`.
- We now also expose the filtered fuzzy graph (edges with weight ≥ `graphMax / nEpochs`) and feed it to a new `<ChunkEdges>` renderer that draws curved lines behind the chunk cards once UMAP converges.

Implementation is broken into three tasks below.

---

## Task 1 – Harden `useUmapLayout` edge extraction

**Files:** `src/hooks/useUmapLayout.ts`

### Requirements
1. **Safe access to the private graph:** keep the `(umap as { graph: SparseMatrix })` cast, but guard against undefined graphs (e.g., insufficient neighbors) before touching it.
2. **Handle empty/degenerate graphs:** if `graph.getValues()` returns an empty array, set `neighborhoodEdgesRef` to `[]` and skip the cutoff math.
3. **Deduplicate undirected edges:** the symmetrized fuzzy set contains both `(i → j)` and `(j → i)`. Only keep the stronger direction per unordered pair (based on weight + tie-breaker on index) so the renderer deals with one edge per neighbor pair.
4. **Track revisions:** store an `edgesVersionRef` that increments whenever we recompute the graph so downstream consumers (ChunkEdges) can detect updates even though the `Float32Array` positions mutate in place.
5. **Reset state on restart:** whenever embeddings/params change but we bail early (e.g., `< 2 points`), clear both the edge ref and version ref before returning.
6. **Expose version + edges:** extend `UmapLayoutResult` with `neighborhoodEdgesVersion: number` so React props can trigger rerenders when the edge list changes.

### Testing
- `npx tsc --noEmit`
- Manual: load `/chunks`, tweak `nNeighbors` slider, confirm `neighborhoodEdgesVersion` increments and edge count logs change.

---

## Task 2 – Implement `<ChunkEdges>` renderer

**Files:** `src/components/chunks-r3f/ChunkEdges.tsx`, `src/lib/edge-curves.ts` (type reuse)

### Responsibilities
1. **Geometry allocation:** create a `THREE.BufferGeometry` with `(segments + 1 + 1)` vertices per edge (the last one is a NaN break). Re-allocate whenever either `edges.length` or the `edgesVersion` prop changes so stale data cannot leak.
2. **Per-frame updates:** inside `useFrame`, rebuild vertex + color buffers directly from the latest `positions` buffer to handle the fact that UMAP writes into the same `Float32Array`. No `useMemo` that depends on array identity.
3. **Viewport culling:** reuse `computeViewportZones` (world-space culling is fine because the camera is always orthographic-like looking straight down). Skip edges whose endpoints are both outside the expanded viewport.
4. **Curve math:** use existing `computeArcPoints` + `computeOutwardDirection` helpers, but fall back to straight lines if nodes overlap.
5. **Opacity mapping:** normalize weights by the local maximum weight per frame, clamp to `[0.05, 1.0]`, and multiply by the `opacity` prop. If max weight is zero, treat all alphas as 0.05.
6. **Resource cleanup:** dispose geometry/material on unmount.

### Props
```ts
interface ChunkEdgesProps {
  edges: UmapEdge[];
  edgesVersion: number;
  positions: Float32Array;
  opacity: number;
}
```

### Testing
- `npx tsc --noEmit`
- Manual: view `/chunks`, ensure edges follow nodes while dragging camera, and opacity reflects edge strength.

---

## Task 3 – Integrate ChunkEdges into ChunksScene

**Files:** `src/components/chunks-r3f/ChunksScene.tsx`

### Steps
1. **State & props:** accept `neighborhoodEdges` + `neighborhoodEdgesVersion` + `isRunning` (already available from the hook). Track a simple fade scalar in state that animates from 0 → 1 over 500 ms when `isRunning` flips to `false`, and reset to 0 when a new run starts.
2. **Render ordering:** mount `<ChunkEdges>` before the instanced mesh so the lines render underneath cards. Pass `opacity={fade * 0.35}` (tweakable).
3. **Visibility guards:** if there are no edges or the fade is ~0, skip rendering entirely to avoid unnecessary work.
4. **Testing:** `npm run dev`, visit `/chunks`, verify edges fade in only after UMAP converges and fade resets when parameters change.

---

## Acceptance Checklist
- [ ] `useUmapLayout` exposes deduped edges plus a monotonic version counter.
- [ ] `<ChunkEdges>` renders curved lines with culling and reacts to live position updates.
- [ ] Chunks scene shows the neighborhood graph after convergence with smooth fade-in.
