# UMAP Neighborhood Graph Visualization - Design

**Date:** 2026-02-14
**Status:** Approved

## Goal

Visualize the fuzzy simplicial set edges from UMAP on the chunks view to show which chunk relationships "made it" into the layout optimization.

## Background

UMAP constructs a weighted neighborhood graph (fuzzy simplicial set) by:
1. Computing k-NN distances for each point
2. Calculating local membership strengths (probabilities)
3. Symmetrizing via fuzzy union: `A + B - A⊙B`

The optimization only samples edges whose weight exceeds `max_weight / nEpochs`. This threshold determines which relationships actually influence the final layout.

## Design

### 1. Extract neighborhood graph from UMAP

**Where:** Extend `useUmapLayout` hook

**What:** After `initializeFit()` returns, access the internal graph:

```ts
const graph = (umap as any).graph as SparseMatrix;
const values = graph.getValues();
const graphMax = Math.max(...values);
const cutoff = graphMax / totalEpochs;

const edges = graph.getAll()
  .filter(({ value }) => value >= cutoff)
  .map(({ row, col, value }) => ({
    source: row,
    target: col,
    weight: value,
  }));
```

**Output:** Add `neighborhoodEdges: UmapEdge[]` to `UmapLayoutResult`

**Index correspondence:** Edge indices map directly to chunks array (same order as embeddings input)

### 2. Create ChunkEdges component

**File:** `src/components/chunks-r3f/ChunkEdges.tsx`

**Props:**
- `edges: UmapEdge[]` - neighborhood graph edges
- `positions: Float32Array` - interleaved [x,y,...] from UMAP
- `opacity: number` - global opacity multiplier

**Rendering approach:**
- Single `<line>` with merged BufferGeometry (same pattern as EdgeRenderer)
- Curved edges using `computeArcPoints()` from `edge-curves.ts`
- Outward bowing via `computeOutwardDirection()`
- 16 segments per edge + NaN break vertex
- Weight → alpha mapping (normalize to [0.05, 1.0])
- Viewport culling (20% margin beyond visible area)

**Simplifications vs. EdgeRenderer:**
- No hover highlighting
- No focus mode filtering
- No semantic colors (simple gray/white)
- No pulled positions
- Position lookup: direct index into Float32Array instead of Map lookup

### 3. Integration into ChunksScene

**Rendering:**
- Add `<ChunkEdges>` below instanced mesh (renderOrder = -2)
- Show only when `!isRunning` (UMAP complete)
- Fade in with opacity transition (0→1 over 500ms)

**Controls:**
- No new UI needed initially
- Could add toggle checkbox later if desired

## Visual Style

- **Color:** Light gray (#888888), semi-transparent
- **Opacity:** Weight-mapped to [0.05, 1.0]
- **Curve intensity:** 0.15 (moderate, matches topics default)
- **Line width:** 1px (native WebGL line)
- **Depth test:** Disabled (same as topics edges)

## Implementation Notes

### Constants
```ts
const EDGE_SEGMENTS = 16;
const ARC_VERTEX_COUNT = EDGE_SEGMENTS + 1;
const VERTICES_PER_EDGE = ARC_VERTEX_COUNT + 1; // +1 for NaN break
```

### Geometry allocation
- Position buffer: `edges.length * VERTICES_PER_EDGE * 3` floats
- Color buffer: `edges.length * VERTICES_PER_EDGE * 4` floats (RGBA)
- Manual bounding sphere to avoid NaN-related issues

### Viewport culling
Reuse `computeViewportZones()` from edge-pulling.ts. Skip edges where neither endpoint is in the expanded viewport (viewport bounds + 20% margin).

### Position updates
Run in `useFrame()` - read from positions buffer, write to geometry attributes. This ensures edges track node positions even if we later animate the layout.

## Future Enhancements

Not in scope for initial implementation:

- Toggle to show/hide edges
- Weight threshold slider
- Edge hover to highlight connected chunks
- Color by edge weight (gradient)
- Animate edges during UMAP (requires buffering edge positions)

## Testing

1. Visual inspection: edges should bow outward from centroid
2. Check filtering: only edges with `weight >= cutoff` appear
3. Verify culling: edges to off-screen nodes don't render
4. Performance: confirm smooth 60fps with ~1000 chunks (typical count)

## Files to Create/Modify

**New:**
- `src/components/chunks-r3f/ChunkEdges.tsx`

**Modified:**
- `src/hooks/useUmapLayout.ts` - add neighborhoodEdges extraction
- `src/components/chunks-r3f/ChunksScene.tsx` - render ChunkEdges
