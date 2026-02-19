# Chunk Text Depth Precision Bug

**Date:** 2026-02-19
**Status:** Resolved
**Follows:** [Chunk Card Occlusion](chunk-card-occlusion-2026-02-17.md)

## Problem

After the z-ordering fix (cards at `z = i * step`, text at `z = i * step + step/2`), text was still occasionally invisible at certain camera positions — particularly on nodes near the viewport periphery. A tiny zoom increment would make the text appear. The bug was intermittent and camera-position-dependent.

## Root Cause: Linear Depth Buffer Precision

Standard WebGL depth buffers store depth values linearly in NDC space. The usable precision at distance `d` from camera with near=`n`, far=`f` is approximately:

```
ε ≈ (f / (f - n)) × (n / d) × 2⁻²⁴   (world units)
```

For our camera (near=1, far=100000) this simplifies to:

```
ε ≈ d² × 5.96e-8  (world units per bit)
```

The z-ordering scheme gives each card a z-separation of `cardZStep = CARD_Z_RANGE / count`. Card face and its text are separated by `cardZStep / 2`. With ~1000 cards and `CARD_Z_RANGE = 20`, that is `step/2 = 0.01` world units.

The depth precision at various viewing distances:

| Camera z | ε (precision) | step/2 | Resolvable? |
|----------|--------------|--------|-------------|
| 250      | 0.0037 wu    | 0.01   | Yes (2.7×)  |
| 500      | 0.0149 wu    | 0.01   | Borderline  |
| 1000     | 0.0596 wu    | 0.01   | **No** (6× too coarse) |

At camera z≈500 and above, the GPU cannot reliably distinguish 0.01-unit depth differences — the two fragments land in the same depth bucket and whichever is drawn last wins (GPU-order-dependent, hence camera-position-dependent flicker).

### Why peripheral nodes fail first

Peripheral nodes are viewed at an angle. Because they are off-axis, their world-space z separation maps to a *smaller* NDC depth difference than the same separation on an on-axis node. This tightens the effective precision budget further, so peripheral nodes hit the precision floor at lower camera distances than central nodes.

### Why a zoom wiggle appeared to fix it

Zooming changes `camera.z`. At a slightly different camera distance the depth bucket boundaries shift, changing which of the two fragments wins the depth test. The text happens to win at the new position, making it visible — until the camera moves again.

## Failed Approaches

### depthTest: false on text material
Removing depth testing lets text always render on top regardless of card ordering. Rejected: text from cards behind a foreground card bleeds through — z-ordering provides no occlusion.

### Larger polygonOffset on card material
`polygonOffset` biases the card's depth slightly farther away, giving text more margin to pass the LEQUAL test. `polygonOffsetFactor=0, polygonOffsetUnits=4` helps on-axis (flat) cards but provides no benefit for peripheral cards viewed at an angle, where the slope term (`factor`) dominates.

### Adaptive near/far planes (per-frame)
Shrink near/far to tightly bracket scene content (near = `camZ - 75`, far = `camZ + 10`). This concentrates depth buffer bits where they are needed and dramatically improves precision. However, calling `camera.updateProjectionMatrix()` every frame caused a significant performance regression — Three.js invalidates frustum cull state each time the matrix changes, triggering expensive per-object visibility checks.

## Solution: Logarithmic Depth Buffer

Logarithmic depth buffers distribute precision proportional to `log(depth)` rather than linearly. Near geometry gets exponentially more bits; far geometry gets fewer. For a frustum from near=1 to far=100000, the precision at any distance is approximately:

```
ε_log ≈ 1 / (2²⁴ × log(far/near)) × z   ≈ z × 8.4e-9
```

At camera z=1000 this is `0.0000084` world units — over 3000× better than the linear buffer's `0.0596`. The 0.01-unit card-to-text gap is easily resolved at any camera distance in our range.

**Cost:** Zero per-frame work. The log remapping is a one-time renderer configuration; it affects how `gl_Position.w` is written to the depth buffer, with no impact on CPU frame loop overhead.

## Implementation

### Three files changed

**`ChunksCanvas.tsx`** — enable on the WebGL renderer:
```typescript
gl={{ antialias: true, alpha: false, logarithmicDepthBuffer: true }}
```

**`chunks-shader.ts`** — custom `ShaderMaterial` must opt into log depth explicitly. Three.js handles this automatically for built-in materials (`MeshBasicMaterial`, `MeshStandardMaterial`, etc.) but custom shaders must include the shader chunks:

```glsl
// Vertex shader — declarations section (before main):
#include <common>               // provides isPerspectiveMatrix()
#include <logdepthbuf_pars_vertex>

// Vertex shader — end of main():
#include <logdepthbuf_vertex>   // writes vFragDepth varying

// Fragment shader — declarations section (before main):
#include <logdepthbuf_pars_fragment>

// Fragment shader — beginning of main():
#include <logdepthbuf_fragment>  // remaps gl_FragDepth
```

`<common>` is required because `logdepthbuf_vertex` calls `isPerspectiveMatrix(projectionMatrix)`, which is defined in `<common>`. Standard Three.js shaders always include `<common>` but custom shaders must add it explicitly.

**`ChunksScene.tsx`** — removed the adaptive near/far per-frame code that had been added as an intermediate fix:
```typescript
// Removed: pCam.near = ...; pCam.far = ...; pCam.updateProjectionMatrix();
```

### Retained from prior work

`CardTextLabels.tsx` keeps `renderOrder={1}` on the text mesh (added in the [Chunk Card Occlusion](chunk-card-occlusion-2026-02-17.md) fix). This ensures text renders in a separate pass after the card `InstancedMesh` (renderOrder=0), so the depth buffer already contains correct card depths when text depth-testing happens. This is complementary to the log depth buffer: log depth fixes precision; renderOrder fixes sort order for transparent instanced geometry.

The `polygonOffset` on the card material (`factor=0, units=4`) is retained as a small additional margin for the flat (on-axis) card case.

## What Was Not Changed

Cluster labels (`ClusterLabels3D`, `GraphTextLabel`) use `depthTest: false` intentionally — they should always be visible regardless of scene geometry. This is a separate design decision unrelated to depth precision.
