# Chunk Node LOD Optimization Investigation

> **ARCHIVED (2026-02):** This investigation analyzed LOD optimization for the raw Three.js renderer, which was removed from the codebase. The R3F (React Three Fiber) implementation uses a different approach with instanced rendering and visibility-based culling.

**Date**: 2026-02-03
**Status**: Analysis Complete - Recommendation Provided (for archived Three.js renderer)
**Related Files**: `src/lib/three/node-renderer.ts`, `src/lib/three/renderer.ts` (deleted)

## Summary

Investigated implementing Level of Detail (LOD) optimization for the 266 chunk nodes in the Three.js graph renderer. Analysis shows that **visibility-based culling** is the best approach for immediate performance gains, while **instanced rendering** would be the long-term optimal solution if draw calls become a bottleneck.

## Current State

- **Node Count**: 266 chunk nodes (+ their labels and edges)
- **Geometry**: THREE.CircleGeometry with 64 segments
- **Vertices**: ~52,000 total vertices (196 per chunk node)
- **Draw Calls**: 532 (2 per chunk: fill mesh + outline mesh)
- **Memory**: ~1.6 MB for geometry
- **Current Optimization**: Scale interpolation (chunks scale from 0 to 1 based on camera Z)

## Performance Analysis

### Key Findings

1. **Vertex count is NOT the bottleneck**
   - 52,136 vertices is trivial for modern GPUs (can handle 10+ million)
   - CircleGeometry is already very simple (no benefit from reducing segments)

2. **Draw calls are the potential bottleneck**
   - 532 separate mesh draw calls per frame
   - This is moderate but could impact performance on lower-end devices
   - Main optimization opportunity

3. **Scale-based rendering is wasteful but not catastrophic**
   - When chunkScale = 0, vertices are still transformed but produce ~0 pixels
   - Three.js processes the mesh but minimal GPU fill cost
   - Estimated waste: ~0.5-1ms per frame when fully zoomed out

### Zoom Level Breakdown

| Scenario | Camera Z | Chunk Scale | Visibility | Performance Impact |
|----------|----------|-------------|------------|-------------------|
| Very Far | 20,000 | 0.00 | Hidden | Wasting GPU cycles on invisible nodes |
| Far | 10,000 | 0.00 | Hidden | Wasting GPU cycles on invisible nodes |
| Mid | 5,000 | 0.25 | Partial | Some benefit from LOD |
| Close | 500 | 0.81 | Mostly visible | Full rendering needed |
| Very Close | 50 | 1.00 | Fully visible | Full rendering needed |

## LOD Strategies Evaluated

### Option A: Visibility-Based Culling ✅ RECOMMENDED (Short Term)

**Implementation**: Set `mesh.visible = false` when `chunkScale < 0.01`

**Pros**:
- Simple implementation (5-10 lines of code)
- Completely skips rendering when scale is tiny
- No geometry changes needed
- Safe and easy to test

**Cons**:
- Still in scene graph (minimal frustum check overhead)
- Binary on/off (no gradual LOD levels)

**Estimated Savings**: ~0.5-1ms per frame when zoomed out
**Complexity**: Low
**Code Impact**: Single function modification in `node-renderer.ts`

### Option B: THREE.LOD

**Implementation**: Use Three.js built-in LOD system with distance-based geometry switching

**Assessment**: ❌ **NOT RECOMMENDED**
- Overkill for simple circle geometry
- Requires multiple geometries per node
- Circles already have minimal vertex count
- High complexity for negligible benefit

### Option C: Geometry Simplification

**Implementation**: Reduce circle segments based on distance (64 → 16 → 8 segments)

**Assessment**: ❌ **NOT RECOMMENDED**
- Addresses wrong bottleneck (vertices, not draw calls)
- Circles already low-poly (~66 vertices each)
- Still have 532 draw calls
- Minimal performance gain (<0.1ms per frame)

### Option D: Instanced Rendering ⭐ RECOMMENDED (Long Term)

**Implementation**: Use THREE.InstancedMesh for all chunks of the same type

**Pros**:
- Massive draw call reduction: 532 → 2 draw calls (fill + outline)
- GPU instancing = 10-50x performance improvement for many identical objects
- Same visual quality
- Can still control per-instance visibility, scale, color via attributes

**Cons**:
- More complex implementation (requires instanced attributes)
- Harder to integrate with 3d-force-graph's node management
- All instances share same base geometry (acceptable for chunks)

**Estimated Savings**: 2-5ms per frame (major improvement)
**Complexity**: Medium-High
**Code Impact**: Significant refactoring of `node-renderer.ts`

## Recommendation

### Immediate Action: Implement Visibility Culling

Based on the performance analysis, I recommend implementing **Option A: Visibility-Based Culling** as a quick win.

**Why**:
1. Simple to implement and test
2. Provides measurable benefit when zoomed out (chunks are invisible anyway)
3. Zero risk of visual regression
4. Can be implemented in minutes

**When to consider Option D** (Instanced Rendering):
- If profiling shows frame drops during graph interaction
- If the graph scales to 1000+ chunk nodes
- If you're already refactoring the renderer for other reasons

### Reality Check

**Before optimizing further, measure actual performance**:

1. Open Chrome DevTools → Performance tab
2. Record 10 seconds of graph interaction (zooming, panning)
3. Look for:
   - Frame drops below 60fps
   - GPU time > 16ms per frame
   - Main thread congestion

**If performance is already smooth (60fps), don't optimize yet.**

Current rendering cost (52k vertices, 532 draw calls) is well within acceptable limits for modern hardware. The user's suggestion about LOD is architecturally sound, but may not be necessary based on actual performance.

## Implementation Example

Here's the minimal code change to implement visibility culling:

```typescript
// In src/lib/three/node-renderer.ts, modify updateNodeScales():

function updateNodeScales(scales: ScaleValues): void {
  const VISIBILITY_THRESHOLD = 0.01; // Hide when scale < 1%

  for (const cached of nodeCache.values()) {
    const { node, group } = cached;

    // Apply scale based on node type
    if (node.type === "keyword") {
      group.scale.setScalar(scales.keywordScale);
      group.visible = scales.keywordScale >= VISIBILITY_THRESHOLD;
    } else if (node.type === "chunk") {
      group.scale.setScalar(scales.chunkScale);
      group.visible = scales.chunkScale >= VISIBILITY_THRESHOLD; // NEW LINE
    }
    // Projects and articles don't scale (they're always visible)
  }
}
```

**Result**: When chunks scale below 0.01, they're completely skipped by the renderer, saving ~0.5-1ms per frame when zoomed out.

## Performance Measurement Script

A detailed performance analysis script has been created at:
- `scripts/analyze-three-performance.ts`

Run with: `npm run script scripts/analyze-three-performance.ts`

This script analyzes:
- Geometry complexity (vertices, segments)
- Memory footprint
- Draw call analysis
- Zoom-level performance characteristics
- LOD strategy comparisons

## Next Steps

1. **Implement visibility culling** (Option A) - Quick win with minimal risk
2. **Measure actual performance** using browser DevTools
3. **If bottlenecks found**, consider instanced rendering (Option D)
4. **Document performance baselines** for regression testing

## Appendix: Technical Details

### Current Scale Calculation

From `src/lib/chunk-scale.ts`:
```typescript
// Chunks transition from hidden (far) to visible (close)
const MIN_Z = 50;   // Very close - chunks fully visible
const MAX_Z = 10000; // Far away - keywords fully visible

const t = (cameraZ - MIN_Z) / (MAX_Z - MIN_Z);
const chunkScale = (1 - t) ** 2; // Exponential fade-in
```

### Visibility Culling Threshold

- `chunkScale < 0.01` means the node is smaller than 1% of its full size
- At this scale, the node is essentially invisible (< 0.3 pixels)
- Skipping rendering provides immediate benefit with no visual impact

### Instanced Rendering Considerations

If implementing Option D in the future:

```typescript
// Pseudo-code for instanced rendering approach
const chunkInstancedMesh = new THREE.InstancedMesh(
  circleGeometry,
  material,
  CHUNK_NODE_COUNT
);

// Per-instance attributes:
// - position (x, y, z)
// - scale (float)
// - color (r, g, b)
// - visibility (float, 0 or 1)

// Update per frame:
for (let i = 0; i < chunks.length; i++) {
  matrix.setPosition(chunk.x, chunk.y, chunk.z);
  matrix.scale.setScalar(chunk.scale);
  chunkInstancedMesh.setMatrixAt(i, matrix);
  chunkInstancedMesh.setColorAt(i, chunk.color);
}
chunkInstancedMesh.instanceMatrix.needsUpdate = true;
```

Benefits: Single draw call instead of 266, massive GPU efficiency gain.

## References

- [Three.js InstancedMesh Documentation](https://threejs.org/docs/#api/en/objects/InstancedMesh)
- [Three.js LOD Documentation](https://threejs.org/docs/#api/en/objects/LOD)
- [WebGL Performance Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)
