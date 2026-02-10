# Design: Edge Pulling

**Status**: Implemented (2026-02-07)

## Problem

When exploring the keyword graph, the viewport shows a local region. Keyword nodes outside the viewport that are *connected* to visible nodes are invisible — there's no indication they exist, where they are, or how to navigate to them. This makes spatial exploration feel disconnected: you see a cluster but have no sense of what lies beyond.

## Concept

Edge pulling continuously renders off-screen keyword neighbors at the viewport boundary. Each "pulled" node appears at the edge of the screen, in the direction of its true position — a ghost that shows what's connected just beyond the visible area. Pulled nodes are dimmer and smaller than regular nodes, with visible edges connecting them back to their primary nodes.

Additionally, visible nodes near the viewport edge "fall off a cliff" — they snap to the pull line with pulled visual treatment. This creates a clean inner zone where nodes render normally, and a clear boundary beyond which everything is clamped to the edge.

```
┌────────────────────────────────────────┐
│  pull line                             │   ── pull line (PULL_LINE_PX from edge)
│ ┌────────────────────────────────────┐ │
│ │  cliff boundary                    │ │   -- identical to pull line (conversion happens at the line)
│ │ ┌────────────────────────────────┐ │ │
│ │ │                                │ │ │
│ │ │    A ─────── B                 │ │ │   A, B, C: inner primary nodes
│ │ │                \               │ │ │   (normal rendering, full size)
│ │ │                 C              │ │ │
│ │ │                                │ │ │
│ │ └────────────────────────────────┘ │ │
│ │  cliff zone: visible nodes here    │ │   Nodes that drift into the cliff zone
│ │  snap to the pull line             │ │   snap outward to the pull line
│ └────────────────────────────────────┘ │
│ ·D· · · · · · · · · · · · · · · ·F·   │   ·D, ·F: off-screen neighbors
│                                   ·G·  │   pulled to edge (dimmed, smaller)
└────────────────────────────────────────┘

── solid line    primary ↔ primary edge
·· dotted line   primary ↔ pulled edge (dimmed)
·X· small dot    pulled node (dimmed, smaller)
```

Clicking any pulled node (cliff or off-screen) pans the camera to its real position.

## Fisheye Compression for Focus Mode

**Added**: 2026-02-10

When focus mode is active (user clicks a keyword), focused keywords use **fisheye compression** instead of hard clamping to viewport edges. This creates a smoother, more continuous visual experience.

### Fisheye vs Regular Clamping

**Regular clamping** (used for non-focused keywords and content):
- Off-screen nodes snap to exact viewport edge via ray-AABB intersection
- Cliff-zone nodes snap outward to pull line
- Discrete boundary behavior - nodes are either "in" or "pulled"

**Fisheye compression** (used for focused keywords in focus mode):
- Smooth radial compression from camera center
- No snapping - continuous gradient of positions
- Near center: nodes stay at natural positions
- Farther out: nodes smoothly compress into an inner ring
- Asymptotic function ensures nodes never exceed viewport bounds

### How It Works

```
                viewport edge (25px from screen edge)
                │
maxRadius ──────┤
            ····│····  ← asymptotic compression zone
          ··    │    ··
        ··      │      ··   Nodes compress smoothly
      ··        │        ··  toward maxRadius but never
    ··          │          ··  exceed it (asymptotic)
   ·            │            ·
   ·  compressionStartRadius  ·
   ·    ┌───────┼───────┐    ·
   ·    │       │       │    ·
   ·    │       ●       │    ·  ← camera center
   ·    │   (natural   │    ·
   ·    │   positions) │    ·    No compression
   ·    └───────┼───────┘    ·    in this zone
   ·            │            ·
    ··          │          ··
      ··        │        ··
        ··      │      ··
          ··    │    ··
            ····│····
                │
```

**Key zones:**
- **Inner zone** (r < compressionStartRadius = 80px from edge): No compression, nodes at natural positions
- **Compression zone** (r >= compressionStartRadius): Smooth asymptotic compression toward maxRadius
- **maxRadius** (25px from edge): Outer boundary, never exceeded

### Implementation

Fisheye compression is implemented in `src/lib/fisheye-viewport.ts`:

```typescript
const compressed = applyFisheyeCompression(
  nodeX, nodeY,           // Natural position
  camX, camY,             // Camera center
  compressionStartRadius, // 80px from edge (focus pull zone)
  maxRadius              // 25px from edge (regular pull zone)
);
```

The asymptotic function `compressed = start + range * (excess / (excess + scale))` guarantees output stays within `maxRadius` for any input distance.

After compression, positions are clamped to rectangular pull bounds (fisheye is radial, viewport is rectangular) to handle edge cases.

### When Fisheye is Applied

Fisheye compression is applied to:
- ✅ **Focused keywords** when focus mode is active
- ✅ **Content nodes** whose parent keywords are focused
- ❌ Non-focused keywords (use regular clamping)
- ❌ Content of non-focused keywords

See `src/lib/keyword-pull-state.ts` and `src/lib/content-pull-state.ts` for usage.

**Further reading:** See [Fisheye Compression Pattern](../patterns/fisheye-compression.md) for detailed explanation and usage patterns.

## Design Decisions

| Decision                      | Choice                                                                   | Rationale                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Positioning                   | Viewport edge clamping via ray-AABB                                      | Simple, predictable, preserves direction to real position                                              |
| Trigger                       | Continuous for all visible nodes                                         | Persistent context, not just on hover                                                                  |
| Cliff behavior                | Visible nodes in margin zone snap to pull line and leave the primary set | Clean inner zone boundary; pulled nodes only persist when anchored to interior primaries               |
| Overscan                      | Margin detection extends 80px past visible edge                          | Prevents nodes from popping back to full size right at the window edge                                 |
| Visual treatment (off-screen) | 0.4 opacity, 0.6 scale, reduced labels                                   | Clearly secondary, doesn't compete with primary nodes                                                  |
| Visual treatment (cliff)      | 0.4 opacity, 0.6 scale (same as off-screen)                              | Seamless transition — cliff nodes become pulled immediately                                            |
| Edge rendering                | Hide edges only when **both** endpoints are non-primary pulled nodes     | Ensures every pulled ghost shows at least one inward connection while preventing off-screen-only lines |
| Click behavior                | Animated camera pan to real position                                     | Navigation aid for both cliff and off-screen nodes                                                     |
| Edge type scope               | Keyword-to-keyword similarity edges                                      | Content edges are spatially local; keyword edges span distances                                        |
| Recursion guard               | Pulled nodes don't attract neighbors                                     | Prevents cascading/infinite expansion                                                                  |
| Cap                           | ~20 off-screen pulled nodes max                                          | Avoids clutter; cliff nodes are uncapped (they're already visible)                                     |
| Margin units                  | Screen pixels (not world units)                                          | Consistent feel at all zoom levels                                                                     |
| UI proximity                  | Extra 20px margin on sidebar (left) and header (top) sides               | Keeps pulled nodes away from UI chrome boundaries                                                      |

## Algorithm

### Per-frame computation (in KeywordNodes useFrame)

**Phase 1 — Compute viewport zones:** Calculate the world-space viewport AABB from camera position and FOV. Convert screen-pixel margin constants to world units by computing the ratio of visible width to canvas width. Create the pull line (where pulled nodes are placed) and mirror it for the cliff boundary so the transition happens exactly on that line. Add an 80px overscan outside the visible window when determining whether a node still counts as "visible" — this keeps margin behavior continuous even as the camera moves. Both boundaries include asymmetric extra padding on the left and top sides to account for UI chrome.

**Phase 2 — Classify primary nodes:** Iterate through all keyword nodes and identify those that fall *inside* the pull bounds (`primarySet`). Nodes that drift into the margin (outside the pull bounds but still within the viewport) exit the primary set immediately so they no longer recruit additional neighbors.

**Phase 3 — Collect off-screen neighbors:** Build a lookup map for O(1) node access. For each primary node, examine its neighbors via the adjacency map. Collect off-screen neighbors (those not in the primary set) as candidates, tracking the best similarity score and which primary nodes connect to each candidate.

**Phase 4 — Cap and clamp off-screen neighbors:** Sort candidates by similarity descending and cap at MAX_PULLED_NODES. For each pulled neighbor, use ray-AABB intersection to clamp its position to the pull bounds, projecting from camera center toward the node's real position. Store the clamped position along with the list of connected primary IDs.

**Phase 5 — Cliff nodes snap to pull line:** For each cliff node ID, skip if already in the pulled map (some might be off-screen neighbors too). Otherwise, clamp the node's position to the pull bounds using the same ray-AABB method. After clamping, attempt to look up inward anchors via the adjacency map; if none exist, drop the node entirely. Cliff nodes now share the same visual treatment as off-screen pulled nodes — the only difference is that their `connectedPrimaryIds` are populated lazily based on whichever interior nodes still connect to them.

**Phase 6 — Render:** During the instance update loop, check if each node is in the pulled map. If pulled, use the clamped position and apply reduced scale (0.6x) and opacity (0.4x). Otherwise, use the node's real simulated position. Update instance matrices and colors accordingly.

### Ray-AABB intersection (clampToBounds)

The clamping algorithm casts a ray from camera center toward the node's real position and finds the smallest positive parameter where the ray crosses any boundary edge. This works for both inward projection (off-screen nodes) and outward projection (cliff nodes snapping to pull line). The algorithm computes the direction vector from camera to node, then tests intersection with each boundary edge (left, right, bottom, top) by dividing the distance to each boundary by the corresponding direction component. The minimum positive parameter gives the intersection point. For off-screen nodes, the parameter is less than 1 (projects inward). For cliff nodes, it's greater than 1 (projects outward to pull line). Corner cases are handled naturally by the minimum operation.

### Edge rendering to pulled nodes

EdgeRenderer reads `pulledPositionsRef` each frame. It only omits an edge when **both** endpoints are non-primary pulled nodes (e.g., two off-screen ghosts). Otherwise it renders the edge using the clamped coordinates, so every pulled node still shows an inward connection while no geometry extends past the screen.

### Label rendering

Labels read `pulledPositionsRef` to position at clamped coordinates. All pulled nodes — whether they originated off-screen or slid into the cliff — share the same reduced size (0.6x) and opacity (0.4). `connectedPrimaryIds` is still recorded so downstream consumers know which primary nodes exposed an off-screen neighbor, but it no longer drives label styling.

### Content node pulling (ContentNodes useFrame)

Content nodes follow a simpler pulling model than keywords:
- **No cliff behavior**: Content nodes don't snap when near the viewport edge
- **Parent-based visibility**: Content nodes only render if at least one parent keyword is visible (primary)
- **Off-screen pulling**: Content nodes with visible parents but off-screen positions get pulled to viewport edge
- **Focus mode constraint** (2026-02-09): Content nodes whose ALL parents are margin-pushed (focus mode) are excluded even if content-driven mode would show them. See "Content-Driven Mode and Focus Mode Interaction" below.

**Phase 1 — Compute viewport zones:** Calculate the viewport and pull bounds using the same approach as keywords, but skip computing the cliff boundary since content nodes don't have cliff behavior.

**Phase 2 — Build visible keyword set:** Iterate through all keyword nodes and collect IDs of those within the viewport. This set determines which content nodes are eligible for rendering.

**Phase 3 — Classify content nodes:** For each content node, check if any parent keyword ID is in the visible set. If no visible parents exist, the content node is hidden (scale set to zero). If the content node has visible parents but is itself off-screen, add it to pulled candidates.

**Phase 4 — Cap and clamp:** Limit pulled candidates to MAX_PULLED_CONTENT_NODES. For each pulled content node, clamp its position to the pull bounds using ray-AABB intersection. Store both the clamped position (for rendering) and real position (for proximity calculations).

**Phase 5 — Render:** During the instance update loop, skip nodes with no visible parents (already hidden). For pulled nodes, use the clamped position and apply reduced scale (0.6x) and opacity (0.4x). For normal visible nodes, use their real simulated position. Update contentScreenRectsRef with the appropriate position for label rendering.

**Key differences from keywords:** Content nodes lack cliff behavior (simpler logic), visibility is gated by parent keyword visibility (parent-child relationship), and pulled content uses real position for proximity-based focus scaling rather than clamped position.

### Content edge rendering

Content edges (keyword → content node) support pulled positions for both endpoints:
- If the parent keyword is pulled/cliff, the edge starts from its clamped position
- If the content node is pulled, the edge ends at its clamped position
- ContentEdges merges `pulledPositionsRef` (keywords) and `pulledContentPositionsRef` (content) into a combined map for EdgeRenderer

This ensures edges correctly connect to margin nodes at the viewport boundary, making the parent-child relationship visible even when nodes are off-screen.

## Data Flow

```
edges (prop)
  │
  ▼
R3FTopicsScene
  ├── adjacencyMap = useMemo(buildAdjacency(edges))
  │
  ├── KeywordNodes
  │     ├── useFrame: zones → classify → neighbors → cap/clamp → cliff → render
  │     ├── writes pulledPositionsRef (shared with edges + labels)
  │     └── onClick: if pulled → flyTo(realPos), else → onKeywordClick
  │
  ├── ContentNodes
  │     ├── useFrame: zones → visible keywords → classify content → cap/clamp → render
  │     └── writes pulledContentPositionsRef (shared with content edges)
  │
  ├── KeywordEdges
  │     └── EdgeRenderer reads pulledPositionsRef for position overrides
  │
  ├── ContentEdges
  │     ├── merges pulledPositionsRef + pulledContentPositionsRef
  │     └── EdgeRenderer reads combined map for position overrides
  │
  └── CameraController
        └── flyToRef(x, y) → animated pan (ease-out cubic, 400ms)
```

## Performance Considerations

- **Adjacency map**: Built once via `useMemo` when edges change. O(E) construction.
- **Node lookup by ID**: `nodeById` Map built once per frame. O(N) construction, O(1) lookups (replaces O(N) `find` calls).
- **Per-frame primary classification**: O(N) where N = keyword count. Simple AABB check per node.
- **Per-frame neighbor collection**: O(sum of degrees of primary nodes). Typically ~500 lookups. Negligible.
- **No React re-renders**: Everything is ref-driven in useFrame. Label system reads refs imperatively.
- **Screen-pixel margins**: `worldPerPx` conversion is one division per frame — negligible.

## Constants

| Constant                   | Value | Unit      | Purpose                                                                            |
| -------------------------- | ----- | --------- | ---------------------------------------------------------------------------------- |
| `PULL_LINE_PX`             | 50    | screen px | Distance from viewport edge where pulled nodes are placed                          |
| `UI_PROXIMITY_PX`          | 20    | screen px | Extra margin on UI-adjacent sides (left sidebar, top header)                       |
| `VIEWPORT_OVERSCAN_PX`     | 80    | screen px | Extends the "visible" test beyond the window so margin nodes never pop at the edge |
| `MAX_PULLED_NODES`         | 20    | count     | Cap on off-screen pulled keyword neighbors (cliff nodes uncapped)                  |
| `MAX_PULLED_CONTENT_NODES` | 20    | count     | Cap on off-screen pulled content nodes                                             |

## Open Questions

1. **Pulled node overlap**: Multiple pulled nodes in similar directions pile up at the viewport edge. Should we add a spacing pass that nudges overlapping pulled nodes apart along the edge?

2. **Zoom-level adaptation**: At high zoom (few nodes visible), pulled nodes are more useful. At low zoom (many nodes visible), most neighbors are already on-screen. Should the cap or visual treatment adapt?

3. **Transition animation**: When a pulled node enters the viewport (user pans toward it), should it smoothly transition from clamped-edge position to real position? Or just snap?

## Files Modified

| File                                             | Changes                                                                                                                                                   |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/edge-pulling.ts`                        | **Shared utilities**: `computeViewportZones`, `clampToBounds`, `isInViewport`, `isInCliffZone`, constants (2026-02-07)                                    |
| `src/components/topics-r3f/KeywordNodes.tsx`     | Viewport zones, cliff detection, asymmetric pull bounds, nodeById optimization, click handler fix. Uses shared utilities.                                 |
| `src/components/topics-r3f/ContentNodes.tsx`     | Viewport zones, parent-based visibility filtering, off-screen content pulling, writes to `pulledContentPositionsRef`. Uses shared utilities. (2026-02-07) |
| `src/components/topics-r3f/ContentEdges.tsx`     | Merge keyword and content pulled positions, pass combined map to EdgeRenderer for correct edge endpoints (2026-02-07)                                     |
| `src/components/topics-r3f/R3FTopicsScene.tsx`   | Adjacency `useMemo`, forward props to KeywordNodes, CameraController, KeywordEdges, pass pulled refs to ContentNodes/ContentEdges (2026-02-07)            |
| `src/components/topics-r3f/EdgeRenderer.tsx`     | Read `pulledPositionsRef` for position overrides                                                                                                          |
| `src/components/topics-r3f/KeywordEdges.tsx`     | Pass `pulledPositionsRef` to EdgeRenderer                                                                                                                 |
| `src/components/topics-r3f/CameraController.tsx` | `flyToRef` prop with animated pan (ease-out cubic, 400ms)                                                                                                 |
| `src/components/topics-r3f/R3FTopicsCanvas.tsx`  | Create `flyToRef`, `pulledPositionsRef`, `pulledContentPositionsRef`, wire through to scene (2026-02-07)                                                  |
| `src/components/topics-r3f/R3FLabelContext.tsx`  | Add `pulledPositionsRef` and `pulledContentPositionsRef` to `LabelRefs` (2026-02-07)                                                                      |
| `src/lib/label-overlays.ts`                      | Position override for pulled nodes, cliff vs off-screen label treatment                                                                                   |
| `src/components/topics-r3f/LabelsOverlay.tsx`    | Pass `getPulledPositions` getter to label manager                                                                                                         |

## Implementation Notes

**Shared utilities** (`src/lib/edge-pulling.ts`): Both KeywordNodes and ContentNodes use shared utilities to maximize code reuse:
- `computeViewportZones()`: Computes viewport, pull bounds, and cliff bounds in one call
- `clampToBounds()`: Ray-AABB intersection for clamping positions to viewport edge
- `isInViewport()`, `isInCliffZone()`: Boundary checking helpers
- Constants: `PULL_LINE_PX`, `UI_PROXIMITY_PX`, `MAX_PULLED_NODES`, `MAX_PULLED_CONTENT_NODES`

This centralization ensures consistent behavior, reduces duplication, and makes future adjustments easier.

**Cliff behavior**: Nodes that cross into the margin immediately snap to the pull line (the pull bounds double as the cliff boundary). Once a node snaps, it leaves the primary set and only stays visible if it can prove at least one inward connection to an interior primary. This prevents chains of cliff-only ghosts: every pulled node must surface an explicit interior anchor via `connectedPrimaryIds`.

**UI-aware asymmetric padding**: The left (sidebar) and top (header) edges get `UI_PROXIMITY_PX` extra margin. This keeps pulled nodes visually separated from UI chrome even though the canvas doesn't extend behind the sidebar (flex layout). The asymmetry applies to both the pull line and the cliff boundary.

**Screen-pixel margins**: All margin constants are in screen pixels, converted to world units per frame via `worldPerPx = visibleWidth / canvasWidth`. This ensures the cliff zone and pull line feel the same size regardless of zoom level — unlike the original world-unit `PULLED_PADDING` which varied from 5% to 20% of the viewport depending on zoom.

## Content-Driven Mode and Focus Mode Interaction

**Added**: 2026-02-09

### Problem

Content-driven mode and focus mode have competing goals:
- **Content-driven mode**: When zoomed in past "Full" threshold, content cards in the viewport can pull their parent keywords visible (even if off-screen)
- **Focus mode**: When a keyword is focused, only that keyword + 1-3 hop neighbors should be displayable; everything else (margin keywords) is pushed to viewport edges

**Bug**: Content-driven mode was pulling in margin keywords and showing their content, creating orphaned content cards with no visible parent keywords.

### Solution

**Two-layer filtering** ensures content-driven mode respects focus boundaries:

**Layer 1: Loading Filter** ([src/components/TopicsView.tsx](src/components/TopicsView.tsx))
```typescript
// visibleKeywordIds excludes margin keywords when focus is active
const visibleKeywordIds = useMemo(() => {
  return computeVisibleKeywordIds(activeNodes, chunkKeywordIds, focusState);
}, [activeNodes, chunkKeywordIds, focusState]);
```

Prevents content from loading for margin keywords in the first place.

**Layer 2: Rendering Filter** ([src/components/topics-r3f/ContentNodes.tsx](src/components/topics-r3f/ContentNodes.tsx))
```typescript
// Content whose ALL parents are margin-pushed is hidden
const allMarginParents = identifyAllMarginParents(contentNodes, focusPositions);
const isVisible = (hasVisibleParent || isContentDriven) && !allParentsPushed;
```

Catches race conditions (content loaded before focus activated) and prevents content-driven mode from showing orphaned content.

### Behavior

**Without focus mode**: Content-driven mode works as designed — content in viewport can pull parent keywords visible from off-screen.

**With focus mode active**:
- Content is only loaded for focused keywords (not margin)
- Content with at least one focused parent remains visible (multi-parent chunks)
- Content whose ALL parents are margin-pushed is hidden, even if:
  - The content node is in the viewport
  - Content-driven mode is active
  - The parent keywords would normally be pulled visible

### Implementation

**Utility functions** ([src/lib/focus-mode-content-filter.ts](src/lib/focus-mode-content-filter.ts)):
- `computeVisibleKeywordIds()`: Filters keyword IDs for content loading
- `identifyAllMarginParents()`: Identifies content to exclude from rendering

**Tests**: `src/lib/__tests__/focus-mode-content-filtering.test.ts` (17 tests)

### Edge Cases

1. **Multi-parent chunks**: A chunk connected to keywords A (focused) and B (margin) remains visible because A is focused
2. **Race condition**: Content loaded before focus activation is caught by rendering filter
3. **Transition smoothness**: Loading filter stops new content immediately, rendering filter hides existing content
4. **Focus exit**: Content gradually loads as expected when focus is cleared
