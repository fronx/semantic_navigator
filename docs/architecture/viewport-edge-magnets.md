# Design: Viewport Edge Magnets

**Status**: Implemented (2026-02-07)

## Problem

When exploring the keyword graph, the viewport shows a local region. Keyword nodes outside the viewport that are *connected* to visible nodes are invisible — there's no indication they exist, where they are, or how to navigate to them. This makes spatial exploration feel disconnected: you see a cluster but have no sense of what lies beyond.

## Concept

Continuously render off-screen keyword neighbors at the viewport boundary. Each "pulled" node appears at the edge of the screen, in the direction of its true position — a ghost that shows what's connected just beyond the visible area. Pulled nodes are dimmer and smaller than regular nodes, with visible edges connecting them back to their primary nodes.

Additionally, visible nodes near the viewport edge "fall off a cliff" — they snap to the pull line with pulled visual treatment. This creates a clean inner zone where nodes render normally, and a clear boundary beyond which everything is clamped to the edge.

```
┌────────────────────────────────────────┐
│  pull line                             │   ── pull line (PULL_LINE_PX from edge)
│ ┌────────────────────────────────────┐ │
│ │  cliff boundary                    │ │   -- cliff boundary (CLIFF_START_PX from edge)
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

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Positioning | Viewport edge clamping via ray-AABB | Simple, predictable, preserves direction to real position |
| Trigger | Continuous for all visible nodes | Persistent context, not just on hover |
| Cliff behavior | Visible nodes in margin zone snap to pull line | Clean inner zone boundary; no ambiguous edge-visible nodes |
| Visual treatment (off-screen) | 0.4 opacity, 0.6 scale, reduced labels | Clearly secondary, doesn't compete with primary nodes |
| Visual treatment (cliff) | 0.4 opacity, 0.6 scale, **full-size labels** | Labels remain readable since these are visible/known nodes |
| Edge rendering | Visible edges from primary to pulled | Makes connections explicit |
| Click behavior | Animated camera pan to real position | Navigation aid for both cliff and off-screen nodes |
| Edge type scope | Keyword-to-keyword similarity edges | Content edges are spatially local; keyword edges span distances |
| Recursion guard | Pulled nodes don't attract neighbors | Prevents cascading/infinite expansion |
| Cap | ~20 off-screen pulled nodes max | Avoids clutter; cliff nodes are uncapped (they're already visible) |
| Margin units | Screen pixels (not world units) | Consistent feel at all zoom levels |
| UI proximity | Extra 20px margin on sidebar (left) and header (top) sides | Keeps pulled nodes away from UI chrome boundaries |

## Algorithm

### Per-frame computation (in KeywordNodes useFrame)

**Phase 1 — Compute viewport zones:**
```
viewport = world-space AABB from camera pos + FOV
worldPerPx = visibleWidth / canvasWidth

pullPad = PULL_LINE_PX * worldPerPx        // 50px from viewport edge
cliffPad = CLIFF_START_PX * worldPerPx     // 120px from viewport edge
uiPad = UI_PROXIMITY_PX * worldPerPx       // 20px extra on UI sides

// Asymmetric bounds (extra padding on sidebar-left and header-top)
pullBounds  = viewport shrunk by pullPad  (+uiPad on left/top)
cliffBounds = viewport shrunk by cliffPad (+uiPad on left/top)
```

**Phase 2 — Classify primary nodes:**
```
primarySet = {}
cliffNodeIds = {}
for each node in simNodes:
    if node is inside viewport:
        primarySet.add(node.id)
        if node is outside cliffBounds:
            cliffNodeIds.add(node.id)   // will snap to pull line
```

**Phase 3 — Collect off-screen neighbors:**
```
nodeById = Map from simNodes (for O(1) lookup)
candidates = Map<nodeId, { node, bestSimilarity, connectedPrimaryIds[] }>
for each primaryId in primarySet:
    for each neighbor in adjacencyMap[primaryId]:
        if neighbor.id in primarySet: skip
        // ... accumulate candidates with best similarity
```

**Phase 4 — Cap and clamp off-screen neighbors:**
```
sorted = candidates sorted by bestSimilarity descending
pulledNeighbors = sorted.slice(0, MAX_PULLED)  // cap at 20

for each pulled neighbor:
    clampedPos = clampToBounds(node.realPos, camera, pullBounds)
    pulledMap.set(node.id, { clampedPos, connectedPrimaryIds })
```

**Phase 5 — Cliff nodes snap to pull line:**
```
for each nodeId in cliffNodeIds:
    if already in pulledMap: skip
    clampedPos = clampToBounds(node.realPos, camera, pullBounds)
    pulledMap.set(node.id, { clampedPos, connectedPrimaryIds: [] })
```

Cliff nodes have `connectedPrimaryIds: []` because they ARE primary nodes — this flag is used downstream to distinguish cliff nodes from off-screen pulled nodes (e.g., labels use full size for cliff nodes).

**Phase 6 — Render (modify existing instance loop):**
```
for each node at index i:
    if node.id in pulledMap:
        position = pulledMap[node.id].clampedPos
        scale *= 0.6
        color *= 0.4
    else:
        position = { node.x, node.y }   // real position
    setInstanceMatrix(i, position, scale)
    setInstanceColor(i, color)
```

### Ray-AABB intersection (clampToBounds)

Cast a ray from camera center toward the node's real position. Find the smallest positive `t` where the ray crosses any bound edge. Works for both inward projection (off-screen nodes) and outward projection (cliff nodes snapping to pull line).

```
function clampToBounds(nodeX, nodeY, camX, camY, left, right, bottom, top):
    dx = nodeX - camX
    dy = nodeY - camY

    tMin = Infinity
    if dx > 0: tMin = min(tMin, (right - camX) / dx)
    if dx < 0: tMin = min(tMin, (left - camX) / dx)
    if dy > 0: tMin = min(tMin, (top - camY) / dy)
    if dy < 0: tMin = min(tMin, (bottom - camY) / dy)

    return { x: camX + dx * tMin, y: camY + dy * tMin }
```

For off-screen nodes, `t < 1` (projects inward). For cliff nodes, `t > 1` (projects outward to pull line). Corners are handled naturally.

### Edge rendering to pulled nodes

EdgeRenderer reads `pulledPositionsRef` for position overrides. When one endpoint is in the pulled map, the edge connects to the clamped position instead of the real (off-screen) position.

### Label rendering

Labels read `pulledPositionsRef` to position at clamped coordinates. Off-screen pulled nodes get reduced size (0.6x) and opacity (0.4). Cliff nodes get **full-size labels** at normal opacity — they're repositioned visible nodes, not ghosts.

Distinction: `connectedPrimaryIds.length > 0` → off-screen pulled (dimmed labels). Empty → cliff node (full-size labels).

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
  ├── KeywordEdges
  │     └── EdgeRenderer reads pulledPositionsRef for position overrides
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

| Constant | Value | Unit | Purpose |
|----------|-------|------|---------|
| `PULL_LINE_PX` | 50 | screen px | Distance from viewport edge where pulled nodes are placed |
| `CLIFF_START_PX` | 120 | screen px | Distance from viewport edge where cliff zone begins |
| `UI_PROXIMITY_PX` | 20 | screen px | Extra margin on UI-adjacent sides (left sidebar, top header) |
| `MAX_PULLED_NODES` | 20 | count | Cap on off-screen pulled neighbors (cliff nodes uncapped) |

## Open Questions

1. **Pulled node overlap**: Multiple pulled nodes in similar directions pile up at the viewport edge. Should we add a spacing pass that nudges overlapping pulled nodes apart along the edge?

2. **Content node pulling**: Should off-screen content nodes also get pulled when their parent keyword is visible? Content nodes are spatially close to their parent, so this is less useful. Defer unless it feels needed.

3. **Zoom-level adaptation**: At high zoom (few nodes visible), pulled nodes are more useful. At low zoom (many nodes visible), most neighbors are already on-screen. Should the cap or visual treatment adapt?

4. **Transition animation**: When a pulled node enters the viewport (user pans toward it), should it smoothly transition from clamped-edge position to real position? Or just snap?

## Files Modified

| File | Changes |
|------|---------|
| `src/components/topics-r3f/KeywordNodes.tsx` | Viewport zones, cliff detection, asymmetric pull bounds, clampToBounds, nodeById optimization, click handler fix |
| `src/components/topics-r3f/R3FTopicsScene.tsx` | Adjacency `useMemo`, forward props to KeywordNodes, CameraController, KeywordEdges |
| `src/components/topics-r3f/EdgeRenderer.tsx` | Read `pulledPositionsRef` for position overrides |
| `src/components/topics-r3f/KeywordEdges.tsx` | Pass `pulledPositionsRef` to EdgeRenderer |
| `src/components/topics-r3f/CameraController.tsx` | `flyToRef` prop with animated pan (ease-out cubic, 400ms) |
| `src/components/topics-r3f/R3FTopicsCanvas.tsx` | Create `flyToRef` + `pulledPositionsRef`, wire through to scene |
| `src/components/topics-r3f/R3FLabelContext.tsx` | Add `pulledPositionsRef` to `LabelRefs` |
| `src/lib/label-overlays.ts` | Position override for pulled nodes, cliff vs off-screen label treatment |
| `src/components/topics-r3f/LabelsOverlay.tsx` | Pass `getPulledPositions` getter to label manager |

## Implementation Notes

**Cliff behavior**: Nodes in the cliff zone (between `CLIFF_START_PX` and viewport edge) snap to the pull line (`PULL_LINE_PX` from edge). All visible nodes — including cliff nodes — remain in `primarySet` so they still trigger neighbor pulling. The distinction between cliff nodes and off-screen pulled nodes is encoded via `connectedPrimaryIds`: cliff nodes have an empty array (they're primary themselves), off-screen nodes list the primary nodes that pulled them.

**UI-aware asymmetric padding**: The left (sidebar) and top (header) edges get `UI_PROXIMITY_PX` extra margin. This keeps pulled nodes visually separated from UI chrome even though the canvas doesn't extend behind the sidebar (flex layout). The asymmetry applies to both the pull line and the cliff boundary.

**Screen-pixel margins**: All margin constants are in screen pixels, converted to world units per frame via `worldPerPx = visibleWidth / canvasWidth`. This ensures the cliff zone and pull line feel the same size regardless of zoom level — unlike the original world-unit `PULLED_PADDING` which varied from 5% to 20% of the viewport depending on zoom.
