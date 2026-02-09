# Chunk Node LOD Optimization - Executive Summary

> **ARCHIVED (2026-02):** This investigation was for the raw Three.js renderer, which was removed from the codebase. The R3F (React Three Fiber) implementation already includes visibility-based culling and instanced rendering.

**Investigation Date**: 2026-02-03
**Status**: Analysis Complete (for archived Three.js renderer)
**Estimated Implementation Time**: 15-30 minutes

## Quick Answer

**Should we implement LOD for chunk nodes?**

**Yes, but use the simple approach**: Visibility-based culling provides measurable benefit with minimal risk and can be implemented in ~5 lines of code.

**Do NOT** use traditional LOD techniques (geometry simplification, THREE.LOD) - they're overkill for simple circles.

## The Bottleneck

After analyzing the current implementation:

- **266 chunk nodes** × 2 meshes each = **532 draw calls**
- **52,136 vertices total** (trivial for modern GPUs)
- **1.6 MB geometry memory** (negligible)

**Primary bottleneck**: Draw calls, not vertex count.

**Current waste**: When zoomed out (cameraZ > 10,000), chunks scale to 0 but are still processed by the GPU. Estimated waste: ~0.5-1ms per frame.

## Recommended Solution

### Immediate Action: Visibility Culling

Add visibility toggling to `src/lib/three/node-renderer.ts`:

```typescript
// In updateNodeScales() function:
const VISIBILITY_THRESHOLD = 0.01;

for (const cached of nodeCache.values()) {
  const { node, group } = cached;

  if (node.type === "chunk") {
    group.scale.setScalar(scales.chunkScale);
    group.visible = scales.chunkScale >= VISIBILITY_THRESHOLD; // NEW LINE
  }
}
```

**Benefits**:
- Skips rendering when chunks are < 1% of full size (effectively invisible)
- ~0.5-1ms performance gain per frame when zoomed out
- Zero visual impact (chunks already invisible at that scale)
- Trivial to implement and test

**Risks**: None (only affects invisible nodes)

### Future Consideration: Instanced Rendering

If you later find that draw calls are a bottleneck (via profiling):

- **Use THREE.InstancedMesh** to render all chunks in 2 draw calls instead of 532
- **Estimated savings**: 2-5ms per frame
- **Complexity**: Medium-High (requires refactoring)
- **Only implement if**: Profiling shows frame drops or GPU utilization issues

## Performance Context

Current rendering cost is **well within acceptable limits** for modern hardware:

- 52k vertices: Modern GPUs handle 10+ million easily
- 532 draw calls: Moderate, not terrible
- 1.6 MB memory: Trivial

**Before optimizing further, measure actual performance**:
1. Chrome DevTools → Performance
2. Record 10 seconds of graph interaction
3. Look for frame drops below 60fps

If performance is smooth, visibility culling is sufficient. Don't over-optimize.

## Why NOT Use Traditional LOD?

### ❌ THREE.LOD
- Overkill for simple circles
- High complexity for minimal benefit
- Requires multiple geometries per node

### ❌ Geometry Simplification
- Circles already low-poly (66 vertices)
- Doesn't reduce draw calls (the real bottleneck)
- Minimal performance gain (<0.1ms/frame)

### ✅ Visibility Culling
- Simple, safe, effective
- Addresses the actual waste (rendering invisible nodes)
- Can implement in minutes

## Implementation Checklist

- [ ] Add `VISIBILITY_THRESHOLD` constant to `node-renderer.ts`
- [ ] Modify `updateNodeScales()` to set `group.visible` for chunks
- [ ] Test in browser at different zoom levels
- [ ] Verify no visual regression (chunks should still fade in/out smoothly)
- [ ] Check performance logging in console (`[Chunk Perf]` messages)

## Files to Reference

- **Analysis**: `docs/investigations/chunk-lod-analysis.md` (detailed report)
- **Implementation Example**: `docs/investigations/chunk-lod-implementation-example.ts` (code samples)
- **Performance Script**: `scripts/analyze-three-performance.ts` (run with `npm run script`)
- **Code to Modify**: `src/lib/three/node-renderer.ts` (updateNodeScales function)

## Decision Matrix

| Approach | Complexity | Benefit | When to Use |
|----------|-----------|---------|-------------|
| Visibility Culling | Low | Medium | **Now** (quick win) |
| Instanced Rendering | High | High | If profiling shows draw call bottleneck |
| Geometry Simplification | Medium | Very Low | Never (wrong bottleneck) |
| THREE.LOD | High | Very Low | Never (overkill) |

## Conclusion

The user's intuition about LOD is correct - there's waste in rendering invisible nodes. However, the optimal solution is **simpler than traditional LOD**: just hide nodes when they're too small to see.

Implement visibility culling now (15 minutes). Measure performance. If still seeing issues, consider instanced rendering later.

**Remember**: Premature optimization is the root of all evil. The current implementation is "good enough" for 266 nodes. Visibility culling makes it "better" with minimal effort.
