# Chunk Node SDF Shape Morph Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make chunk node shape zoom-dependent — circles when far, smooth morph to rectangles when zoomed in enough to read text.

**Architecture:** Replace the static `ShapeGeometry` (bezier rounded rect) with a `PlaneGeometry` + custom `ShaderMaterial`. A 2D rounded-rectangle SDF in the fragment shader defines the visible shape. A single `u_cornerRatio` uniform, updated each frame from camera Z, morphs corners from `1.0` (capsule/circle-like at far zoom) to `0.08` (current rectangle at near zoom). Per-instance color uses the existing `instanceColor` mechanism, which Three.js exposes to custom shaders via `#ifdef USE_INSTANCING_COLOR`.

**Tech Stack:** Three.js ShaderMaterial, GLSL SDF, React Three Fiber, TypeScript

---

### Task 1: Add `createCardPlaneGeometry` to `chunks-geometry.ts`

**Files:**
- Modify: `src/lib/chunks-geometry.ts`

**Step 1: Add the new export**

In `src/lib/chunks-geometry.ts`, add after the existing `createCardGeometry` function:

```typescript
/**
 * Create a plain rectangle PlaneGeometry for chunk cards.
 * Used with a ShaderMaterial that defines the visible shape via SDF.
 */
export function createCardPlaneGeometry(): THREE.PlaneGeometry {
  return new THREE.PlaneGeometry(CARD_WIDTH, CARD_HEIGHT);
}
```

**Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/lib/chunks-geometry.ts
git commit -m "feat: add createCardPlaneGeometry for SDF shader approach"
```

---

### Task 2: Create `chunks-shader.ts` with the SDF material

**Files:**
- Create: `src/lib/chunks-shader.ts`

**Step 1: Create the file**

```typescript
/**
 * Custom ShaderMaterial for chunk cards with zoom-dependent shape morphing.
 *
 * Uses a 2D rounded-rectangle SDF to define the visible shape.
 * u_cornerRatio uniform morphs corners:
 *   1.0 → capsule/circle (zoomed out)
 *   0.08 → rectangle (zoomed in, text readable)
 *
 * Handles instanceColor automatically via Three.js USE_INSTANCING_COLOR.
 */

import * as THREE from "three";

const CHUNK_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;

  void main() {
    vUv = uv;

    #ifdef USE_INSTANCING_COLOR
      vColor = instanceColor;
    #else
      vColor = vec3(1.0);
    #endif

    vec4 localPos = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * localPos;
    #else
      gl_Position = projectionMatrix * modelViewMatrix * localPos;
    #endif
  }
`;

// Card dimensions matching CARD_WIDTH=30, CARD_HEIGHT=20 from chunks-geometry.ts.
// Baked into the shader as constants — change both together if card size changes.
const CHUNK_FRAGMENT_SHADER = /* glsl */ `
  uniform float u_cornerRatio;

  varying vec2 vUv;
  varying vec3 vColor;

  float roundedBoxSDF(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;
  }

  void main() {
    // Map UV [0,1] → card local coords: x in [-15,15], y in [-10,10]
    vec2 p = (vUv - 0.5) * vec2(30.0, 20.0);

    // Corner radius in world units.
    // min(halfWidth, halfHeight) = 10.0.
    // At ratio=1.0: r=10 → capsule/stadium shape (looks circular when small).
    // At ratio=0.08: r=0.8 → near-rectangle (matches previous ShapeGeometry).
    float r = u_cornerRatio * 10.0;

    float sdf = roundedBoxSDF(p, vec2(15.0, 10.0), r);

    // Anti-aliased edge. fwidth() requires GL_OES_standard_derivatives (enabled via extensions).
    float edge = fwidth(sdf) * 2.0;
    float alpha = 1.0 - smoothstep(-edge, edge, sdf);
    if (alpha < 0.001) discard;

    gl_FragColor = vec4(vColor, alpha);
  }
`;

export function createChunkShaderMaterial(): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      u_cornerRatio: { value: 1.0 },
    },
    vertexShader: CHUNK_VERTEX_SHADER,
    fragmentShader: CHUNK_FRAGMENT_SHADER,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    extensions: {
      derivatives: true, // enables GL_OES_standard_derivatives for fwidth()
    },
  });
  material.toneMapped = false;
  return material;
}
```

**Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/lib/chunks-shader.ts
git commit -m "feat: add chunks SDF shader material with u_cornerRatio uniform"
```

---

### Task 3: Update `useInstancedMeshMaterial` to use the shader

**Files:**
- Modify: `src/hooks/useInstancedMeshMaterial.ts`

**Step 1: Apply changes**

Replace the entire file:

```typescript
/**
 * Hook to initialize instanceColor and material for an instancedMesh.
 * Ensures vertex colors work by creating the material after instanceColor exists.
 */

import { useRef, useCallback } from "react";
import * as THREE from "three";
import { createChunkShaderMaterial } from "@/lib/chunks-shader";

export function useInstancedMeshMaterial(instanceCount: number) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  // Store instanceCount in a ref so the callback doesn't need to change identity
  const instanceCountRef = useRef(instanceCount);
  instanceCountRef.current = instanceCount;

  // Stable callback ref — never changes identity, so R3F won't
  // trigger the cleanup/setup cycle on every parent re-render.
  const handleMeshRef = useCallback((mesh: THREE.InstancedMesh | null) => {
    meshRef.current = mesh;

    if (mesh && !mesh.instanceColor) {
      const count = instanceCountRef.current;
      // FIRST: Create instanceColor attribute with default white color
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        colors[i * 3] = 1; // R
        colors[i * 3 + 1] = 1; // G
        colors[i * 3 + 2] = 1; // B
      }
      mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
      mesh.instanceColor.needsUpdate = true;

      // SECOND: Create and attach material AFTER instanceColor exists
      // This ensures the shader compiles with USE_INSTANCING_COLOR defined.

      // Dispose old material if it exists
      if (mesh.material) {
        (mesh.material as THREE.Material).dispose();
      }

      const material = createChunkShaderMaterial();
      mesh.material = material;
      materialRef.current = material;

      // CRITICAL: Force shader recompilation to include instanceColor support
      material.needsUpdate = true;
    }
  }, []);

  return { meshRef, materialRef, handleMeshRef };
}
```

**Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/hooks/useInstancedMeshMaterial.ts
git commit -m "feat: use SDF ShaderMaterial in useInstancedMeshMaterial"
```

---

### Task 4: Wire up in `ChunksScene.tsx`

**Files:**
- Modify: `src/components/chunks-r3f/ChunksScene.tsx`

Four changes needed in this file.

**Step 1: Update the geometry import and add `normalizeZoom` import**

In the import block at the top, make these two changes:

Change the `chunks-geometry` import (line 26):
```typescript
// Before:
import { CARD_WIDTH, CARD_HEIGHT, CARD_SCALE, createCardGeometry } from "@/lib/chunks-geometry";
// After:
import { CARD_WIDTH, CARD_HEIGHT, CARD_SCALE, createCardPlaneGeometry } from "@/lib/chunks-geometry";
```

Add `normalizeZoom` and `ZoomRange` to the existing `zoom-phase-config` import (line 34):
```typescript
// Before:
import { calculateZoomDesaturation } from "@/lib/zoom-phase-config";
// After:
import { calculateZoomDesaturation, normalizeZoom, type ZoomRange } from "@/lib/zoom-phase-config";
```

**Step 2: Add shape morph constants near the other Z constants (~line 46)**

Add after the `DESAT_NEAR_Z` line:
```typescript
/** Camera Z range for node shape morph: circle (far) → rectangle (near). */
const SHAPE_MORPH_RANGE: ZoomRange = { near: 800, far: 3000 };
```

**Step 3: Destructure `materialRef` from the hook and switch to plane geometry (~line 134)**

```typescript
// Before:
const { meshRef, handleMeshRef } = useInstancedMeshMaterial(stableCount);
// ...
const geometry = useMemo(createCardGeometry, []);

// After:
const { meshRef, materialRef, handleMeshRef } = useInstancedMeshMaterial(stableCount);
// ...
const geometry = useMemo(createCardPlaneGeometry, []);
```

**Step 4: Add uniform update in `useFrame` after camZ is read (~line 657)**

The existing code already reads `camZ` at line 657:
```typescript
const camZ = camera.position.z;
const fovRad = THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov);
```

Add immediately after those two lines:
```typescript
// Shape morph: circle when far, rectangle when near enough to read text
if (materialRef.current) {
  const t = normalizeZoom(camZ, SHAPE_MORPH_RANGE); // 0=near(rect), 1=far(circle)
  materialRef.current.uniforms.u_cornerRatio.value = 0.08 + t * (1.0 - 0.08);
}
```

**Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 6: Visual verification**

Open ChunksView in the browser. Zoom from far to near. Expected:
- Far (default start, z≈6000): nodes appear as circular blobs
- Mid zoom (z≈3000): corners begin to sharpen
- Near (z≈800): fully rectangular cards

If the transition feels too early or too late, adjust `SHAPE_MORPH_RANGE` constants:
- Move `far` higher (e.g. 4000) to start morphing from farther away
- Move `near` lower (e.g. 600) to complete the rectangle later (closer in)

**Step 7: Commit**

```bash
git add src/components/chunks-r3f/ChunksScene.tsx
git commit -m "feat: zoom-dependent chunk node shape morph via SDF u_cornerRatio"
```

---

## Tuning Reference

| Symptom | Fix |
|---|---|
| Jagged edges | Increase `fwidth(sdf) * 2.0` multiplier (try 3.0) |
| Soft/blurry edges | Decrease multiplier (try 1.5) |
| Morph starts too early | Increase `SHAPE_MORPH_RANGE.far` |
| Cards never become circular | Decrease `SHAPE_MORPH_RANGE.near` |
| Invisible nodes | Check `depthTest`/`depthWrite` — try `depthTest: false` |
| Colors wrong/missing | Verify `mesh.instanceColor` exists before material creation (hook ordering) |
