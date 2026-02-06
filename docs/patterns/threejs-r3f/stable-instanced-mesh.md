# Stable InstancedMesh

**Problem**: R3F silently drops event handlers (onClick, onPointerDown, etc.) when `<instancedMesh>` `args` change, because it destroys and recreates the Three.js object without re-registering handlers.

**Root Cause**: R3F's reconciler treats `args` changes as "destroy old object, create new one." But unlike a full React unmount/remount, this internal recreation skips event handler registration. The result: clicks silently stop working with no console warnings.

**Solution**: Use `useStableInstanceCount` hook + `key` prop:

```tsx
import { useStableInstanceCount } from "@/hooks/useStableInstanceCount";

function MyNodes({ nodeCount, simNodes }) {
  const { stableCount, meshKey } = useStableInstanceCount(nodeCount);
  const { meshRef, handleMeshRef } = useInstancedMeshMaterial(stableCount);

  useFrame(() => {
    // Update active instances (0 to simNodes.length)
    for (let i = 0; i < simNodes.length; i++) {
      meshRef.current.setMatrixAt(i, ...);
    }
    // Hide unused instances
    for (let i = simNodes.length; i < stableCount; i++) {
      meshRef.current.setMatrixAt(i, ZERO_SCALE_MATRIX);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    // Reset so raycasting recomputes from current matrices
    meshRef.current.boundingSphere = null;
  });

  return (
    <instancedMesh
      key={meshKey}
      ref={handleMeshRef}
      args={[geometry, undefined, stableCount]}
      frustumCulled={false}
      onClick={handleClick}
    />
  );
}
```

**How it works**:

1. **Buffer** — `stableCount` is `Math.ceil(nodeCount * 1.5)`. Small count fluctuations during data loading (e.g., 489 to 521) stay within the buffer and don't change `args`.

2. **Safety net** — When reallocation does happen (count exceeds buffer), `meshKey` increments. Using it as `key` forces a full React unmount/remount, which properly registers event handlers on the new mesh — unlike R3F's silent internal recreation.

3. **Unused instances** — Set `scale=0` on instances beyond `simNodes.length`. This makes them invisible and un-hittable by raycasting.

4. **Bounding sphere** — Reset `mesh.boundingSphere = null` each frame. `InstancedMesh.raycast()` checks `this.boundingSphere` (mesh-level, not geometry-level). Without resetting, it caches stale bounds.

**Key points**:
- Always use `useStableInstanceCount` for any `<instancedMesh>` with dynamic counts
- Always pass `key={meshKey}` — the buffer prevents most remounts, but `key` makes reallocation safe
- Always set `frustumCulled={false}` — instanced meshes span large areas
- Always reset `mesh.boundingSphere = null` in useFrame
- The hook warns in dev mode when reallocation happens, so you can tune buffer size if needed

**Why the buffer matters even with `key`**: A React remount causes a one-frame visual glitch (mesh destroyed, recreated, useFrame populates it). The buffer minimizes how often this happens. For the common case (data loading settles within 50% of initial count), there's zero visual disruption.

**See also**: [Investigation report](../../investigations/keyword-node-clicks-broken-2026-02-06.md) for the full debugging story.
