# Design: Zoom-Dependent Chunk Node Shape Morphing

**Date**: 2026-02-18
**Branch**: reader
**Status**: Approved

## Problem

Chunk nodes in ChunksView are always rendered as rounded rectangles regardless of zoom level. Zoomed out, they appear as small blobs. The goal is to make them feel like circles when small/far, and reveal their card shape as the user zooms in — matching the natural reading experience.

## Decision

Use a custom GLSL `ShaderMaterial` with a 2D rounded-rectangle SDF to analytically define the node shape. A single `u_cornerRatio` uniform, updated each frame from camera Z, continuously morphs corner radius from `1.0` (capsule/circle-like at far zoom) to `0.08` (current rectangular shape at near zoom). This replaces the static `ShapeGeometry` approach.

## Approach Considered and Rejected

| Approach | Why Rejected |
|---|---|
| Throttled geometry regeneration | Allocates/GCs geometry objects; discrete steps not truly continuous |
| Three.js morph targets | Same vertex count required for both shapes — hard with variable-tesselation ShapeGeometry |

## Design

### Geometry Change

Replace `createCardGeometry()` (bezier `ShapeGeometry`) with `createCardPlaneGeometry()` returning `new THREE.PlaneGeometry(CARD_WIDTH, CARD_HEIGHT)`. A simple quad with clean `[0,1]×[0,1]` UVs. The visible shape boundary is now defined by the SDF, not the geometry mesh.

### Shader (`src/lib/chunks-shader.ts`)

**Vertex shader**: Handles instanced transforms via `instanceMatrix` (injected by Three.js renderer for InstancedMesh). Passes `uv` and `instanceColor` to fragment as varyings.

**Fragment shader**:

```glsl
float roundedBoxSDF(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  // Card-local coords: p in [-15,15] x [-10,10]
  vec2 p = (vUv - 0.5) * vec2(30.0, 20.0);

  // Corner radius: 0.08*10=0.8 (rect) → 1.0*10=10 (capsule)
  float r = u_cornerRatio * 10.0;

  float sdf = roundedBoxSDF(p, vec2(15.0, 10.0), r);
  float alpha = 1.0 - smoothstep(0.0, fwidth(sdf) * 2.0, sdf);
  if (alpha < 0.001) discard;

  gl_FragColor = vec4(vColor, alpha);
}
```

Material settings: `transparent: true, depthWrite: false`.

### Zoom → cornerRatio Mapping

In `ChunksScene.tsx` `useFrame`, where `camZ` is already read:

```ts
const t = normalizeZoom(camZ, { near: 800, far: 3000 });
const cornerRatio = 0.08 + t * (1.0 - 0.08); // lerp rect→circle as zoom increases
materialRef.current.uniforms.u_cornerRatio.value = cornerRatio;
```

- `z ≥ 3000`: `t = 1`, `cornerRatio = 1.0` → capsule/circle look
- `z ≤ 800`: `t = 0`, `cornerRatio = 0.08` → current rectangle

Thresholds are initial estimates (z≈800 → card ~30px tall on 1080p); expect minor tuning.

### Hook Change (`useInstancedMeshMaterial.ts`)

Swap `new THREE.MeshBasicMaterial(...)` for `createChunkShaderMaterial()`. Return type changes to `ShaderMaterial`. `materialRef` is already returned and accessible in ChunksScene for uniform updates.

## Files

| File | Change |
|---|---|
| `src/lib/chunks-geometry.ts` | Add `createCardPlaneGeometry()` |
| `src/lib/chunks-shader.ts` | **New** — vertex/fragment shader strings + `createChunkShaderMaterial()` |
| `src/hooks/useInstancedMeshMaterial.ts` | Use `createChunkShaderMaterial()` instead of `MeshBasicMaterial` |
| `src/components/chunks-r3f/ChunksScene.tsx` | Use plane geometry; destructure `materialRef`; update `u_cornerRatio` in `useFrame` |

## Tuning Notes

- Morph range `{ near: 800, far: 3000 }` may need adjustment based on actual canvas size and DPR
- If anti-aliasing looks rough, try `fwidth(sdf) * 1.5` or `fwidth(sdf) * 2.0`
- The "circle" end state is a stadium/capsule (rounded rect with `r = min(halfWidth, halfHeight)`), not a true circle — at the scale where nodes appear as dots this is visually indistinguishable
