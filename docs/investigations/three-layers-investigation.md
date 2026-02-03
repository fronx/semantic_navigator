# Three.js Layers Investigation: Why Layer-Based Rendering Failed

**Date:** 2026-02-03
**Context:** Attempted to implement Gaussian blur for keyword nodes using Three.js layer system

## Summary

We attempted to implement a frosted glass blur effect for keyword nodes by using Three.js's layer system to selectively render different node types (keywords, chunks, panel). This approach fundamentally broke hover detection and rendering because it conflicted with 3d-force-graph's raycasting system.

## What We Tried

### Goal
Create a blur effect where:
- Keyword nodes appear blurred behind a frosted glass panel when zoomed in
- Chunk nodes render sharp and in front, above the blur layer
- Users can focus on chunks while keywords fade into the background

### Implementation Approach
1. **Created blur-composer.ts**: Implemented Gaussian blur using:
   - Separable blur (horizontal + vertical passes) for O(2n) complexity
   - Three.js render targets for multi-pass rendering
   - Custom fragment shaders with 5-tap Gaussian kernel
   - MeshPhysicalMaterial panel with transmission for frosted glass effect

2. **Assigned nodes to layers**:
   ```typescript
   export const KEYWORD_LAYER = 2;
   export const CHUNK_LAYER = 3;
   export const PANEL_LAYER = 4;

   // In node-renderer.ts:
   const layerId = node.type === "chunk" ? CHUNK_LAYER : KEYWORD_LAYER;
   group.layers.set(layerId);
   ```

3. **Intercepted renderer.render()**: Replaced the main render call with a custom pipeline:
   - Render keywords to texture (layer 2)
   - Apply horizontal blur pass
   - Apply vertical blur pass
   - Render blurred result as background
   - Render frosted glass panel (layer 4)
   - Render chunks on top (layer 3)

## Why It Failed

### The Core Problem: Three.js Raycasting with Layers

Three.js raycasting (used for hover detection) requires objects to be visible to BOTH the camera AND the raycaster:

```typescript
// Three.js raycasting intersection logic:
(raycaster.layers.mask & camera.layers.mask & object.layers.mask) !== 0
```

**What happened:**
1. We assigned nodes to layers 2 and 3
2. 3d-force-graph's camera only sees layer 0 (default)
3. Result: `camera.layers.mask & object.layers.mask === 0` → no intersection
4. Hover detection completely broken, nodes invisible

### Attempted Fixes (All Failed)

1. **Configure raycaster layers** ❌
   ```typescript
   graphInternal._raycaster.layers.enable(KEYWORD_LAYER);
   graphInternal._raycaster.layers.enable(CHUNK_LAYER);
   ```
   - Didn't help because the camera still only sees layer 0

2. **Set camera layers at render time** ❌
   ```typescript
   camera.layers.set(0);
   camera.layers.enable(KEYWORD_LAYER);
   ```
   - Broke 3d-force-graph's internal state
   - Raycasting uses camera state at time of raycast, not render time

3. **Clone camera for blur rendering** ❌
   ```typescript
   const blurCamera3D = camera.clone();
   // Use blurCamera3D for all blur passes, never touch main camera
   ```
   - Nodes still invisible because they're on layers 2/3 but default camera sees layer 0

### Symptoms

- ✅ Blur effect itself worked (shaders, render targets, multi-pass rendering all correct)
- ❌ No hover events firing (`onNodeHover` never called)
- ❌ Graph didn't render unless zoomed in very close
- ❌ When render interception commented out: edges visible, nodes invisible

## The Solution: Remove Layer Assignments

**What we did:**
1. Removed all `mesh.layers.set(layerId)` calls from [node-renderer.ts](../../src/lib/three/node-renderer.ts)
2. Removed blur composer integration from [renderer.ts](../../src/lib/three/renderer.ts)
3. Removed raycaster layer configuration (no longer needed)
4. All nodes now on default layer 0 → camera and raycaster can see them

**Result:**
- ✅ Hover detection works
- ✅ Nodes render correctly at all zoom levels
- ✅ All raycasting works without modification

## Key Learnings

### 1. Three.js Layers Are Not a Free Abstraction
Layers fundamentally change what cameras and raycasters can see. You can't use layers for selective rendering without carefully managing ALL camera layer masks in your system.

### 2. Don't Touch 3d-force-graph's Camera
3d-force-graph owns the camera and uses it for raycasting. Modifying the camera's layers breaks hover detection, click detection, and any other interaction that uses raycasting.

### 3. Alternative Approaches for Selective Rendering

Instead of layers, consider:

**Option 1: Render Order** (what we kept)
```typescript
group.renderOrder = getRenderOrder("nodes", isChunk ? LAYER_SPACING / 2 : 0);
group.position.z = chunkNode.z; // Z-position for depth separation
```
- Pros: Simple, works with existing raycasting
- Cons: Can't selectively blur without post-processing entire scene

**Option 2: Separate Scenes**
```typescript
const keywordScene = new THREE.Scene();
const chunkScene = new THREE.Scene();
// Render each scene separately, apply blur to keyword scene only
```
- Pros: Complete separation, easy to apply different effects
- Cons: More complex management, need to coordinate lighting/environment

**Option 3: Post-Processing with EffectComposer**
```typescript
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
```
- Pros: Industry-standard approach, many built-in effects
- Cons: Applies to entire scene, hard to selectively blur subsets

**Option 4: Custom Stencil Buffer Masking**
- Pros: Powerful, can achieve selective blur
- Cons: Very complex, requires deep WebGL knowledge

## Recommendations

For future blur/selective rendering attempts:

1. **Start with simple approaches**: Render order, z-position, opacity
2. **If you need layers**: Accept that you MUST manage ALL camera layer masks
3. **Consider post-processing**: Use EffectComposer if blur affects whole scene
4. **Test raycasting early**: Hover detection breaks are a sign layers won't work

## Code Changes

### Files Modified
- [src/lib/three/node-renderer.ts](../../src/lib/three/node-renderer.ts) - Removed layer assignments
- [src/lib/three/renderer.ts](../../src/lib/three/renderer.ts) - Removed blur composer integration
- [src/lib/three/label-overlays.ts](../../src/lib/three/label-overlays.ts) - Removed debug logging
- [src/hooks/useThreeTopicsRenderer.ts](../../src/hooks/useThreeTopicsRenderer.ts) - Removed blurEnabled option

### Files Kept (for reference)
- [src/lib/three/blur-composer.ts](../../src/lib/three/blur-composer.ts) - Working blur implementation (not integrated)
  - Gaussian blur shaders are correct
  - Multi-pass rendering works
  - Could be adapted for whole-scene blur or separate scene approach

## References

- [Three.js Layers Documentation](https://threejs.org/docs/#api/en/core/Layers)
- [Three.js Raycaster Source](https://github.com/mrdoob/three.js/blob/dev/src/core/Raycaster.js#L136) - Intersection logic
- [UnrealBloomPass](https://threejs.org/examples/?q=bloom#webgl_postprocessing_unreal_bloom) - Reference for separable blur in Three.js
