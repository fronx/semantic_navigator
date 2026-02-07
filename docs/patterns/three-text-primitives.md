# Three-Text Primitives in R3F

We render all WebGL text with [`three-text`](https://github.com/countertype/three-text). Styled text looks great, but naïvely re-rendering `<Text>` components on every frame stalls the scene (each re-render rebuilds glyph geometry on the main thread). Instead, treat text meshes like any other Three.js geometry:

1. **Create + cache geometry once per string**  
   ```ts
   import { Text } from "three-text/three";

   const key = `${fontSize}:${text}`;
   const cached = geometryCache.get(key);
   if (!cached) {
     const result = await Text.create({
       text,
       font: "/fonts/source-code-pro-regular.woff2",
       size: fontSize,
       lineHeight: 1.05,
       color: [1, 1, 1],
     });
     geometryCache.set(key, { geometry: result.geometry, planeBounds: result.planeBounds });
   }
   ```
   Cache entries are reusable across labels and survive hot reloads during dev.

2. **Instantiate plain `<mesh>` nodes**  
   ```tsx
   <mesh
     geometry={geometryEntry.geometry}
     material={material}
     frustumCulled={false}
   />
   ```
   Use `MeshBasicMaterial` with `transparent`, `depthTest=false`, `depthWrite=false` to keep labels on top. Reuse materials when possible; dispose them on unmount.

3. **Drive animation in a parent `useFrame`**  
   Each label registers its billboard + material with the parent. A single `useFrame` iterates over all registrations, updates position/scale based on current node positions + screen size, and adjusts opacity for fading:
   ```ts
   useFrame(() => {
     labelRegistry.forEach(({ billboard, material, baseOpacity, baseFontSize, nodesInCluster }) => {
       // reposition label centroid
       billboard.position.set(avgX(nodesInCluster), avgY(nodesInCluster), labelZ);

       const unitsPerPixel = computeUnitsPerPixel(camera, size, billboard.position, tempVec);
       const desiredScale = Math.max(1, minScreenPx * unitsPerPixel / baseFontSize);
       billboard.scale.setScalar(desiredScale);

       const fade = computeFade(/* pixel size */);
       material.opacity = baseOpacity * fade;
     });
   });
   ```
   Because the parent hook always runs, labels stay responsive even when the camera is idle.

### When to extract a primitive

The cluster labels and markdown billboard now share the same building blocks:

- Geometry cache (keyed by text + font properties)
- Material factory (color, transparency, no depth test)
- Registration-based animation loop
- `useThreeTextGeometry` hook (src/hooks/useThreeTextGeometry.ts) handles caching + async creation
- `computeUnitsPerPixel` + `smoothstep` helpers (src/lib/three-text-utils.ts) keep scale + fade consistent across layers
- `KeywordLabels3D` demonstrates how to reuse the same primitives for high-volume labels without touching the DOM. Each label registers itself with a parent registry, and a single `useFrame` loop (inside the component) keeps position/scale/opacity in sync with node degrees, zoom ranges, search opacities, and hover refs.

### Keyword label implementation

`src/components/topics-r3f/KeywordLabels3D.tsx` is the reference implementation for high-volume labels:

- Filters to keyword nodes and maps each to a cached geometry/material pair (via `useThreeTextGeometry`).
- Registers each label so a single `useFrame` loop can update centroid position, zoom-based scale, camera-facing min size, and zoom-phase opacity thresholds derived from `zoomPhaseConfig.keywordLabels`.
- Reads shared refs (`nodeDegreesRef`, `pulledPositionsRef`, `hoveredKeywordIdRef`) so behavior matches the legacy label manager (degree filtering, pulled-node dimming, hover scaling, search opacity, etc.).
- Emits hover + click events that reuse the existing handlers, so the rest of the interaction stack (edges, sidebar, hover controller) stays unchanged.

If we need more three-text surfaces (content cards, inline annotations, etc.), consider extracting a `GraphThreeText` helper that bundles those pieces. Until then, the pattern above is enough to keep new meshes performant and in sync with the graph simulation.
