# ADR 007: Lombardi-Style Curved Edges

## Status
Accepted (updated)

## Context
The map visualization uses edges to connect articles/chunks to keywords. Straight-line edges can overlap and create visual clutter, especially when multiple edges run parallel between nearby nodes.

We explored the paper "Force-Directed Lombardi-Style Graph Drawing" (Chernobelskiy et al.) for inspiration on improving edge aesthetics.

## Key Insights from the Paper

### What is a Lombardi Drawing?
Named after artist Mark Lombardi, whose social network drawings use circular arcs for edges with aesthetically pleasing angular resolution at vertices.

### Two Approaches Described

1. **Tangent-based**: Each vertex has fixed tangent angles; forces rotate vertices and adjust positions to make arcs feasible. Better for angular resolution but more complex.

2. **Dummy-vertex**: Simpler two-phase approach:
   - Phase 1: Standard force-directed layout positions vertices
   - Phase 2: Add a "dummy vertex" at each edge midpoint, let it move along the perpendicular bisector via repulsion forces

### Key Mathematical Insight
> "Once the endpoints of an edge have been placed, only one more point is required to uniquely determine a circular arc. We can describe all possible arcs between nodes by the set of points along the perpendicular bisector of their straight-line connection."

This means: given two endpoints, any point on the perpendicular bisector defines a unique arc through both endpoints.

## Decision

### Phase 1: Basic Curved Edges (completed)
We implemented a simplified version of the dummy-vertex approach:

1. **No simulation for dummy vertices** - Instead of running forces, we use a fixed offset percentage
2. **User-adjustable intensity** - Slider from 0% (straight) to 30% (noticeably curved)

### Phase 2: Angular Resolution Optimization (completed)
Instead of using arbitrary ID comparison to determine curve direction, we now optimize for angular resolution:

1. For each node, sort incident edges by angle (using atan2)
2. Assign alternating curve directions to adjacent edges
3. When endpoints disagree on direction, the higher-degree node wins (hub keywords get priority)

This spreads edges evenly around high-degree nodes rather than letting them bunch up.

### Phase 3: True Circular Arcs (completed)
Switching from quadratic Bezier curves to true circular arcs using SVG `A` command.

**Why circular arcs?**
- Lombardi's original drawings use circular arcs, not Bezier curves
- Circular arcs have constant curvature (more elegant)
- Better mathematical foundation for future angular resolution work

**Math:** Given chord length L and sagitta h (perpendicular offset from chord midpoint to arc apex):
```
radius = (L²/4 + h²) / (2|h|)
```

**Algorithm:**
```
For edge from (x1, y1) to (x2, y2) with direction d:
1. Chord length: L = sqrt((x2-x1)² + (y2-y1)²)
2. Sagitta: h = L * intensity * d
3. Radius: r = (L²/4 + h²) / (2|h|)
4. Sweep flag: determines arc direction (based on sign of h)
5. SVG path: M x1,y1 A r,r 0 0,sweep x2,y2
```

### Phase 4: Curve Direction Methods (current)
Added user-selectable methods for determining curve direction, balancing two competing goals:
- **Angular resolution**: Edges should spread apart around high-degree nodes
- **Convex appearance**: Edges on the periphery should bow outward

**Three methods available:**

1. **Outward (convex)**: All edges curve away from the global centroid of all nodes. Guarantees convex appearance on the periphery but ignores angular resolution.

2. **Angular resolution**: For each node, edges are sorted by angle and assigned alternating directions (1, -1, 1, -1...). When endpoints disagree, the higher-degree node wins. Optimizes for spreading edges at vertices but can create concave curves on the outside.

3. **Hybrid** (default): Uses angular resolution voting, but when endpoints conflict and neither is a clear hub (degree ratio < 2x), falls back to outward direction. Balances both goals.

**Implementation:** `computeEdgeCurveDirections()` in [map-renderer.ts](../../../src/lib/map-renderer.ts)

## Consequences

### Positive
- Edges have a more organic, hand-drawn aesthetic
- Adjacent edges spread apart (angular resolution optimization)
- True circular arcs match Lombardi's artistic style
- Minimal performance impact (simple math per edge)
- User can disable by setting intensity to 0
- User can choose curve direction method via UI dropdown

### Negative
- Fixed curve intensity rather than dynamic repulsion
- Trade-off between angular resolution and convex appearance (no perfect solution)

## Future Enhancements
If needed, could implement:
- Dynamic curve intensity based on edge density
- Full tangent-based approach for perfect angular resolution
- Edge bundling for high-density regions
- Per-community centroids for better outward direction in multi-cluster graphs

## References
- Chernobelskiy et al., "Force-Directed Lombardi-Style Graph Drawing"
- Implementation: [src/lib/map-renderer.ts](../../../src/lib/map-renderer.ts) - `computeCurvedPath()`
