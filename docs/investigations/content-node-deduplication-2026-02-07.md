# Content Node Deduplication Implementation

**Date**: 2026-02-07
**Status**: ✅ Complete - unified simulation working
**Goal**: Add spring force slider and eliminate duplicate content nodes

## Motivation

Previously, when a chunk belonged to multiple keywords (e.g., chunk X with keywords [A, B, C]), we created 3 separate `ContentSimNode` instances. This made the spring force slider less meaningful since each duplicate operated independently.

The new approach: **one content node per chunk**, connected to all its keywords via multi-parent forces.

## What Was Implemented

### 1. Spring Force Slider (UI)
- **File**: `src/hooks/useTopicsSettings.ts`
- Added `contentSpringStrength: number` (default: 0.1, range: 0.01-1.0)
- Created new "Content Layout" section in ControlSidebar
- Plumbed through: TopicsView → R3FTopicsCanvas → R3FTopicsScene → useContentSimulation

### 2. Data Structure Change
- **File**: `src/lib/content-layout.ts`
- Changed `ContentSimNode` interface:
  ```typescript
  // BEFORE
  parentId: string; // Single parent

  // AFTER
  parentIds: string[]; // Multiple parents
  ```

### 3. Deduplication Logic
- **File**: `src/lib/content-layout.ts` - `createContentNodes()`
- **Two-pass algorithm**:
  1. **First pass**: Collect all keywords for each unique chunk ID
     - Build `chunkToKeywords: Map<chunkId, Set<keywordId>>`
     - Build `chunkData: Map<chunkId, ContentNode>` (stores chunk data once)
  2. **Second pass**: Create one ContentSimNode per unique chunk
     - Initial position: **centroid of all parent keywords**
     - Store all parent IDs in `parentIds` array
- **Result**: Chunk X with keywords [A, B, C] creates **1 node** instead of 3

### 4. Multi-Parent Force Simulation
- **File**: `src/hooks/useContentSimulation.ts` - `tetherToParent()`
- **Force calculation**:
  - **Spring forces**: Sum of forces from ALL parent keywords
    ```typescript
    for (const parentId of node.parentIds) {
      const dx = parent.x - node.x;
      const dy = parent.y - node.y;
      totalFx += dx * springStrength * alpha;
      totalFy += dy * springStrength * alpha;
    }
    ```
  - **Distance constraint**: Based on closest parent's neighborhood density
  - **Initialization**: Nodes start at centroid of parents

### 5. Simulation Restart on Slider Change
- **File**: `src/hooks/useContentSimulation.ts`
- **FIXED**: Initially had 3 conflicting effects responding to `springStrength` changes
  - Creation effect (line 212) recreated simulation + called `.stop()`
  - Hot restart effect (226-232) tried to restart with `alpha(0.8)`
  - Forces update effect (235-257) recreated forces + restarted with `alpha(0.3)`
- **Solution**:
  - Removed `springStrength` from creation effect deps
  - Removed hot restart effect entirely
  - Kept `springStrength` in forces update effect only
  - Increased alpha to 0.8 for aggressive visible feedback
- **Result**: Single effect handles spring strength changes cleanly

### 6. Rendering Updates
- **File**: `src/components/topics-r3f/ContentNodes.tsx`
- **Color**: Uses first parent keyword (`parentIds[0]`)
- **Search opacity**: Takes MAX across all parents (show if ANY keyword matches)
  ```typescript
  let maxSearchOpacity = 0;
  for (const parentId of node.parentIds) {
    const opacity = searchOpacities.get(parentId) ?? 1.0;
    maxSearchOpacity = Math.max(maxSearchOpacity, opacity);
  }
  ```
- **Label key**: Simplified from `${parentId}:${nodeId}` to just `node.id` (no duplicates!)

### 7. Content Count Per Parent
- **File**: `src/hooks/useContentSimulation.ts`
- Updated to count each node once per parent it belongs to:
  ```typescript
  for (const node of contentNodes) {
    for (const parentId of node.parentIds) {
      counts.set(parentId, (counts.get(parentId) ?? 0) + 1);
    }
  }
  ```

## Potential Issues to Investigate

### 1. **Force Balance with Multiple Parents**
- When a node has parents A, B, C at different distances, the sum of spring forces might not reach equilibrium where we expect
- **Question**: Should forces be normalized by number of parents? Or weighted by distance?
- **Current behavior**: A node with 3 parents gets 3x the total force magnitude compared to a node with 1 parent

### 2. **Centroid Initialization**
- Nodes start at the centroid of all parents, but spring forces pull them toward the same centroid
- **Question**: Is this redundant? Should we add an offset or jitter to break symmetry?
- **Potential issue**: Nodes might stay "stuck" at the centroid if forces are perfectly balanced

### 3. **Distance Constraint with Closest Parent**
- We constrain max distance based on the **closest** parent's neighborhood density
- **Question**: What if a node is far from most of its parents but close to one?
- **Example**: Chunk shared between "machine learning" (10 chunks) and "neural networks" (50 chunks)
  - If close to "machine learning", constraint is loose (small neighborhood)
  - But forces pull toward "neural networks" too, which might exceed that constraint

### 4. **Search Opacity with MAX Logic**
- Taking MAX opacity means a chunk shows fully if ANY parent keyword matches
- **Question**: Is this the right behavior? Or should we average/blend?
- **Alternative**: Use weighted average based on proximity to each parent?

### 5. **Collision Detection Performance**
- Deduplication reduces total node count, which should help performance
- **But**: The old code had sibling-only repulsion (nodes under same parent)
- **New code**: Global repulsion between ALL content nodes
- **Question**: Does this hurt performance at scale? Should we use spatial indexing?

### 6. **Legacy Renderer Compatibility**
- Updated `applyConstrainedForces()` in `content-layout.ts` for backward compatibility
- **But**: This uses a different force model than the D3 simulation
- **Question**: Should we deprecate the old renderers or maintain parity?

### 7. **Label Positioning**
- Labels now key by `node.id` instead of composite key
- **Potential issue**: Label system might still expect composite keys elsewhere?
- **Files to check**:
  - `LabelsOverlay.tsx` - does it handle the new key format?
  - Any code that builds `contentScreenRectsRef` maps

### 8. **Edge Rendering**
- Comment in `R3FTopicsScene.tsx` says content edges are disabled for visual clutter
- **Question**: With deduplication, should we show edges to multiple parents?
- **Could be useful**: Visually indicate which keywords a chunk belongs to

## Testing Checklist

Before considering this complete, verify:

- [ ] Content nodes appear (not invisible/broken)
- [ ] Spring force slider visibly affects node positions
- [ ] Nodes with multiple parents settle between them (not stuck at one)
- [ ] Search highlighting works (chunks appear when any parent keyword matches)
- [ ] No duplicate labels (each chunk labeled once)
- [ ] Label positioning matches node positions
- [ ] Click/hover interactions still work on content nodes
- [ ] Performance acceptable with many content nodes (no stuttering)
- [ ] Simulation "heats up" when slider changes (nodes visibly rearrange)
- [ ] No console errors about missing parentIds or undefined values

## Files Modified

### Core Logic
- `src/lib/content-layout.ts` - Data structure and deduplication
- `src/hooks/useContentSimulation.ts` - Multi-parent forces and hot restart

### UI & Settings
- `src/hooks/useTopicsSettings.ts` - Added contentSpringStrength setting
- `src/components/ControlSidebar.tsx` - Added spring force slider
- `src/app/topics/page.tsx` - Pass setting through to TopicsView

### Rendering
- `src/components/topics-r3f/ContentNodes.tsx` - Multi-parent color/opacity
- `src/components/topics-r3f/R3FTopicsScene.tsx` - Pass springStrength to simulation
- `src/components/topics-r3f/R3FTopicsCanvas.tsx` - Props threading
- `src/components/TopicsView.tsx` - Props threading

## Next Steps

1. **Visual inspection**: Boot up the app and look for obvious breakage
2. **Force tuning**: Experiment with slider to see if behavior makes sense
3. **Review force balance**: Consider normalizing by parent count or using distance weights
4. **Edge visualization**: Decide if we want to show keyword→chunk connections
5. **Performance check**: Profile with large keyword sets
6. **Label system audit**: Ensure no code still expects composite keys
7. **Consider collision optimization**: Spatial hashing if global repulsion is slow

## Unified Simulation Experiment (2026-02-07)

**Goal**: Test if combining keyword + content nodes in a single D3 simulation produces better spring force behavior.

### Implementation

Created `UnifiedSimulation.tsx` component:
- Merges keywords and content into one simulation
- Keywords get: link forces, charge, collision, centering
- Content gets: tether forces (spring to parents), collision
- Spring strength slider controls tether force

**Files modified**:
- `src/components/topics-r3f/UnifiedSimulation.tsx` (new)
- `src/components/topics-r3f/R3FTopicsScene.tsx` - conditional rendering
- `src/hooks/useTopicsSettings.ts` - added `unifiedSimulation` toggle
- `src/components/ControlSidebar.tsx` - UI toggle in "Content Layout"

### Issues Encountered

1. **Initial render: only labels visible**
   - **Cause**: UnifiedSimulation received empty `contentNodes` array
   - **Fix**: UnifiedSimulation now creates content nodes internally from `contentsByKeyword`

2. **Spring force slider not reactivating**
   - **Cause**: Multiple effects competing (same issue as separate simulation)
   - **Fix**: Removed `springStrength` from creation effect deps, added dedicated update effect

3. **Content nodes not rendering in unified mode**
   - **Cause**: Rendering used `contentNodes` from separate simulation (empty in unified mode)
   - **Fix**: Extract content nodes from `simNodes` via filter for both modes

4. **Graph invisible after fixes** - RESOLVED
   - **Cause**: KeywordNodes received `keywordNodes` state (empty in unified mode)
   - **Fix**: Filter `simNodes` to extract `renderKeywordNodes`, use for both KeywordNodes and KeywordEdges
   - Both keyword and content extraction now use same pattern (works in both modes)

5. **TransmissionPanel (blur layer) not visible** - RESOLVED
   - **Cause**: Panel enabled check used `contentNodes.length > 0` (empty in unified mode)
   - **Fix**: Changed to `renderContentNodes.length > 0` (works in both modes)

6. **Jittery position flickering and label flashing** - RESOLVED
   - **Root cause**: D3 simulation auto-ticking continuously (multiple times per frame)
   - **Symptom**: Nodes oscillating between positions, labels flickering on/off
   - **Fix**: Manual tick synchronization
     - Added `.stop()` after simulation creation to prevent auto-ticking
     - Exposed tick method via `onTickReady` callback
     - R3FTopicsScene calls tick from `useFrame` (once per render frame)
     - Matches proven pattern from `useContentSimulation`
   - **Result**: Deterministic frame-synchronized updates, no jitter

7. **ContentEdges visualization** - ADDED
   - Enabled in unified mode to visualize multi-parent relationships
   - Shows keyword→content connections (helpful for understanding deduplication)
   - Remains disabled in separate mode (too much clutter)

8. **Spring force slider extended** - ENHANCED
   - Range expanded: 0.01-100 (was 0.01-1.0)
   - Logarithmic scale (base 10) for better control
   - Slider operates in log space, value stored linearly
   - Display format: 3 decimals for values < 1, 1 decimal for ≥ 1

### Status: COMPLETE

All rendering and simulation issues resolved. Unified mode now working correctly with:
- Frame-synchronized simulation (no jitter)
- Correct node rendering (keywords and content)
- Blur layer effects visible
- ContentEdges showing multi-parent relationships
- Extended spring force range for experimentation

## Simulation Tuning Sliders (2026-02-07)

Added configurable sliders for simulation parameters:

### Charge Strength
- **Setting**: `chargeStrength` (default: -200, range: -500 to 0)
- Applied to `d3.forceManyBody().strength()` in both ForceSimulation and UnifiedSimulation
- Controls node repulsion: more negative = nodes push apart more = graph spreads out
- **Files**: ForceSimulation.tsx, UnifiedSimulation.tsx, threaded through full prop chain

### Keyword Size Multiplier
- **Setting**: `keywordSizeMultiplier` (default: 1.0, range: 0.1 to 5.0)
- Multiplied into `finalScale` in KeywordNodes useFrame loop
- **Files**: KeywordNodes.tsx, threaded through full prop chain

### Cursor-Based Focus Radius
- Extended existing `focusRadius` to use cursor position (not just camera center)
- `cursorWorldPosRef` computed in R3FTopicsScene useFrame from screen coords + camera
- Used by both KeywordNodes and ContentNodes for proximity-based scaling

## Keyword Nodes Appearing Small - RESOLVED ✅

**Symptom**: After this session's changes, keyword nodes appear tiny relative to edges.

**Cause**: `focusRadius` proximity scaling in KeywordNodes.tsx (added in previous commit `8441193`). When `focusRadius > 0`, `computeProximityScale()` shrinks nodes far from the cursor/center down to 0.3x. This applied to **keyword** nodes too, but should only affect content nodes.

**Fix Applied**: Removed `focusRadius`/`computeProximityScale` from KeywordNodes. Keywords now maintain constant size regardless of cursor proximity. Proximity scaling remains for content nodes only (LOD-like behavior). Keywords are the primary navigation landmarks and should stay visible.

**Files Modified**:
- `src/components/topics-r3f/KeywordNodes.tsx` - Removed proximity scaling logic and related props
- `src/components/topics-r3f/R3FTopicsScene.tsx` - Removed `focusRadius` and `cursorWorldPosRef` from KeywordNodes call
- `src/lib/label-overlays.ts` - Updated `parentId` → `parentIds[0]` after deduplication
- `src/components/TopicsView.tsx` - Fixed prop name for legacy Three.js renderer

## Content Edge Rendering Issues (2026-02-07) - RESOLVED

**Goal**: Make content→keyword edges visually connect to nodes at both endpoints in unified mode.

### What Was Implemented

1. **Fixed `parentId` → `parentIds` in ContentEdges.tsx**
   - Updated edge creation to iterate over `parentIds` array
   - Creates edge from each parent keyword to content node (visualizes multi-parent relationships)
   - Console logs confirm: 1071 edges from 756 content nodes, correctly connecting keyword→chunk

2. **Added 3D edge interpolation in EdgeRenderer.tsx**
   - Edges now interpolate Z from source to target
   - Keywords default to z=0, content nodes use their z property
   - Edges span the Z distance between layers (was flat at single Z plane)

3. **Tested with constant opacity**
   - Changed opacity from zoom-based (`"chunk"`) to constant (0.5) for debugging
   - Edges became visible, confirming they're being created and rendered
   - Issue isn't opacity/zoom, it's positional alignment

4. **Hover-based edge reveal in EdgeRenderer.tsx**
   - Edges reaching off-screen only show when hovering the visible endpoint
   - Uses `hoveredKeywordIdRef` instead of cursor proximity for cleaner interaction

### Parallax Bug - Root Cause Found

**Symptom**: Edges appeared offset/disconnected from nodes, especially away from screen center.

**Initial theory (wrong)**: Stale nodeMap positions. The nodeMap holds references to the same objects D3 mutates in-place, so positions are always current in `useFrame`.

**Actual root cause: Z-depth mismatch (650 units!)**
- `CONTENT_Z_DEPTH` = `BASE_CAMERA_Z * CONTENT_Z_OFFSET` = `1000 * 0.5` = **500** (positive, toward camera)
- Content nodes were created with `z: CONTENT_Z_DEPTH` = **500** in `content-layout.ts`
- ContentNodes component rendered at `contentZDepth` prop = **-150** (from R3FTopicsScene)
- EdgeRenderer read `node.z` = **500** for edge target Z position
- Result: edges drawn to z=500 while nodes rendered at z=-150

Under perspective projection, a 650-unit Z difference causes significant screen-space offset, especially away from screen center (classic perspective parallax).

### Fix Applied

1. **Removed `z` from ContentSimNode** (`content-layout.ts`)
   - Z depth is a rendering concern, not data
   - Removed `z` from interface and node creation
   - EdgeRenderer falls back to `zDepth` prop when `node.z` is undefined

2. **ContentEdges now accepts `contentZDepth` prop** (`ContentEdges.tsx`)
   - Removed hardcoded `CONTENT_Z_DEPTH` import
   - Passes `contentZDepth` to EdgeRenderer as `zDepth`

3. **R3FTopicsScene passes same Z to both** (`R3FTopicsScene.tsx`)
   - ContentNodes and ContentEdges both receive `contentZDepth` from the same prop
   - When the Z depth slider changes, edges and nodes stay synchronized

### Files Modified

- `src/lib/content-layout.ts` - Removed `z` from ContentSimNode interface and creation
- `src/components/topics-r3f/ContentEdges.tsx` - Added `contentZDepth` prop, `hoveredKeywordIdRef` prop
- `src/components/topics-r3f/EdgeRenderer.tsx` - Added `hoveredKeywordIdRef` for hover-based edge reveal
- `src/components/topics-r3f/R3FTopicsScene.tsx` - Passes `contentZDepth` to ContentEdges
- `src/lib/label-overlays.ts` - Updated parentId → parentIds[0] after deduplication

## Open Design Questions

1. **Force normalization**: Divide total force by `parentIds.length`?
2. **Distance weighting**: Weight each parent's pull by inverse distance?
3. **Equilibrium detection**: Add damping when forces are balanced?
4. **Visual feedback**: Show edges to parent keywords on hover?
5. **Color blending**: Mix colors from all parents instead of just first?
6. **Dynamic scaling**: Node sizes should adapt to graph density (median nearest-neighbor distance)
