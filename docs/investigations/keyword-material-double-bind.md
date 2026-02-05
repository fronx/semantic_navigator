# Keyword Material Double Bind (2026-02-05)

## Summary
Instanced keyword dots in the R3F renderer had a “double bind.” Leaving the default material in place let the frosted transmission panel blur the dots and preserved their colors, but pointer events were unreliable. Adding `<meshBasicMaterial vertexColors ...>` restored interactions yet turned every dot pure black and bypassed the blur. This note captures what actually controls color, depth, and raycasting for the dots so we do not bounce between the two broken states again.

## Symptoms
- Keywords rendered black whenever we explicitly mounted `<meshBasicMaterial vertexColors transparent depthTest={false} />` or any variation of that JSX helper.
- Removing the helper restored colors and blur, but keyword clicks stopped firing consistently once the transmission panel was active.
- Chunks never had this issue because they already owned an explicit material built in code rather than JSX.

## Root Cause
1. R3F’s `<instancedMesh>` without a material prop builds a default `MeshBasicMaterial` internally. That material **does write to the depth buffer**, so the transmission panel samples it correctly, but R3F doesn’t register raycast events when we later mutate attributes outside of React (our imperative `useFrame` updates). Hence the “clicks broken but colors OK” state.
2. When we tried to supply our own `<meshBasicMaterial vertexColors ...>`, the shader compiled **before** we attached an `instanceColor` buffer. Without vertex colors or an instanced color attribute at compile time, Three set `gl_VertexColor` to black, which multiplied every fragment to `vec3(0)`—hence the black dots.
3. Even after we started building the material manually, we left `vertexColors: true`. Instanced colors use `instanceColor`, not per-vertex colors; enabling `vertexColors` without a `color` attribute still zeros out the fragments.

## Fix
Implemented in `src/components/topics-r3f/KeywordNodes.tsx`.

1. Use a ref callback (`handleMeshRef`) so we can:
   - Allocate the `InstancedBufferAttribute` for `instanceColor` before any material is created.
   - Dispose of any default material assigned by R3F.
2. Create a `MeshBasicMaterial` in code with:
   - `color: 0xffffff` (base white).
   - `transparent: false`, `depthTest: true`, `depthWrite: true`, `toneMapped: false`.
   - **No** `vertexColors` flag—instanced colors come from `instanceColor`.
3. Assign the material after the attribute exists so the shader compiles with instanced-color support immediately.

Result: nodes render in the intended palette, still write depth so the frosted panel can blur them, and pointer events remain working because the mesh now owns a stable material instance.

## Verification Checklist
- Keywords show semantic colors at every zoom level.
- Transmission panel still blurs/dims them when zoomed toward the chunk plane.
- Hover cursor changes and click callbacks fire as before.
- Removing the frosted panel entirely still leaves colors intact (proves we are not depending on order-dependent blending).

## Follow-Ups
- Consider moving the same pattern to `ChunkNodes` if we ever see similar regressions.
- If we adopt custom shaders later, keep this order requirement (attribute before material) in mind to avoid reintroducing the issue.
