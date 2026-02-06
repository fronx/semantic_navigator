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
R3F destroys and recreates an `<instancedMesh>` whenever its `args` prop changes. The new Three.js object does NOT get the React `onClick` handler re-registered.

In production, `args` changed in two ways:
1. **Initial load**: `simNodes.length` starts at 0, becomes ~489 when ForceSimulation provides nodes
2. **Filtering**: `nodes.length` changes (489 → 9) when the user clicks a keyword to filter

Both cause `args={[geometry, undefined, COUNT]}` to change, triggering the bug.

### Fix: Monotonically increasing stable count

The instance count in `args` must **never change**. We use a ref that only ever increases:

```typescript
const stableCountRef = useRef(nodeCount);
if (nodeCount > stableCountRef.current) {
  stableCountRef.current = nodeCount;
}
const stableCount = stableCountRef.current;
// ...
<instancedMesh args={[geometry, undefined, stableCount]} />
```

When fewer nodes are active (after filtering), unused instances get `scale=0`:
```typescript
for (let i = simNodes.length; i < stableCount; i++) {
  scaleRef.current.setScalar(0);
  matrixRef.current.compose(positionRef.current, quaternionRef.current, scaleRef.current);
  meshRef.current.setMatrixAt(i, matrixRef.current);
}
```

Additionally, `mesh.boundingSphere` is reset each frame so Three.js recomputes it from current instance matrices (needed because `InstancedMesh.raycast()` checks `this.boundingSphere`, not `this.geometry.boundingSphere`).

### Files Changed
- `src/components/topics-r3f/KeywordNodes.tsx` - stableCount ref, boundingSphere reset
- `src/components/topics-r3f/ContentNodes.tsx` - same stableCount pattern, unused instance zeroing
- `src/hooks/useInstancedMeshMaterial.ts` - vertexColors support (from earlier session)

### Known Remaining Issue
TransmissionPanel (blur layer) interferes with click raycasting when enabled. This is a separate issue to investigate.

## Prevention: R3F instancedMesh Rules

**Never let `args` change on `<instancedMesh>`.** This is the single most important rule.

1. **Use a monotonically increasing count ref** - never shrink the instance count
2. **Hide unused instances with scale=0** - don't reduce the count
3. **Reset `mesh.boundingSphere = null` each frame** - so raycasting recomputes from current positions
4. **Set `frustumCulled={false}`** - instanced meshes span large areas
