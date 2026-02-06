# Keyword Node Clicks Broken (2026-02-06)

## Bug Summary
Keyword nodes in TopicsView R3F renderer do not respond to onClick events. Hover events work (handled at DOM level), but R3F mesh clicks fail.

## Current Status (2026-02-06 Late Night)
**ROOT CAUSE FOUND AND FIX IN PROGRESS** - Changing `args` on instancedMesh causes R3F to destroy/recreate mesh without re-registering onClick. Fix implemented (stable nodeCount), but raycasting still broken - debugging why.

### Session 3 Progress (Elimination Testing)

**Step 12: Commented out LabelsOverlay (DOM overlay)** - clicks still broken ❌
- Removed the entire DOM label overlay from R3FTopicsCanvas
- Confirms: DOM overlay is NOT blocking R3F mesh clicks

**Step 13: Stripped scene to minimum** - clicks still broken ❌
- Disabled: LabelsUpdater, CameraController, ContentNodes, TransmissionPanel, KeywordEdges
- Only remaining: ForceSimulation + KeywordNodes
- Clicks still don't work

**Step 14: Replaced KeywordNodes with minimal TestInstancedMesh** - clicks still broken ❌
- Created inline TestInstancedMesh with hardcoded red circles (same pattern as working test-material)
- No useFrame, no setColorAt, no visibility toggling, no scale
- Just: imperative material, setMatrixAt positions, onClick handler
- Clicks still don't work inside R3FTopicsScene

**Step 15: Disabled `<Environment preset="city" />`** - clicks still broken ❌

**Step 16: Changed test-material camera to match production** (z=10000, fov=10) - clicks still work ✓
- Confirms: Camera settings are NOT the issue

**Step 17: Added TestClickMesh directly in Canvas (bypassing R3FTopicsScene)** - CLICKS WORK ✓
- Identical instancedMesh code, same Canvas, same camera
- Green dots directly in Canvas: clicks register
- Red dots inside R3FTopicsScene: clicks do NOT register
- **This is the key finding: being inside R3FTopicsScene breaks instancedMesh clicks**

### Key Finding
Two identical instancedMesh components in the same Canvas:
- Directly in Canvas → clicks work
- Inside R3FTopicsScene → clicks don't work

R3FTopicsScene at this point had everything disabled except ForceSimulation (which returns null).

**Step 18: ForceSimulation disabled, hardcoded count=5** - CLICKS WORK ✓
- TestInstancedMesh with fixed count=5 inside R3FTopicsScene: clicks work
- ForceSimulation re-enabled alongside: clicks still work (count doesn't change)

**Step 19: Dynamic count change (5 → 521 after 2s timer)** - ROOT CAUSE CONFIRMED
- Red dots clickable at count=5 (3 clicks registered in console)
- After "changing count to 521 NOW": red dots stop responding to clicks
- Green dots (Canvas-level, fixed count=5) continue working
- **R3F drops onClick handlers when `args` change on instancedMesh**

## Root Cause (CONFIRMED)
When `args={[geometry, material, COUNT]}` changes on an `<instancedMesh>`, R3F destroys the old Three.js object and creates a new one. The onClick handler is NOT re-registered on the new object.

In production, `simNodes.length` starts at 0 and becomes ~521 when ForceSimulation calls `setKeywordNodes`. This changes `args`, triggering the bug.

## Fix (IMPLEMENTED BUT INCOMPLETE)
**Step 1: Stable instance count** ✅
- Changed `args={[geometry, undefined, nodeCount]}` where `nodeCount` comes from props
- KeywordNodes: `nodeCount={nodes.length}` passed from R3FTopicsScene
- ContentNodes: `nodeCount={contentNodeCount}` calculated from contentsByKeyword
- This prevents args from changing when simulation provides nodes

**Step 2: Initialize all instances** ✅
- Added loop to set scale=0 for unused instances (simNodes.length to nodeCount)
- Prevents uninitialized matrices from breaking raycasting

**Step 3: Raycasting still broken** ❌ (CURRENT ISSUE)
- With LabelsOverlay disabled: clicks reach canvas but miss all objects
- Test sphere (regular mesh) at origin: clicks work ✓
- instancedMesh keyword nodes: clicks miss ✗
- Console shows: "Canvas click (missed all objects)"
- Investigating why raycaster doesn't hit instancedMesh despite proper setup

## What We've Learned

### ✓ What's NOT the issue:
1. **DOM overlays blocking clicks** - Commented out LabelsOverlay entirely, clicks still broken
2. **CSS `.content-markdown` blocking** - Fixed by adding `pointer-events: none` to that class
3. **Event handlers interfering** - Disabled all DOM handlers (`onPointerMove`, `onPointerLeave`, wheel forwarding, CameraController) and clicks still don't work
4. **Scene structure blocking** - Test sphere (regular mesh) at same Z level receives clicks fine
5. **Imperative material creation** - `/test-material` with imperatively created material receives clicks perfectly
6. **Instances all at origin** - Debug logs show nodes have valid positions (`allAtOrigin: false`)
7. **Declarative material** - Adding `<meshBasicMaterial>` makes nodes black AND clicks still don't work
8. **useFrame updates** - Matrix updates every frame don't break clicks
9. **instanceColor attribute** - Static instanceColor works fine, clicks work even when rendering is broken
10. **Camera settings** - test-material works at z=10000 fov=10 (same as production)
11. **`<Environment preset="city" />`** - Disabled, clicks still broken
12. **KeywordNodes component** - Replaced with minimal instancedMesh (no useFrame, no colors, no visibility), still broken
13. **Other scene components** - Disabled ContentNodes, TransmissionPanel, KeywordEdges, LabelsUpdater, still broken

### ✓ What DOES work:
- `/test-overlay` - instancedMesh with DOM overlay, clicks work
- `/test-material` - instancedMesh with imperative material, clicks work (even at z=10000 fov=10)
- `/test-r3f` - Basic instancedMesh, clicks work
- Test sphere in TopicsView scene - regular mesh, clicks work
- **instancedMesh directly in production Canvas** (bypassing R3FTopicsScene) - clicks work

### ❌ What's broken:
- ANY instancedMesh rendered inside R3FTopicsScene - clicks don't work (even minimal ones with no useFrame/colors/visibility)

## Key Differences: Working vs Broken

| Feature | test-material (✓) | KeywordNodes (✗) |
|---------|------------------|------------------|
| Material | Imperative | Imperative |
| useFrame updates | Yes (position only) | Yes (position + scale + color) |
| instanceColor | No | Yes + setColorAt() |
| Matrix updates | setMatrixAt (position) | compose() with scale |
| Color updates | None | Every frame via setColorAt |
| Visibility toggling | None | meshRef.current.visible |
| Instance count | 5 | 521 |
| Scale changes | None | Dynamic (zoom + tier based) |

## Current Hypothesis (UPDATED)
~~useFrame updates~~ **RULED OUT** - test-material works fine with useFrame.

**New hypothesis:** `setColorAt()` or `mesh.visible` toggling breaks raycasting.

**Evidence:**
- test-material (no instanceColor, no setColorAt) - clicks work ✓
- test-material WITH useFrame - clicks work ✓
- KeywordNodes (instanceColor + setColorAt + visibility) - clicks broken ✗

**Likely culprits:**
1. **setColorAt() + instanceColor.needsUpdate** - Color updates might invalidate raycaster
2. **mesh.visible toggling** - Setting visible = false/true might break event registration
3. **Matrix.compose() with scale** - Different matrix setup than simple setPosition

## Code Locations

### Key Files:
- `src/components/topics-r3f/KeywordNodes.tsx` - Broken component (lines 54-127: useFrame loop)
- `src/components/__tests__/R3FImperativeMaterialTest.tsx` - Working test (just added useFrame at line 36)
- `src/hooks/useInstancedMeshMaterial.ts` - Imperative material setup
- `docs/investigations/keyword-material-double-bind.md` - Previous debugging doc (claims clicks work, but they don't)

### Test Pages:
- `/test-r3f` - Basic instancedMesh clicks (working)
- `/test-overlay` - With DOM overlays (working)
- `/test-material` - Imperative material (working → testing with useFrame)
- `/topics` - Actual broken implementation

### Temporary Debug Code:
- `R3FTopicsScene.tsx:271` - Test red sphere (works, proves scene is clickable)
- `KeywordNodes.tsx:45` - Debug logging (shows positions are valid)
- `KeywordNodes.tsx:131` - Click handler with debug logs (never fires)

## Next Steps

### Priority 1: Isolate the Breaking Change
Add features incrementally to test-material until clicks break:

1. **Add instanceColor** (no setColorAt yet)
   ```typescript
   // In handleMeshRef, after creating instances
   const colors = new Float32Array(5 * 3);
   for (let i = 0; i < 5; i++) {
     colors[i * 3] = 0; colors[i * 3 + 1] = 1; colors[i * 3 + 2] = 0;
   }
   mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
   ```

2. **Add setColorAt in useFrame** (update colors every frame)
   ```typescript
   meshRef.current.setColorAt(i, new THREE.Color(0x00ff00));
   meshRef.current.instanceColor.needsUpdate = true;
   ```

3. **Add mesh.visible toggling**
   ```typescript
   meshRef.current.visible = true; // or conditional
   ```

4. **Add Matrix.compose() instead of setPosition**
   ```typescript
   matrix.compose(position, quaternion, scale);
   ```

### Priority 2: If setColorAt breaks clicks
- Check if removing `instanceColor.needsUpdate = true` helps
- Try updating colors less frequently (every N frames)
- Consider separate geometry for raycasting

### Priority 3: If mesh.visible breaks clicks
- Remove visibility toggling from useFrame
- Use opacity/scale instead of visibility
- Investigate R3F's raycast filtering with visible property

## Relevant Documentation
- `docs/patterns/threejs-r3f/material-initialization-order.md` - Why imperative setup needed
- `docs/investigations/keyword-material-double-bind.md` - Previous debugging (OUTDATED: claims clicks work)
- [R3F Issue #3289](https://github.com/pmndrs/react-three-fiber/issues/3289) - onClick breaks with state changes
- [R3F Discussion #2103](https://github.com/pmndrs/react-three-fiber/discussions/2103) - instancedMesh onClick issues

## Rollback Instructions
To revert all debugging changes:
```bash
# Remove test sphere
git checkout src/components/topics-r3f/R3FTopicsScene.tsx

# Remove debug logging
git checkout src/components/topics-r3f/KeywordNodes.tsx

# Re-enable event handlers
git checkout src/components/topics-r3f/R3FTopicsCanvas.tsx

# Keep these changes (they're fixes):
# - src/app/globals.css (pointer-events: none on .content-markdown)
# - src/hooks/useInstancedMeshMaterial.ts (vertexColors: true)
```

## Resolution (FIXED)

### Root Cause

R3F destroys and recreates an `<instancedMesh>` whenever its `args` prop changes. The new Three.js object does NOT get the React `onClick` handler re-registered. This is silent — no warning, no error.

In production, `args` changed in two ways:
1. **Initial load**: `simNodes.length` starts at 0, becomes ~489 when ForceSimulation provides nodes
2. **Filtering**: `nodes.length` changes (489 → 9) when the user clicks a keyword to filter

Both cause `args={[geometry, undefined, COUNT]}` to change, triggering the bug.

### Session 4: Why the first fix broke

The initial fix (Session 3) used a monotonically increasing `stableCountRef` initialized to `nodeCount`:

```typescript
const stableCountRef = useRef(nodeCount);  // <-- Problem
if (nodeCount > stableCountRef.current) stableCountRef.current = nodeCount;
```

This worked in Hot Module Replacement (Fast Refresh) but **broke on full page reload**. The diagnostic process revealed why:

1. **Added diagnostic logging** — mount/unmount tracking, onPointerDown/onPointerUp on the mesh, and `onPointerMissed` on Canvas.

2. **Key log findings on full reload:**
   ```
   [KeywordNodes] MOUNTED, stableCount:489, nodeCount:489
   [KeywordNodes] UNMOUNTED                              ← React Strict Mode
   [KeywordNodes] MOUNTED, stableCount:489, nodeCount:489
   ... later ...
   totalKeywordCount changed: 489 → 521                  ← data settles
   [Canvas] onPointerMissed × 12                          ← clicks miss mesh
   ```

3. **Root cause of the second failure:** `totalKeywordCount` (the raw keyword count from the database query) starts at 489 during the first render cycle, then settles to 521 as data loading completes. React Strict Mode unmounts and remounts the component, **resetting `useRef` to its initial value** (489). When nodeCount grows to 521, it exceeds `stableCountRef.current` (489), causing `stableCount` to change → `args` changes → mesh recreated → onClick dropped.

4. **Verified with a test mesh** — a regular `<mesh>` (red sphere) placed alongside the instancedMesh received clicks fine. The `onPointerMissed` events confirmed R3F's event system was functional; only the instancedMesh raycast was failing because the mesh had been silently recreated.

### How we diagnosed it

The key diagnostic tools were:

- **Mount/unmount lifecycle logging**: Revealed the React Strict Mode double-mount and confirmed when the mesh was being recreated.
- **onPointerMissed on Canvas**: Confirmed clicks reached R3F but the raycast hit nothing — distinguishing "events blocked by DOM" from "raycast misses mesh."
- **onPointerDown/onPointerUp on instancedMesh**: Would fire only if the mesh retained its handlers. Their absence confirmed handler loss.
- **totalKeywordCount change logging**: Showed the exact moment the count grew past the stable allocation (489 → 521).
- **Test mesh (red sphere)**: Proved the scene, camera, and R3F event pipeline were all working — isolating the problem to instancedMesh specifically.

### Fix: Over-allocate with 50% buffer

```typescript
const stableCountRef = useRef(Math.ceil(nodeCount * 1.5));
if (nodeCount > stableCountRef.current) {
  stableCountRef.current = Math.ceil(nodeCount * 1.5);
}
const stableCount = stableCountRef.current;
// ...
<instancedMesh args={[geometry, undefined, stableCount]} />
```

The 50% buffer means:
- Initial nodeCount of 489 → stableCount of 734
- When data settles to 521, 521 < 734 → no args change
- React Strict Mode remount reinitializes to `Math.ceil(489 * 1.5) = 734` → still absorbs growth
- If nodeCount eventually exceeds 734, buffer re-expands: `Math.ceil(735 * 1.5) = 1103`

Unused instances (from `simNodes.length` to `stableCount`) get `scale=0` each frame, making them invisible and un-hittable by raycasting.

`mesh.boundingSphere` is reset to `null` each frame so Three.js recomputes it from current instance matrices. This is needed because `InstancedMesh.raycast()` checks `this.boundingSphere` (mesh-level), not `this.geometry.boundingSphere`.

### Additional fix: Stable ref callback

`useInstancedMeshMaterial` was creating a new `handleMeshRef` function each render, which caused R3F to run the ref cleanup/setup cycle. Fixed with `useCallback`:

```typescript
const instanceCountRef = useRef(instanceCount);
instanceCountRef.current = instanceCount;

const handleMeshRef = useCallback((mesh: THREE.InstancedMesh | null) => {
  meshRef.current = mesh;
  if (mesh && !mesh.instanceColor) {
    const count = instanceCountRef.current;
    // material + instanceColor setup...
  }
}, []); // Stable identity — never changes
```

### Collateral fix: precomputed-clusters API

The API was also broken (separate issue discovered during debugging):
- **GET → POST**: 521 keyword IDs as query params exceeded URL length limits → 500 error
- **Function overload ambiguity (PGRST203)**: Migration 028 created a 3-param version of `get_precomputed_clusters` alongside the existing 2-param version. PostgREST couldn't disambiguate. Fixed by dropping the old overload (migration 030) and passing `filter_node_type` explicitly.
- **nodeType threading**: Added `nodeType` option to `useClusterLabels` so TopicsView passes `"keyword"` (vs `"article"` default).

The 500 error caused useClusterLabels to fall back to client-side Leiden clustering, which ran 8 times during data loading — a visible performance regression.

### Files Changed
- `src/components/topics-r3f/KeywordNodes.tsx` - 50% buffer, diagnostic logging
- `src/components/topics-r3f/ContentNodes.tsx` - 50% buffer
- `src/components/topics-r3f/R3FTopicsScene.tsx` - totalKeywordCount prop
- `src/components/topics-r3f/R3FTopicsCanvas.tsx` - totalKeywordCount prop, onPointerMissed diagnostic
- `src/components/TopicsView.tsx` - totalKeywordCount prop, nodeType for cluster labels
- `src/hooks/useInstancedMeshMaterial.ts` - useCallback for stable ref
- `src/hooks/useClusterLabels.ts` - POST fetch, nodeType option
- `src/app/api/precomputed-clusters/route.ts` - GET → POST, filter_node_type
- `supabase/migrations/030_drop_old_precomputed_clusters_overload.sql` - drop old overload

### Known Remaining Issue
TransmissionPanel (blur layer) interferes with click raycasting when enabled. Separate issue.

## Prevention: R3F instancedMesh Rules

**Never let `args` change on `<instancedMesh>`.** This is the single most important rule.

1. **Use a monotonically increasing count ref with buffer** — `Math.ceil(nodeCount * 1.5)` absorbs data-loading fluctuations and React Strict Mode remounts
2. **Hide unused instances with scale=0** — don't reduce the count
3. **Reset `mesh.boundingSphere = null` each frame** — so raycasting recomputes from current positions
4. **Set `frustumCulled={false}`** — instanced meshes span large areas
5. **Use `useCallback` for mesh ref handlers** — prevents R3F from cycling ref cleanup/setup

## How to avoid this in the future

### Why this bug is hard to catch

1. **Silent failure**: R3F logs nothing when it destroys/recreates a mesh. onClick simply stops firing.
2. **Works in HMR**: Fast Refresh preserves component state (including refs), so the bug doesn't manifest during iterative development — only on full page reload.
3. **Works in isolation**: Test pages with fixed counts work perfectly. The bug requires the specific data-loading sequence of the production app.
4. **React Strict Mode is the accomplice**: The double-mount resets refs, which is the correct behavior for detecting side-effect bugs, but it exposes the R3F args issue in a way that single-mount wouldn't.

### Defensive patterns

**For any R3F component with dynamic `args`:**
- Always over-allocate with a buffer. The memory cost of extra instances at scale=0 is trivial compared to the debugging cost of lost handlers.
- Write a comment explaining WHY the count must not change. Future refactors that "simplify" by removing the buffer will reintroduce the bug.

**For debugging R3F click issues:**
- `onPointerMissed` on `<Canvas>` is the first diagnostic to add. It distinguishes "DOM blocking events" from "R3F sees the click but raycast misses."
- Mount/unmount logging on the component confirms when React recreates it.
- `onPointerDown`/`onPointerUp` on the mesh confirms handler registration.

## What could be done more robustly

### 1. Wrapper component that enforces stable args

A reusable `<StableInstancedMesh>` component could encapsulate the buffer logic:

```typescript
function StableInstancedMesh({ count, children, ...props }) {
  const stableCountRef = useRef(Math.ceil(count * 1.5));
  if (count > stableCountRef.current) {
    stableCountRef.current = Math.ceil(count * 1.5);
  }
  return (
    <instancedMesh args={[props.geometry, undefined, stableCountRef.current]} {...props}>
      {children}
    </instancedMesh>
  );
}
```

This moves the invariant into one place instead of repeating it in KeywordNodes and ContentNodes.

### 2. Dev-mode assertion

A `useEffect` that warns if `args` actually changed:

```typescript
useEffect(() => {
  if (process.env.NODE_ENV === 'development') {
    console.warn('[StableInstancedMesh] args changed! This will drop onClick handlers.');
  }
}, [stableCount]); // Should never fire after mount
```

### 3. R3F-level fix (upstream) — unlikely

The real fix belongs in React Three Fiber's reconciler: when `swapInstances()` recreates a Three.js object due to `args` change, `applyProps()` should re-register event handlers even when the handler count hasn't changed. The bug is in the condition `prevHandlers !== instance.eventCount` — it should also check whether the object identity changed.

**This bug has been reported and "fixed" twice, then regressed:**

1. [#1660](https://github.com/pmndrs/react-three-fiber/issues/1660) (2021) — "Instanced mesh event handlers don't survive an unmount." Fixed in v7.0.8 via PR #1715.
2. [#1937](https://github.com/pmndrs/react-three-fiber/issues/1937) (2021) — "Instanced mesh pointer events do not fire after update." Fixed via PR #1960, titled "rebind handlers for swapped instances."
3. [#3289](https://github.com/pmndrs/react-three-fiber/issues/3289) (2024) — Same bug resurfaced. Closed January 2025 as **NOT_PLANNED**. Maintainer misdiagnosed it as a boundingSphere issue and recommended BVH/octrees instead.

The #3289 misdiagnosis is understandable but wrong: boundingSphere is a secondary issue (the raycaster does need a valid bounding sphere), but the primary failure is that the mesh isn't even in `rootState.internal.interaction` — the raycaster never tests it at all.

As of R3F v9.5.0 (our version), the bug is still present in `applyProps()`. Since the maintainers closed the latest report as won't-fix, `useStableInstanceCount` is the correct long-term workaround.

### 4. Integration test

A Playwright test that:
1. Loads `/topics` with full data
2. Waits for data loading to complete (totalKeywordCount stabilizes)
3. Clicks on a keyword node
4. Asserts that the click handler fires (e.g., checks for filter state change)

This would catch the regression on any code path that changes `args`, including future refactors.
