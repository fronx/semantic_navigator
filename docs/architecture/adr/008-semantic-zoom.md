# ADR 008: Semantic Zoom

## Status
Implemented (Phase 2 Complete)

## Context
The map visualization currently uses geometric zoom (d3 zoom 0.1x-4x). Users can filter by search query and adjust a threshold slider, but these are separate from the zoom gesture.

We want to unify the experience: zooming should implicitly control semantic filtering. As you zoom in on a region, the system infers what you're focusing on and progressively filters to show only semantically related content.

### Goals
1. **Implicit filtering**: No need to manually adjust thresholds - zoom level does it
2. **Visual stability**: Nodes that remain visible should keep their positions
3. **Natural interaction**: Standard mouse/trackpad zoom, but with semantic meaning
4. **Edge clarity**: Edges become more visible as you zoom in (less clutter when zoomed out)

## Decision

### Code Organization Principle

Keep view components clean by extracting significant logic:
- **Pure functions** → `src/lib/semantic-zoom.ts` (no React, no DOM, fully testable)
- **React state** → `src/hooks/useSemanticZoom.ts` (coordinates state, exposes clean API)
- **View changes** → Minimal wiring only (callbacks, prop passing)

This prevents view bloat and keeps each layer focused.

### Core Model: Immutable Graph + View

Rather than copying/rebuilding the graph on each zoom, we use an immutable data structure with a view:

```
Full Graph (loaded once)     →     View (Set<nodeId>)     →     Rendered Graph
- All nodes + embeddings           - O(1) membership check        - Filtered nodes/edges
- All edges                        - No data copying
- Position storage map
```

### Client-Side Embeddings

Send 256-dim embeddings to the client in the `/api/map` response. This enables:
- Real-time semantic distance computation
- No server round-trip on zoom
- Smooth, responsive filtering

**Trade-off**: Larger payload (~1KB per node as JSON). For 500 nodes ≈ 500KB.

### Multi-Centroid Approach (Focal Nodes)

**Key insight**: Averaging embeddings into a single centroid creates a "phantom point" in embedding space that may not represent any actual concept. Instead, we use a multi-centroid approach:

1. Find all nodes within a "focal radius" (configurable, default 10% of viewport diagonal) of screen center
2. Keep these as individual reference points (focal nodes)
3. A node is visible if it's similar enough to **ANY** focal node

This preserves distinct semantic clusters that appear together on screen. If you're looking at keywords about "machine learning" and "databases", you'll see nodes related to either concept, not just nodes related to some averaged phantom concept.

**Focal radius tuning**: The focal radius slider (2%-40%) controls how many nodes near screen center become focal nodes. Smaller values = tighter focus = more aggressive filtering. Larger values = more focal nodes = more nodes pass the similarity filter.

### Neighbor Inclusion

When a node passes the semantic filter, **all its direct neighbors are also made visible**. This ensures:
- If a keyword is visible, its connected articles are too
- If an article is visible, its keywords are too
- You always see complete local context

### Zoom-to-Threshold Mapping

Map geometric zoom level to similarity threshold (linear curve):

```
Zoom <0.5x → threshold 0.50 (minimum threshold)
Zoom 0.5x  → threshold 0.50 (filtering active at default view)
Zoom 1.75x → threshold 0.80 (max filtering)
```

The threshold range (0.50-0.80) was calibrated empirically:
- Start at 0.50 so filtering has visible effect even at default zoom
- Cap at 0.80 to avoid over-filtering
- zoomFloor at 0.5x means filtering is active in normal use

Users can adjust:
- `focalRadius` via slider (2%-40%) to control how many nodes become focal reference points
- `maxThreshold` via slider (0.3-0.8 range) to tune similarity threshold aggressiveness

### Zoom-Level Hysteresis

To prevent oscillation when zooming in/out, hysteresis applies to the **zoom level**, not the threshold:
- **Zooming in**: always refilters (tighter focus)
- **Zooming out**: the visible set stays fixed until you've zoomed out by more than the hysteresis amount (default 1.0 zoom units)

This creates a large "dead zone" where the visible set is locked until significant zoom-out occurs. Once you zoom in and filter, you must zoom out substantially before any nodes return. This prevents the constant refiltering that was causing visual instability.

### Graph-Fits-in-Viewport Reset

When the currently visible nodes fit in the viewport with 50% margin AND the zoom scale is below the floor (0.5x), all nodes become visible. This requires both conditions to prevent feedback loops where programmatic zoom adjustments trigger unintended resets. Users must actively zoom out (below 0.5x) to reset the filter.

### Force Layout Constraints

Force-directed layout always uses **overflow mode** (fitMode=false). This ensures:
- Nodes extend beyond the canvas, requiring zoom-out to see all
- Semantic zoom filtering has room to work without viewport constraints
- Consistent behavior regardless of URL parameters

### Hull Label Filtering

Community hull labels are also subject to semantic zoom filtering:
- Labels only appear if the community has visible members
- Label opacity scales with the fraction of visible members
- Prevents visual clutter from irrelevant community labels

### Position Persistence

- **Zoom in**: Departing nodes save their positions to a Map
- **Zoom out**: Returning nodes check stored positions first, then interpolate from neighbors
- **Settling**: Existing nodes are soft-pinned (high friction), new nodes find their places

### Edge Visibility

**Hidden edges**: Edges between two hidden nodes are completely hidden (opacity 0), not just dimmed. This significantly reduces visual clutter.

**Dynamic opacity**: Visible edge opacity scales with the number of visible edges, not zoom level:
- Few edges (~100) → 0.8 opacity (clearly visible)
- Many edges (~2000+) → 0.1 opacity (lighter to reduce clutter)

This auto-adapts: when zoomed in and filtering is active, fewer edges remain visible so they become more prominent. When zoomed out with many edges, they fade to avoid overwhelming the view.

## Implementation

### Files Modified

| File | Changes |
|------|---------|
| `src/app/api/map/route.ts` | Add `embedding` field to MapNode response |
| `src/lib/semantic-zoom.ts` | Core algorithms (focal nodes, threshold, filtering) |
| `src/hooks/useSemanticZoom.ts` | React state management |
| `src/lib/map-renderer.ts` | Zoom callbacks, visibility updates, hull label filtering |
| `src/components/MapView.tsx` | Wire up semantic zoom (enabled by default) |
| `src/components/MapSidebar.tsx` | Max threshold slider |

### Key Functions

```typescript
// Core algorithms (src/lib/semantic-zoom.ts)
computeFocalNodes(nodes, bounds, center, radius): number[][] | null
computeVisibleSetMulti(nodes, focalEmbeddings, threshold): Set<string>
extendVisibleToConnected(visibleIds, nodes, edges): Set<string>
zoomToThreshold(zoomScale, config): number
zoomToEdgeOpacity(zoomScale): number
cosineSimilarity(a, b): number
```

## Phase 2: Real Graph Filtering

### Problem with MVP

The MVP only dims hidden nodes with opacity - they remain in the force simulation and take up space. This means:
- Hidden nodes still participate in force calculations
- Remaining nodes can't expand into freed space
- No true "progressive disclosure" - just visual dimming

### Solution: Dynamic Simulation Updates

Actually remove filtered nodes from both the D3 simulation and the renderer. When visibility changes:

1. **Filter instantly** - derive visible subset from full graph
2. **Allow relayout** - remaining nodes reorganize to fill space
3. **Preserve positions** - use stored positions when nodes return

### Position Map

Position storage moves from the hook to MapView, tracking ALL nodes (not just visible):

```typescript
const positionMapRef = useRef<Map<string, {x: number, y: number}>>();
```

On every simulation tick, update positions for all visible nodes. When nodes become hidden, their last position is already in the map. When they return, restore from the map.

### Dynamic Renderer

Add `updateData(nodes, links)` method to MapRenderer:

```typescript
function updateData(newNodes: SimNode[], newLinks: SimLink[]) {
  // D3 data join with enter/update/exit
  nodeSelection = nodeSelection.data(newNodes, d => d.id)
    .join(
      enter => /* create new node groups */,
      update => update,
      exit => exit.remove()
    );

  // Same for links
  linkSelection = linkSelection.data(newLinks, d => ...)
    .join(...);
}
```

### Visibility Change Flow

When `semanticZoom.visibleIds` changes:

1. Derive visible nodes/links from full graph
2. Set positions on entering nodes (from position map)
3. Update simulation: `simulation.nodes(visibleNodes)`
4. Update link force: `simulation.force("link").links(visibleLinks)`
5. Update renderer: `renderer.updateData(visibleNodes, visibleLinks)`
6. Re-render without simulation restart (positions are preserved from position map)

**No simulation restart**: Unlike the original design, we don't restart the simulation when visibility changes. Nodes retain their stored positions exactly, providing visual stability. The simulation only runs during initial layout.

### Files Modified (Phase 2)

| File | Changes |
|------|---------|
| `src/lib/map-renderer.ts` | Add `updateData` method with D3 enter/exit |
| `src/components/MapView.tsx` | Position map, visibility change handling |
| `src/hooks/useSemanticZoom.ts` | Remove redundant position storage |

## Consequences

### Positive
- Unified zoom/filter interaction - more intuitive
- No server round-trips for filtering
- Visual stability maintains spatial memory
- Progressive disclosure - detail on demand
- Multi-centroid preserves distinct semantic clusters
- Neighbor inclusion ensures complete local context

### Negative
- Larger API payload (embeddings)
- Client-side computation (fast with 256-dim, <20ms for 700 nodes)
- Learning curve for users expecting pure geometric zoom

## Future Work
- Consider caching focal node computations for smooth zooming
- Add visual indicator showing current semantic focus area
- Extend to UMAP layout mode (currently force simulation only)
