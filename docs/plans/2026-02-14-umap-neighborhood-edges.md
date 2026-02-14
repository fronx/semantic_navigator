# UMAP Neighborhood Graph Visualization - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Visualize UMAP's fuzzy simplicial set edges on the chunks view to show which chunk relationships influenced the layout optimization.

**Architecture:** Extract the weighted neighborhood graph from umap-js after initialization, filter edges by the `max_weight / nEpochs` cutoff, and render them as curved lines using the same arc geometry as the topics view. Edges appear after UMAP completes with weight-mapped opacity.

**Tech Stack:** React Three Fiber, umap-js, Three.js BufferGeometry, existing edge-curves utilities

---

## Task 1: Add UmapEdge type and extend UmapLayoutResult

**Files:**
- Modify: `src/hooks/useUmapLayout.ts:12-23`

**Step 1: Add UmapEdge interface**

Add after existing interfaces (around line 23):

```typescript
export interface UmapEdge {
  /** Source node index (maps to chunks array) */
  source: number;
  /** Target node index (maps to chunks array) */
  target: number;
  /** Edge weight from fuzzy simplicial set */
  weight: number;
}
```

**Step 2: Extend UmapLayoutResult interface**

Modify the `UmapLayoutResult` interface to include:

```typescript
export interface UmapLayoutResult {
  /** Interleaved [x0,y0,x1,y1,...] positions centered on origin */
  positions: Float32Array;
  /** 0..1 progress through UMAP epochs */
  progress: number;
  /** Whether UMAP is currently running */
  isRunning: boolean;
  /** Current epoch number */
  epoch: number;
  /** Total number of epochs */
  totalEpochs: number;
  /** Neighborhood graph edges that influence the layout */
  neighborhoodEdges: UmapEdge[];
}
```

**Step 3: Run type check**

```bash
npx tsc --noEmit
```

Expected: PASS (no type errors yet, since we haven't implemented extraction)

**Step 4: Commit**

```bash
git add src/hooks/useUmapLayout.ts
git commit -m "Add UmapEdge type and neighborhoodEdges to UmapLayoutResult"
```

---

## Task 2: Extract neighborhood graph from UMAP

**Files:**
- Modify: `src/hooks/useUmapLayout.ts:10,171-188`

**Step 1: Import SparseMatrix type**

Add to imports at top of file (line 10):

```typescript
import { UMAP } from "umap-js";
import type { SparseMatrix } from "umap-js/dist/matrix";
```

**Step 2: Add edge extraction after initializeFit**

Replace lines 171-188 (the block starting with `const nEpochs = umap.initializeFit(embeddings);`) with:

```typescript
    const nEpochs = umap.initializeFit(embeddings);
    umapRef.current = umap;
    totalEpochsRef.current = nEpochs;
    epochRef.current = 0;
    stepsSinceRenderRef.current = 0;
    isRunningRef.current = true;

    // Extract neighborhood graph edges that will influence optimization
    const graph = (umap as unknown as { graph: SparseMatrix }).graph;
    const values = graph.getValues();
    const graphMax = Math.max(...values);
    const cutoff = graphMax / nEpochs;

    const neighborhoodEdges: UmapEdge[] = graph
      .getAll()
      .filter(({ value }) => value >= cutoff)
      .map(({ row, col, value }) => ({
        source: row,
        target: col,
        weight: value,
      }));

    // Allocate output buffer
    positionsRef.current = new Float32Array(embeddings.length * 2);
```

**Step 3: Store edges in ref**

Add a new ref after line 115 (after existing refs):

```typescript
  const neighborhoodEdgesRef = useRef<UmapEdge[]>([]);
```

Then update the extraction code to store:

```typescript
    neighborhoodEdgesRef.current = neighborhoodEdges;
```

(Add this line right after the `neighborhoodEdges` array is created)

**Step 4: Include edges in result snapshots**

Modify the `snapshotResult` function (around line 134) to include edges:

```typescript
    function snapshotResult(running: boolean): UmapLayoutResult {
      return {
        positions: positionsRef.current,
        progress:
          totalEpochsRef.current > 0
            ? epochRef.current / totalEpochsRef.current
            : 0,
        isRunning: running,
        epoch: epochRef.current,
        totalEpochs: totalEpochsRef.current,
        neighborhoodEdges: neighborhoodEdgesRef.current,
      };
    }
```

**Step 5: Initialize empty edges for early returns**

Update line 155 (the early return for < 2 points) to include empty edges:

```typescript
    if (embeddings.length < 2) {
      positionsRef.current = EMPTY_POSITIONS;
      epochRef.current = 0;
      totalEpochsRef.current = 0;
      neighborhoodEdgesRef.current = [];
      isRunningRef.current = false;
      setResult(snapshotResult(false));
      return;
    }
```

**Step 6: Run type check**

```bash
npx tsc --noEmit
```

Expected: PASS (all UmapLayoutResult consumers now have neighborhoodEdges)

**Step 7: Test in browser**

```bash
npm run dev
```

Navigate to `/chunks` and open browser console. Check that UMAP completes without errors. You can temporarily log the edges count:

```typescript
console.log(`UMAP extracted ${neighborhoodEdges.length} edges above cutoff ${cutoff.toFixed(4)}`);
```

Expected: Console shows edge count (typically 15-30 edges per chunk for nNeighbors=15)

**Step 8: Commit**

```bash
git add src/hooks/useUmapLayout.ts
git commit -m "Extract UMAP neighborhood graph edges above sampling threshold"
```

**Step 9: Fix parameter invalidation bug**

The `embeddingsKey` function only fingerprints embeddings data, not UMAP parameters. This causes parameter changes (nNeighbors, minDist, spread) to be ignored.

Update `embeddingsKey` function signature and implementation (lines 88-99):

```typescript
function embeddingsKey(
  embeddings: number[][],
  nNeighbors: number,
  minDist: number,
  spread: number
): string {
  if (embeddings.length === 0) return "empty";
  const first = embeddings[0];
  const last = embeddings[embeddings.length - 1];
  // Sample a few values for fingerprinting + include parameters
  return `${embeddings.length}:${first[0]}:${first[first.length - 1]}:${last[0]}:${last[last.length - 1]}:${nNeighbors}:${minDist}:${spread}`;
}
```

Update the call site (line 132):

```typescript
const key = embeddingsKey(embeddings, nNeighbors, minDist, spread);
```

**Step 10: Commit parameter fix**

```bash
git add src/hooks/useUmapLayout.ts
git commit -m "Fix parameter invalidation: include UMAP options in cache key"
```

---

## Task 3: Create ChunkEdges component scaffold

**Files:**
- Create: `src/components/chunks-r3f/ChunkEdges.tsx`

**Step 1: Write component scaffold with types**

```typescript
/**
 * Renders UMAP neighborhood graph edges as curved lines.
 * Shows which chunk relationships influenced the UMAP layout optimization.
 */

import { useRef, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import type { UmapEdge } from "@/hooks/useUmapLayout";
import { computeArcPoints, computeCentroid } from "@/lib/edge-curves";

const EDGE_SEGMENTS = 16;
const ARC_VERTEX_COUNT = EDGE_SEGMENTS + 1;
const VERTICES_PER_EDGE = ARC_VERTEX_COUNT + 1; // +1 for NaN "break" vertex

export interface ChunkEdgesProps {
  /** Neighborhood graph edges from UMAP */
  edges: UmapEdge[];
  /** Interleaved [x0,y0,x1,y1,...] positions from UMAP */
  positions: Float32Array;
  /** Global opacity multiplier (0-1) */
  opacity: number;
}

export function ChunkEdges({
  edges,
  positions,
  opacity,
}: ChunkEdgesProps): React.JSX.Element | null {
  const lineRef = useRef<THREE.Line>(null);
  const { camera, size } = useThree();

  if (edges.length === 0 || positions.length === 0) {
    return null;
  }

  return (
    // @ts-expect-error - R3F's <line> element is Three.js Line, not SVGLineElement
    <line ref={lineRef} frustumCulled={false}>
      <lineBasicMaterial vertexColors transparent opacity={opacity} depthTest={false} />
    </line>
  );
}
```

**Step 2: Run type check**

```bash
npx tsc --noEmit
```

Expected: PASS

**Step 3: Commit**

```bash
git add src/components/chunks-r3f/ChunkEdges.tsx
git commit -m "Add ChunkEdges component scaffold"
```

---

## Task 4: Add geometry allocation and curve direction computation

**Files:**
- Modify: `src/components/chunks-r3f/ChunkEdges.tsx:11,29-38`

**Step 1: Import computeOutwardDirection**

Update imports:

```typescript
import { computeArcPoints, computeCentroid, computeOutwardDirection } from "@/lib/edge-curves";
```

**Step 2: Add geometry allocation with useMemo**

Add after the `useThree` hook (around line 29):

```typescript
  const geometry = useMemo(() => {
    const totalVertices = edges.length * VERTICES_PER_EDGE;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(totalVertices * 3), 3));
    geom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(totalVertices * 4), 4));
    // Manual bounding sphere to prevent NaN break vertices from breaking bounds calculation
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 10000);
    return geom;
  }, [edges.length]);
```

**Step 3: Compute curve directions with useMemo**

Add after geometry:

```typescript
  // Compute curve directions (outward from centroid for convex appearance)
  const curveDirections = useMemo(() => {
    const directions = new Map<string, number>();

    // Build node positions from UMAP positions buffer
    const nodePositions: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < positions.length / 2; i++) {
      nodePositions.push({
        x: positions[i * 2],
        y: positions[i * 2 + 1],
      });
    }

    const centroid = computeCentroid(nodePositions);

    for (const edge of edges) {
      const source = nodePositions[edge.source];
      const target = nodePositions[edge.target];
      if (!source || !target) continue;

      const direction = computeOutwardDirection(source, target, centroid);
      directions.set(`${edge.source}->${edge.target}`, direction);
    }

    return directions;
  }, [edges, positions]);
```

**Step 4: Attach geometry to line ref**

Update the JSX return:

```typescript
  return (
    // @ts-expect-error - R3F's <line> element is Three.js Line, not SVGLineElement
    <line ref={lineRef} geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial vertexColors transparent opacity={opacity} depthTest={false} />
    </line>
  );
```

**Step 5: Run type check**

```bash
npx tsc --noEmit
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/components/chunks-r3f/ChunkEdges.tsx
git commit -m "Add edge geometry allocation and curve direction computation"
```

---

## Task 5: Implement edge rendering with useFrame

**Files:**
- Modify: `src/components/chunks-r3f/ChunkEdges.tsx:31` (insert after curveDirections)

**Step 1: Import computeViewportZones**

Update imports:

```typescript
import { computeViewportZones } from "@/lib/edge-pulling";
```

**Step 2: Add useFrame for per-frame edge rendering**

Add after `curveDirections` useMemo (around line 60):

```typescript
  useFrame(() => {
    const line = lineRef.current;
    if (!line) return;

    // Hide if invisible
    if (opacity < 0.01) {
      line.visible = false;
      return;
    }
    line.visible = true;

    const posArray = line.geometry.attributes.position.array as Float32Array;
    const colArray = line.geometry.attributes.color.array as Float32Array;

    // Compute viewport bounds for edge culling (20% margin)
    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    const zones = computeViewportZones(perspectiveCamera, size.width, size.height);
    const viewportWidth = zones.viewport.right - zones.viewport.left;
    const viewportHeight = zones.viewport.top - zones.viewport.bottom;
    const marginX = viewportWidth * 0.2;
    const marginY = viewportHeight * 0.2;
    const minX = zones.viewport.left - marginX;
    const maxX = zones.viewport.right + marginX;
    const minY = zones.viewport.bottom - marginY;
    const maxY = zones.viewport.top + marginY;

    for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex++) {
      const edge = edges[edgeIndex];
      const baseOffset = edgeIndex * VERTICES_PER_EDGE * 3;

      // Get source/target positions from UMAP positions buffer
      const sourceIdx = edge.source * 2;
      const targetIdx = edge.target * 2;

      // Bounds check
      if (sourceIdx + 1 >= positions.length || targetIdx + 1 >= positions.length) {
        for (let i = 0; i < VERTICES_PER_EDGE * 3; i++) posArray[baseOffset + i] = NaN;
        continue;
      }

      const sx = positions[sourceIdx];
      const sy = positions[sourceIdx + 1];
      const tx = positions[targetIdx];
      const ty = positions[targetIdx + 1];

      // Viewport culling: skip if neither endpoint is visible
      const sourceInView = sx >= minX && sx <= maxX && sy >= minY && sy <= maxY;
      const targetInView = tx >= minX && tx <= maxX && ty >= minY && ty <= maxY;
      if (!sourceInView && !targetInView) {
        for (let i = 0; i < VERTICES_PER_EDGE * 3; i++) posArray[baseOffset + i] = NaN;
        continue;
      }

      // Get curve direction
      const direction = curveDirections.get(`${edge.source}->${edge.target}`) ?? 1;

      // Compute arc points (curve intensity 0.15)
      const arcPoints = computeArcPoints(
        { x: sx, y: sy },
        { x: tx, y: ty },
        0.15,
        direction,
        EDGE_SEGMENTS
      );

      // Write arc positions (z=0 for all chunks - flat 2D layout)
      if (arcPoints.length >= ARC_VERTEX_COUNT) {
        for (let i = 0; i < ARC_VERTEX_COUNT; i++) {
          const idx = baseOffset + i * 3;
          posArray[idx] = arcPoints[i].x;
          posArray[idx + 1] = arcPoints[i].y;
          posArray[idx + 2] = 0;
        }
      } else {
        // Straight line fallback (should never happen with 16 segments)
        const first = arcPoints[0];
        const last = arcPoints[arcPoints.length - 1];
        for (let i = 0; i < ARC_VERTEX_COUNT; i++) {
          const idx = baseOffset + i * 3;
          const t = i / (ARC_VERTEX_COUNT - 1);
          posArray[idx] = first.x + t * (last.x - first.x);
          posArray[idx + 1] = first.y + t * (last.y - first.y);
          posArray[idx + 2] = 0;
        }
      }

      // Write NaN "break" vertex to prevent line connecting to next edge
      const breakIdx = baseOffset + ARC_VERTEX_COUNT * 3;
      posArray[breakIdx] = NaN;
      posArray[breakIdx + 1] = NaN;
      posArray[breakIdx + 2] = NaN;

      // Write RGBA color: light gray with weight-based alpha
      // Normalize weight to [0.05, 1.0] range
      const alpha = 0.05 + edge.weight * 0.95;
      const colBaseOffset = edgeIndex * VERTICES_PER_EDGE * 4;
      for (let i = 0; i < VERTICES_PER_EDGE; i++) {
        const ci = colBaseOffset + i * 4;
        colArray[ci] = 0.533; // #888888 red channel
        colArray[ci + 1] = 0.533; // green
        colArray[ci + 2] = 0.533; // blue
        colArray[ci + 3] = alpha;
      }
    }

    line.geometry.attributes.position.needsUpdate = true;
    line.geometry.attributes.color.needsUpdate = true;
  });
```

**Step 3: Run type check**

```bash
npx tsc --noEmit
```

Expected: PASS

**Step 4: Commit**

```bash
git add src/components/chunks-r3f/ChunkEdges.tsx
git commit -m "Implement edge rendering with curved arcs and viewport culling"
```

---

## Task 6: Integrate ChunkEdges into ChunksScene

**Files:**
- Modify: `src/components/chunks-r3f/ChunksScene.tsx`

**Step 1: Import ChunkEdges and useState**

Add to imports at top:

```typescript
import { useState, useEffect } from "react";
import { ChunkEdges } from "./ChunkEdges";
```

**Step 2: Add opacity state for fade-in**

Add state after props destructuring (around line 25):

```typescript
  const [edgeOpacity, setEdgeOpacity] = useState(0);
```

**Step 3: Add useEffect for fade-in when UMAP completes**

Add before the useMemo blocks:

```typescript
  // Fade in edges when UMAP completes
  useEffect(() => {
    if (!isRunning && edgeOpacity < 1) {
      const startTime = Date.now();
      const duration = 500; // 500ms fade

      const interval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        setEdgeOpacity(progress);

        if (progress >= 1) {
          clearInterval(interval);
        }
      }, 16); // ~60fps

      return () => clearInterval(interval);
    } else if (isRunning && edgeOpacity > 0) {
      // Reset if UMAP restarts
      setEdgeOpacity(0);
    }
  }, [isRunning, edgeOpacity]);
```

**Step 4: Render ChunkEdges before instanced mesh**

Add ChunkEdges in the JSX return, before the `<instancedMesh>` (around line 95):

```typescript
  return (
    <>
      {/* Neighborhood graph edges (behind cards) */}
      {!isRunning && neighborhoodEdges.length > 0 && (
        <ChunkEdges
          edges={neighborhoodEdges}
          positions={positions}
          opacity={edgeOpacity * 0.3} // 30% max opacity
        />
      )}

      {/* Card instances */}
      <instancedMesh
        ref={meshRef}
```

**Step 5: Run type check**

```bash
npx tsc --noEmit
```

Expected: PASS

**Step 6: Test in browser**

```bash
npm run dev
```

Navigate to `/chunks` and wait for UMAP to complete. Expected:
- Edges fade in over 500ms after layout finishes
- Curved lines connecting nearby chunks
- Lines bow outward from center
- Semi-transparent gray color

**Step 7: Commit**

```bash
git add src/components/chunks-r3f/ChunksScene.tsx
git commit -m "Integrate ChunkEdges into ChunksScene with fade-in animation"
```

---

## Task 7: Fix edge weight normalization

**Files:**
- Modify: `src/components/chunks-r3f/ChunkEdges.tsx:120-130`

**Context:** The current weight normalization assumes weights are in [0, 1] range, but UMAP fuzzy set weights can vary. We need to normalize relative to the max weight in the edge set.

**Step 1: Compute max weight in useMemo**

Add after `curveDirections` useMemo:

```typescript
  // Normalize edge weights to [0, 1] for alpha mapping
  const maxWeight = useMemo(() => {
    if (edges.length === 0) return 1;
    return Math.max(...edges.map(e => e.weight));
  }, [edges]);
```

**Step 2: Update alpha calculation in useFrame**

Find the alpha calculation line (around line 125):

```typescript
      // Write RGBA color: light gray with weight-based alpha
      // Normalize weight to [0.05, 1.0] range
      const normalizedWeight = edge.weight / maxWeight;
      const alpha = 0.05 + normalizedWeight * 0.95;
```

**Step 3: Test in browser**

```bash
npm run dev
```

Navigate to `/chunks`. Expected: Stronger edges (higher weight) are more opaque.

**Step 4: Commit**

```bash
git add src/components/chunks-r3f/ChunkEdges.tsx
git commit -m "Normalize edge weights relative to max for consistent opacity"
```

---

## Task 8: Verify and document

**Files:**
- Modify: `docs/plans/2026-02-14-umap-neighborhood-edges-design.md` (mark as implemented)

**Step 1: Visual testing checklist**

Open `/chunks` in browser and verify:

- [ ] Edges appear after UMAP completes (not during)
- [ ] Edges fade in smoothly over ~500ms
- [ ] Edges curve outward from center (convex)
- [ ] Stronger edges (higher weight) are more opaque
- [ ] Edges to off-screen chunks are culled (pan to edge of layout)
- [ ] No visual glitches or z-fighting
- [ ] Smooth 60fps with ~1000 chunks

**Step 2: Update design doc status**

Update the design doc header:

```markdown
**Status:** Implemented (2026-02-14)
```

**Step 3: Commit design doc update**

```bash
git add docs/plans/2026-02-14-umap-neighborhood-edges-design.md
git commit -m "Mark UMAP neighborhood edges as implemented"
```

**Step 4: Final commit with all changes**

If any files were missed:

```bash
git add .
git status
# Review changes, then:
git commit -m "Complete UMAP neighborhood graph visualization"
```

---

## Testing Notes

**Performance:** With 1000 chunks and ~15 neighbors each, expect ~7500 edges after symmetrization, filtered down to ~7500 edges above cutoff. Each edge has 18 vertices (17 + 1 NaN), so ~135k vertices total. This should render at 60fps on modern hardware.

**Visual verification:**
- Edges should form a "web" connecting nearby chunks in embedding space
- The graph should be sparse (not every chunk connected to every other)
- Stronger connections (semantically similar chunks) should be more visible

**Edge cases:**
- Empty chunks array: no edges, component returns null ✓
- Single chunk: no edges, component returns null ✓
- UMAP running: edges hidden until complete ✓

---

## Future Work

Tracked in design doc, not in this implementation:

- Toggle to show/hide edges
- Weight threshold slider
- Edge hover highlighting
- Color by weight gradient
- Animate edges during UMAP optimization
