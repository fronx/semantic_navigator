# ADR 007: Lombardi-Style Curved Edges

## Status
Accepted

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
We implemented a simplified version of the dummy-vertex approach:

1. **No simulation for dummy vertices** - Instead of running forces, we use a fixed offset percentage
2. **Quadratic Bezier curves** - SVG `Q` command (not true circular arcs, but visually similar)
3. **Alternating direction** - Compare source/target IDs to decide curve direction, preventing parallel edge overlap
4. **User-adjustable intensity** - Slider from 0% (straight) to 30% (noticeably curved)

### Algorithm
```
For edge from (x1, y1) to (x2, y2):
1. Midpoint: mx = (x1 + x2) / 2, my = (y1 + y2) / 2
2. Edge vector: dx = x2 - x1, dy = y2 - y1
3. Length: L = sqrt(dx² + dy²)
4. Perpendicular unit vector: px = -dy/L, py = dx/L
5. Direction sign: sign = (sourceId < targetId) ? 1 : -1
6. Control point: cx = mx + px * L * intensity * sign
                  cy = my + py * L * intensity * sign
7. SVG path: M x1,y1 Q cx,cy x2,y2
```

## Consequences

### Positive
- Edges have a more organic, hand-drawn aesthetic
- Parallel edges no longer overlap (they curve opposite directions)
- Minimal performance impact (simple math per edge)
- User can disable by setting intensity to 0

### Negative
- Not true circular arcs (Bezier approximation)
- No angular resolution optimization at vertices
- Fixed curve intensity rather than dynamic repulsion

## Future Enhancements
If needed, could implement:
- True circular arc paths (SVG `A` command)
- Dynamic curve intensity based on edge density
- Tangent-based approach for better angular resolution
- Edge bundling for high-density regions

## References
- Chernobelskiy et al., "Force-Directed Lombardi-Style Graph Drawing"
- Implementation: [src/lib/map-renderer.ts](../../../src/lib/map-renderer.ts) - `computeCurvedPath()`
