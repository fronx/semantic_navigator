# ChunksView Cluster Labels Design

## Goal

Add labeled cluster regions to ChunksView so users can orient themselves in the UMAP layout. Inspired by TopicsView's two-level cluster label system, but adapted for chunk-level data.

## Key Decisions

- **Clustering algorithm**: Leiden on the UMAP neighborhood graph (the fuzzy simplicial set that UMAP already computes). No separate K-NN step needed.
- **Two resolution levels**: Coarse clusters (few large groups) at far zoom, fine clusters (many small groups) at mid zoom. Both labeled by Haiku.
- **Label input**: First ~200 characters of each chunk's content, sent to Haiku per cluster.
- **UMAP caching**: Server-side JSON file. Default behavior loads cached positions instantly. "Redo UMAP" button recomputes.
- **Label caching**: Server-side, stored alongside UMAP positions in the same cache file. Invalidated when UMAP is recomputed or resolutions change.
- **Rendering**: Reuse existing `ClusterLabels3D` / `ClusterLabelSprite` from TopicsView with configurable fade ranges.

## Data Flow

### First Visit (no cache)

1. Client loads ChunksView
2. `GET /api/chunks/layout` returns 404
3. `GET /api/chunks/embeddings` returns 256-dim embeddings (existing)
4. Client runs UMAP (as today) producing positions + neighborhood graph
5. `POST /api/chunks/layout` sends `{ positions, edges, chunkIds, coarseResolution, fineResolution }`
6. Server runs Leiden at both resolutions on the neighborhood graph
7. Server fetches chunk content from database, assembles excerpts per cluster
8. Server calls Haiku to label both coarse and fine clusters
9. Server writes cache file, returns `{ coarseClusters, fineClusters, coarseLabels, fineLabels }`
10. Client renders graph with cluster labels

### Subsequent Visits (cached)

1. `GET /api/chunks/layout` returns full cache (positions + clusters + labels)
2. Client renders immediately — no UMAP, no embedding fetch

### Redo UMAP

1. User clicks "Redo UMAP" button
2. Client fetches embeddings, runs UMAP
3. `POST /api/chunks/layout` overwrites cache
4. Server re-clusters, re-labels, returns new data

### Resolution Slider Change

1. User adjusts coarse or fine resolution slider
2. `POST /api/chunks/layout/recluster` sends `{ coarseResolution, fineResolution }`
3. Server reads cached positions+edges, re-runs Leiden, re-labels
4. Returns new `{ coarseClusters, fineClusters, coarseLabels, fineLabels }`

## Cache File

Location: `data/chunks-layout.json` (gitignored)

```typescript
{
  // From client (UMAP output)
  positions: number[],        // flat [x0,y0,x1,y1,...] serialized from Float32Array
  edges: { source: number, target: number, weight: number }[],
  chunkIds: string[],         // UUIDs, index-aligned with positions

  // Server-computed
  coarseResolution: number,
  fineResolution: number,
  coarseClusters: Record<number, number>,  // chunkIndex -> clusterId
  fineClusters: Record<number, number>,
  coarseLabels: Record<number, string>,    // clusterId -> label
  fineLabels: Record<number, string>,

  createdAt: string           // ISO timestamp
}
```

## API Endpoints

### GET /api/chunks/layout

Returns the full cache file or 404 if no cache exists.

### POST /api/chunks/layout

Stores UMAP result and computes clusters + labels.

Request: `{ positions: number[], edges: UmapEdge[], chunkIds: string[], coarseResolution?: number, fineResolution?: number }`

Server-side steps:
1. Build graphology graph from edges (nodes = chunk indices, weighted edges)
2. Run Leiden at coarse resolution (default 0.3) -> node-to-cluster mapping
3. Run Leiden at fine resolution (default 1.5) -> node-to-cluster mapping
4. For each cluster at each resolution: collect chunk IDs of members
5. Fetch chunk content from Supabase (batch query by IDs)
6. Assemble content excerpts (first ~200 chars per chunk, up to ~15 chunks per cluster)
7. Call Haiku to generate labels (reuse prompt pattern from TopicsView's `generateClusterLabels`)
8. Write cache file
9. Return clusters + labels

### POST /api/chunks/layout/recluster

Re-clusters cached positions with new resolutions.

Request: `{ coarseResolution: number, fineResolution: number }`

Server reads cached positions+edges, runs Leiden, re-labels via Haiku, updates cache. Returns new clusters + labels.

## Leiden Clustering

Uses `graphology-communities-louvain` (already a project dependency, used in TopicsView's client-side fallback).

Input: UMAP neighborhood graph with edge weights from the fuzzy simplicial set.

Two fixed resolutions controlled by sliders:
- **Coarse**: default 0.3, range 0.1-2.0. Produces ~5-10 clusters.
- **Fine**: default 1.5, range 0.5-4.0. Produces ~15-30 clusters.

Actual cluster counts depend on dataset size and graph structure.

## Label Generation

Reuses the pattern from `src/lib/llm.ts` (`generateClusterLabels`):
- Model: `claude-haiku-4-5-20251001`
- Input per cluster: content excerpts (first ~200 chars) from up to 15 member chunks
- Output: 2-4 word label per cluster
- Prompt: "Generate a SHORT label (2-4 words) that captures what this group of text chunks is about"

## Rendering

### Component Reuse

Reuse `ClusterLabels3D` and `ClusterLabelSprite` from `src/components/topics-r3f/` directly.

Render two instances of ClusterLabels3D in ChunksScene:
1. **Coarse layer**: large cluster labels visible at far zoom
2. **Fine layer**: smaller cluster labels visible at mid zoom

### Fade Machinery

Reuse `computeLabelFade()` from `src/lib/label-fade-coordinator.ts`. Compute two fade values per frame:

- `coarseToFineFade`: 0 at far zoom, 1 at mid zoom (controls coarse-to-fine transition)
- `fineToCardFade`: 0 at mid zoom, 1 at near zoom (controls fine-to-card-text transition)

**Coarse layer**: pass `labelFadeT = coarseToFineFade`. The existing `(1 - labelFadeT)` logic fades coarse labels out as we zoom in. Works as-is.

**Fine layer**: needs to fade IN (as coarse fades out) AND fade OUT (as card text becomes readable). This requires a small extension to ClusterLabels3D: add an optional `fadeInT` prop (default 1.0) so the formula becomes:

```
finalOpacity = baseOpacity * sizeFade * fadeInT * (1 - labelFadeT)
```

Fine layer passes `fadeInT = coarseToFineFade` and `labelFadeT = fineToCardFade`.

This is the only change needed to ClusterLabels3D — a single optional prop, fully backwards-compatible.

### Fade Range Sliders

Four slider values in ChunksControlSidebar controlling the Z thresholds:
- **Coarse fade start** (far Z where coarse begins fading)
- **Coarse fade end** (mid Z where coarse fully faded, fine fully visible)
- **Fine fade start** (mid Z where fine begins fading)
- **Fine fade end** (near Z where fine fully faded, card text takes over)

These map directly to two `LabelFadeRange` objects passed to `computeLabelFade()`.

## UI Changes

### ChunksControlSidebar

New controls:
- **Cluster Labels section**:
  - Coarse resolution slider (0.1-2.0, default 0.3)
  - Fine resolution slider (0.5-4.0, default 1.5)
  - Coarse fade range sliders (start Z, end Z)
  - Fine fade range sliders (start Z, end Z)
- **Redo UMAP button**: triggers re-computation + re-cache

### ChunksScene

- Two `ClusterLabels3D` instances (coarse + fine)
- Fade values computed in `useFrame` from camera Z
- Cluster data (node-to-cluster maps, labels, colors) derived from API response

## Files to Create/Modify

**New files:**
- `src/app/api/chunks/layout/route.ts` — GET + POST endpoints
- `src/app/api/chunks/layout/recluster/route.ts` — POST recluster endpoint

**Modified files:**
- `src/components/ChunksView.tsx` — fetch cached layout on mount, POST after UMAP
- `src/components/chunks-r3f/ChunksScene.tsx` — render two ClusterLabels3D instances, compute fade values
- `src/components/ChunksControlSidebar.tsx` — add resolution + fade range sliders, Redo UMAP button
- `src/components/topics-r3f/ClusterLabels3D.tsx` — add optional `fadeInT` prop
- `src/hooks/useUmapLayout.ts` — expose a way to skip UMAP when cached positions are available

**Reused as-is:**
- `src/lib/label-fade-coordinator.ts` — `computeLabelFade()`, `LabelFadeRange`
- `src/lib/llm.ts` — `generateClusterLabels()` (or similar prompt for chunk content)
- `src/components/topics-r3f/ClusterLabelSprite` (child of ClusterLabels3D)
