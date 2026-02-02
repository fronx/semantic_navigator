# ADR 012: WebGL Memory Leak Fix

**Status:** Accepted
**Date:** 2026-02-02

## Context

The Topics view uses `3d-force-graph` for WebGL-based graph rendering. Users reported that the browser would become unresponsive after extended use, with memory growing from normal levels (< 100 MB) to 2-6 GB.

## Problem

Investigation revealed two issues:

### 1. WebGL Context Not Released

The `3d-force-graph` library's `_destructor()` method only:
- Pauses animation
- Clears graph data

It does **NOT**:
- Call `renderer.dispose()` to release WebGL resources
- Call `renderer.forceContextLoss()` to release the WebGL context
- Dispose scene objects (geometries, materials)

This caused:
- WebGL contexts to accumulate (browsers limit these to ~8-16)
- GPU memory to grow unbounded
- Eventually: "Could not create a WebGL context" errors
- Browser unresponsiveness

### 2. Callbacks Running After Destroy

Several callbacks could fire after the renderer was destroyed:
- `animateCamera()` using recursive `requestAnimationFrame` without tracking
- `setTimeout` calls for `fitToNodesInternal` not checking if destroyed
- No cancellation of pending animation frames

## Solution

### WebGL Cleanup (three-renderer.ts)

Added proper disposal in `destroy()`:

```typescript
// Get the Three.js WebGLRenderer
const renderer = graph.renderer();
if (renderer) {
  renderer.dispose();           // Release WebGL resources
  renderer.forceContextLoss();  // Release WebGL context immediately
}

// Dispose all scene objects
const scene = graph.scene();
if (scene) {
  scene.traverse((object) => {
    if (object.geometry) object.geometry.dispose();
    if (object.material) {
      if (Array.isArray(object.material)) {
        object.material.forEach((mat) => mat.dispose());
      } else {
        object.material.dispose();
      }
    }
  });
  scene.clear();
}
```

### Callback Safety

1. Added `destroyed` flag checked by all callbacks
2. Track `cameraAnimationFrameId` and cancel on cleanup
3. Guard `setTimeout` callbacks: `setTimeout(() => { if (!destroyed) ... }, 0)`

### Error Handling

Added try-catch around `createThreeRenderer()` to gracefully handle WebGL unavailability.

## Testing

Added Playwright-based memory leak tests (`tests/e2e/memory-leak.spec.ts`):
- Intensive zoom/pan interactions
- Hover interactions
- Repeated renderer creation/destruction (stress test)
- Heap snapshot comparison

Run with:
```bash
npm run dev  # In one terminal
npx playwright test tests/e2e/memory-leak.spec.ts  # In another
```

## Lessons Learned

1. **JS heap !== GPU memory**: The Playwright tests measured JS heap, which looked fine. The actual leak was in GPU memory (WebGL contexts, textures, buffers).

2. **Library destructors may be incomplete**: Always verify that third-party libraries properly clean up GPU resources. The `3d-force-graph` library's `_destructor` was misleadingly named.

3. **WebGL contexts are limited**: Browsers only allow ~8-16 WebGL contexts total. Failing to release them causes "context could not be created" errors.

4. **Call `forceContextLoss()`**: `renderer.dispose()` alone may not immediately release the context. `forceContextLoss()` ensures immediate release.

## References

- [Three.js disposal guide](https://threejs.org/docs/#manual/en/introduction/How-to-dispose-of-objects)
- [WebGL context limits](https://webglreport.com/)
- Commit: `1a4e01f` - Fix WebGL memory leak causing browser unresponsiveness
