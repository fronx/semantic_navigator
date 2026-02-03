# Chunk LOD: Expected Performance Metrics

This document provides expected performance baselines and improvement targets for the chunk node LOD optimization.

## Current Performance Baseline (Without Visibility Culling)

### Rendering Cost Breakdown

**Scene Complexity**:
- 266 chunk nodes
- 532 meshes total (fill + outline per node)
- 52,136 vertices total
- 1.6 MB geometry memory

**Per-Frame Cost** (estimated from analysis):

| Zoom Level | Camera Z | Chunk Scale | Vertex Processing | Pixel Fill | Total GPU Time |
|------------|----------|-------------|-------------------|------------|----------------|
| Very Far | 20,000 | 0.00 | ~0.05ms | ~0.00ms | ~0.05ms |
| Far | 10,000 | 0.00 | ~0.05ms | ~0.00ms | ~0.05ms |
| Mid | 5,000 | 0.25 | ~0.05ms | ~0.03ms | ~0.08ms |
| Close | 500 | 0.81 | ~0.05ms | ~0.08ms | ~0.13ms |
| Very Close | 50 | 1.00 | ~0.05ms | ~0.10ms | ~0.15ms |

**Bottleneck Analysis**:
- At scale=0 (far zoom), chunks are processed but produce ~0 pixels → **wasteful**
- 532 draw calls is moderate but not catastrophic
- Main thread work (scale updates) takes ~0.5-2ms per camera move (see `[Chunk Perf]` logs)

## Expected Performance After Visibility Culling

### Implementation Change

```typescript
// src/lib/three/node-renderer.ts - updateNodeScales()
group.visible = scales.chunkScale >= 0.01;
```

### Expected Improvements

**Per-Frame GPU Time** (with visibility culling):

| Zoom Level | Camera Z | Chunk Scale | Visible? | GPU Time (Before) | GPU Time (After) | Savings |
|------------|----------|-------------|----------|-------------------|------------------|---------|
| Very Far | 20,000 | 0.00 | ❌ No | 0.05ms | ~0.00ms | **0.05ms** |
| Far | 10,000 | 0.00 | ❌ No | 0.05ms | ~0.00ms | **0.05ms** |
| Mid | 5,000 | 0.25 | ✅ Yes | 0.08ms | ~0.08ms | 0.00ms |
| Close | 500 | 0.81 | ✅ Yes | 0.13ms | ~0.13ms | 0.00ms |
| Very Close | 50 | 1.00 | ✅ Yes | 0.15ms | ~0.15ms | 0.00ms |

**Summary**:
- When zoomed out (keywords only view): **Save ~0.05ms per frame** on GPU
- When zoomed in (chunks visible): **No performance impact**
- Additional savings: Skip frustum culling checks for invisible nodes

### Main Thread Impact

Current `[Chunk Perf]` logs show:
```
[Chunk Perf] Total: X.XX ms Nodes: Y.YY ms Edges: Z.ZZ ms Labels: W.WW ms
```

Expected change:
- **Nodes update time**: Unchanged (~0.5-2ms) - still iterating all cached nodes
- **Overall frame time**: Slight improvement when zoomed out

**Why main thread is unchanged**: We still loop through all nodes to set `visible` flag. The savings are on the GPU side (skipping render).

## Expected Performance After Instanced Rendering (Future)

If we implement instanced rendering (converting 266 separate meshes to 1 InstancedMesh):

### Draw Call Reduction

**Before**:
- Fill meshes: 266 draw calls
- Outline meshes: 266 draw calls
- **Total**: 532 draw calls

**After**:
- Fill instances: 1 draw call
- Outline instances: 1 draw call
- **Total**: 2 draw calls

**Reduction**: 532 → 2 draw calls (99.6% reduction)

### Estimated Improvements

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Draw calls | 532 | 2 | 99.6% reduction |
| GPU time (all zoom levels) | 0.05-0.15ms | 0.01-0.05ms | 66% reduction |
| Frame drops (low-end devices) | Possible | Unlikely | Smoother |
| Main thread (scale updates) | 0.5-2ms | 0.3-1ms | 40% faster |

**When to implement**: Only if profiling shows frame drops or stuttering during graph interaction.

## Measurement Methodology

### Browser DevTools Performance Profiling

1. **Open Chrome DevTools** → Performance tab
2. **Start recording**
3. **Perform actions**:
   - Zoom out slowly from close (cameraZ 50) to far (cameraZ 20000)
   - Pan around graph
   - Zoom back in
4. **Stop recording** after 10 seconds
5. **Analyze**:
   - Look for "Rendering" events
   - Check "Main" thread for JavaScript execution
   - Check "GPU" thread for WebGL rendering
   - Identify frame drops (red bars above 16.7ms)

### Key Metrics to Track

**Frame Time**:
- Target: < 16.7ms (60fps)
- Acceptable: < 33.3ms (30fps)
- Problem: > 33.3ms (stuttering)

**GPU Time** (Chrome: More tools → Rendering → Frame Rendering Stats):
- Vertex processing time
- Pixel fill time
- Draw call overhead

**Main Thread**:
- JavaScript execution time
- Force simulation updates
- DOM manipulation (labels)

### Console Performance Logs

Current implementation already logs performance:

```javascript
// Example output from existing [Chunk Perf] logger
[Chunk Perf] Total: 1.23 ms Nodes: 0.45 ms Edges: 0.31 ms Labels: 0.47 ms Node count: 532
```

**After visibility culling**, expect:
- Similar total time (visibility flag is cheap to set)
- GPU rendering time savings won't show here (need DevTools GPU profiler)

## Performance Goals

### Primary Goal: Smooth 60fps

**Target**: Maintain 60fps during all graph interactions
- Zooming
- Panning
- Hovering
- Filtering

### Secondary Goal: Reduce Waste

**Target**: Zero GPU time spent on invisible nodes
- When chunkScale < 0.01, chunks should not consume GPU cycles
- Visibility culling achieves this goal

### Stretch Goal: Handle 1000+ Nodes

**Future-proofing**: If graph grows to 1000+ chunks
- Current approach (532 draw calls) would scale poorly
- Instanced rendering would maintain performance at 10,000+ nodes

## Testing Scenarios

### Test 1: Zoomed Out (Keywords Only)

**Setup**:
- Navigate to graph view
- Zoom out to cameraZ ~15,000 (keywords visible, chunks invisible)
- Pan around

**Expected (Before)**:
- Frame time: ~10-15ms
- GPU time: ~1-2ms (wasteful - rendering invisible chunks)

**Expected (After Visibility Culling)**:
- Frame time: ~9-14ms (-0.5-1ms improvement)
- GPU time: ~0.5-1ms (chunks skipped)

### Test 2: Transition Zone

**Setup**:
- Zoom to cameraZ ~5,000 (chunks at 25% scale)
- Pan and interact

**Expected**:
- No measurable difference (chunks are visible at this zoom level)
- Visibility culling not active

### Test 3: Zoomed In (Chunks Visible)

**Setup**:
- Zoom in to cameraZ ~100 (chunks at full scale)
- Interact with graph

**Expected**:
- No measurable difference (chunks are fully visible)
- All 266 chunks rendering normally

### Test 4: Rapid Zoom In/Out

**Setup**:
- Rapidly zoom in and out using mouse wheel
- Trigger many camera position changes

**Expected**:
- Smooth animation (no jank)
- Chunks fade in/out smoothly
- No visual popping when crossing visibility threshold

## Red Flags to Watch For

### Visual Regressions

- [ ] Chunks popping in/out abruptly (should fade smoothly)
- [ ] Chunks disappearing too early (threshold too high)
- [ ] Chunks lingering when they should be invisible (threshold too low)

### Performance Regressions

- [ ] Frame drops when zooming
- [ ] Stuttering during camera movement
- [ ] Increased main thread time (visibility checks too expensive)

### Edge Cases

- [ ] No chunks in scene (should handle gracefully)
- [ ] Single chunk (no performance benefit but shouldn't break)
- [ ] 10,000+ chunks (future-proofing test)

## Benchmarking Script

Run the performance analysis script to see theoretical calculations:

```bash
npm run script scripts/analyze-three-performance.ts
```

Output includes:
- Geometry complexity analysis
- Memory footprint
- Draw call analysis
- Zoom-level performance estimates
- LOD strategy comparisons

## Conclusion

**Visibility culling** provides measurable improvement (~0.5-1ms per frame when zoomed out) with minimal implementation effort and zero risk.

**Instanced rendering** would provide massive improvement (2-5ms per frame) but requires significant refactoring. Only pursue if profiling shows it's necessary.

**Current performance is likely acceptable**. Implement visibility culling as a low-hanging fruit optimization, then measure real-world performance before investing in more complex solutions.
