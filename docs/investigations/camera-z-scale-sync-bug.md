# Camera Z-Scale Synchronization Bug: Keywords Disappear on Zoom Stop

## Issue Description

Keywords were only visible during active zoom operations. When zooming stopped, keywords would disappear and be replaced by chunk nodes becoming visible (snap-back effect). This was the opposite of the intended behavior:

- **Expected**: When zoomed out (camera Z=10500), keywords should be large and visible, chunks should be tiny/invisible
- **Expected**: When zoomed in (camera Z=50), keywords should be tiny/invisible, chunks should be large and visible
- **Actual**: Keywords appeared while actively zooming, then snapped to invisible when zoom gesture ended

## Root Causes

This bug had **two separate root causes** that compounded each other:

### 1. Delayed Camera Initialization

The camera position was being set in a 100ms delayed `setTimeout`, causing transient incorrect scales during initial render.

**Timeline of initial render:**
1. **Tick 1**: Renderer initializes, camera at default position Z=1000
   - `calculateScales(1000)` returns: `keywordScale=0.095`, `chunkScale=0.818`
   - Keywords become almost invisible (scale 0.095)
   - Chunks become mostly visible (scale 0.818)

2. **Tick 3** (after 100ms): Camera moved to intended position Z=10500
   - `calculateScales(10500)` returns: `keywordScale=1.000`, `chunkScale=0.000`
   - Keywords become fully visible
   - Chunks become invisible

**Console logs showing the bug:**
```
[Scale Init] tick: 1 cameraZ: 1000 hasChunks: true keywordScale: 0.095 chunkScale: 0.818
[Scale Init] tick: 3 cameraZ: 10500 hasChunks: true keywordScale: 1.000 chunkScale: 0.000
```

### 2. Mismatched Z-to-K Conversions (The Deeper Issue)

Even after fixing the initialization, keywords still snapped back to invisible when zoom gestures ended. This was caused by **inconsistent camera Z ↔ zoom scale conversions**.

**The problem:**
- During zoom gestures, the camera Z position changed continuously
- When the gesture ended, `onZoomEnd` callback fired with a zoom scale `k`
- TopicsView converted `k` back to camera Z: `setCameraZ(SOME_VALUE / k)`
- If the conversion math wasn't perfectly reversible, you'd get a mismatch
- This caused the "snap-back" where keyword/chunk visibility suddenly changed

**Example of the mismatch:**
```typescript
// During gesture: camera at Z=5000
// - Scales calculated: keywordScale=0.497, chunkScale=0.253
// - Both visible ✓

// Gesture ends:
// - onZoomEnd fires with k = (inconsistent formula) / 5000
// - TopicsView converts back: z = (different formula) / k
// - Result: z ≠ 5000 (mismatch!)
// - Scales recalculated with wrong Z value
// - Keywords snap to invisible, chunks snap to visible ❌
```

## The Complete Fix

### Part 1: Synchronous Camera Initialization

**File**: `src/lib/three/renderer.ts`

Moved camera setup to **immediately after** `graph.graphData()` is called (synchronously, no setTimeout):

```typescript
// Set initial data (this starts the simulation and creates the camera)
graph.graphData({ nodes: currentNodes as any, links: currentLinks as any });

// Camera Setup (IMMEDIATELY after graph initialization)
const camera = graph.camera() as THREE.PerspectiveCamera;
if (camera) {
  camera.fov = CAMERA_FOV_DEGREES;
  camera.updateProjectionMatrix();
  camera.position.set(0, 0, 10500);  // Synchronous, no setTimeout
  camera.lookAt(0, 0, 0);
}
```

**Why this works**: The camera doesn't exist until `graphData()` is called. By setting the position immediately after (synchronously), the first render tick uses the correct camera Z=10500.

### Part 2: Consistent Z-to-K Conversion Math

**Files**:
- `src/lib/three/camera-controller.ts`
- `src/components/TopicsView.tsx`

Added `CAMERA_Z_SCALE_BASE = 500` as the single source of truth for Z ↔ K conversions:

**camera-controller.ts (lines 11-12, 118-119):**
```typescript
/** Base value used to convert perspective camera Z to a pseudo-zoom scale (k = BASE / z) */
export const CAMERA_Z_SCALE_BASE = 500;

// In notifyZoomChange():
function notifyZoomChange(): void {
  if (onZoomEnd) {
    const camera = getCamera();
    if (camera) {
      const k = CAMERA_Z_SCALE_BASE / camera.position.z;  // Z → K
      onZoomEnd({ k, x: camera.position.x, y: camera.position.y });
    }
  }
}
```

**TopicsView.tsx (lines 118-120):**
```typescript
const handleZoomChange = useStableCallback((zoomScale: number) => {
  if (rendererType === "three" && Number.isFinite(zoomScale) && zoomScale > 0) {
    setCameraZ(CAMERA_Z_SCALE_BASE / zoomScale);  // K → Z (inverse)
  }
  onZoomChange?.(zoomScale);
});
```

**Why this works**:
- Forward conversion: `k = BASE / z`
- Inverse conversion: `z = BASE / k`
- Both use the same `BASE = 500`, so the math is perfectly reversible
- No more mismatch, no more snap-back!

**Mathematical proof:**
```
z₁ = 5000                           (initial camera Z)
k = 500 / 5000 = 0.1               (convert to zoom scale)
z₂ = 500 / 0.1 = 5000              (convert back)
z₂ === z₁ ✓                         (perfect round-trip!)
```

## Impact

**Before the fix:**
- Flashing incorrect visibility states during initial load
- Snap-back effect when zoom gestures ended
- Unpredictable keyword/chunk visibility

**After the fix:**
- Camera starts at Z=10500 from the first frame
- Initial scales: `keywordScale=1.0`, `chunkScale=0.0` ✓
- Keywords large and visible when zoomed out ✓
- Chunks invisible when zoomed out ✓
- Smooth, stable transitions during zoom gestures ✓
- No snap-back when zoom gesture ends ✓
- Scales remain consistent throughout the entire zoom lifecycle ✓

## Related Configuration

Chunk transition range (from `chunk-zoom-config.ts`):
- `MIN_Z = 50` (close, zoomed in)
- `MAX_Z = 10000` (far, zoomed out)
- Initial camera position: Z=10500 (above MAX_Z, ensuring keywords are fully visible)
- Z-to-K base: 500 (ensures reversible conversions)

Scale calculation (from `chunk-scale.ts`):
- `t = (cameraZ - MIN_Z) / (MAX_Z - MIN_Z)` clamped to [0, 1]
- `keywordScale = t` (1.0 when far, 0.0 when close)
- `chunkScale = (1-t)²` (0.0 when far, 1.0 when close)

## Lessons Learned

1. **Asynchronous initialization is dangerous**: Delayed setup (setTimeout) creates transient incorrect states
2. **Round-trip conversions must be mathematically reversible**: Z → K → Z should equal the original Z
3. **Shared constants prevent drift**: `CAMERA_Z_SCALE_BASE` ensures all conversions use the same math
4. **Test the full lifecycle**: The bug only manifested when zoom gestures **ended**, not during the gesture itself
