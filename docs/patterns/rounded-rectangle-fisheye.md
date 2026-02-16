# Rounded Rectangle Fisheye Compression

## Problem

The original hyperbolic fisheye compression creates a **circular horizon** (asymptotic boundary) because it uses Euclidean distance from the camera center:

```typescript
const distance = Math.sqrt(dx * dx + dy * dy);
// Compress toward a single maxRadius
```

This means:
- Points at the top/bottom/left/right edges reach the horizon at the same distance as diagonal corners
- The compressed content forms a circle, leaving unused space in the corners of a rectangular viewport
- The viewport is not fully utilized

**Goal:** Make the asymptotic horizon a **rounded rectangle** that exactly fills the viewport, maximizing screen space usage.

## Solution: Directional Horizon Distance

Instead of using a single circular `maxRadius`, we compute a **per-direction horizon distance** that varies based on the direction from camera to node.

### Key Insight

The compression algorithm has two independent concerns:

1. **Distance along ray**: How far the node is from camera (radial distance)
2. **Horizon distance**: How far we can go in that direction before hitting the boundary

By making (2) directional while keeping (1) radial, we can use any horizon shape while preserving the smooth tanh-based compression.

### Approach: Lp Norm (Squircle Approximation)

We use an **Lp norm** with `p ≈ 6` to approximate a rounded rectangle:

```
‖v‖_p = (|x|^p + |y|^p)^(1/p)
```

Where:
- `p = 2` → circle
- `p → ∞` → axis-aligned square (Chebyshev distance)
- `p = 6` → rounded rectangle / "squircle"

This gives us a smooth, continuous distance metric that approximates a rounded rectangle without the complexity of exact ray-rectangle intersection.

## Mathematical Formulation

### Current (Circular) Implementation

```typescript
// 1. Compute Euclidean distance
const distance = sqrt(dx² + dy²)

// 2. Compress toward single maxRadius
if (distance > compressionStartRadius) {
  compressedDistance = applyCompressionToDistance(
    distance,
    compressionStartRadius,
    maxRadius,  // Same for all directions
    strength
  )
}

// 3. Scale back along ray
const ratio = compressedDistance / distance
return { x: camX + dx * ratio, y: camY + dy * ratio }
```

### New (Rounded Rectangle) Implementation

```typescript
// 1. Compute Euclidean distance (unchanged)
const distance = sqrt(dx² + dy²)

// 2. Compute directional horizon using Lp norm
const halfWidth = pullBounds.right - camX   // World units
const halfHeight = pullBounds.top - camY    // World units

// Normalize direction to viewport aspect
const nx = dx / halfWidth
const ny = dy / halfHeight

// Lp norm distance (dimensionless, 1.0 = at horizon)
const lpDistance = (|nx|^p + |ny|^p)^(1/p)

// Scale back to world units along this direction
const horizonDistance = distance / lpDistance

// Similarly for compression start
const startHalfWidth = focusPullBounds.right - camX
const startHalfHeight = focusPullBounds.top - camY
const snx = dx / startHalfWidth
const sny = dy / startHalfHeight
const startLpDistance = (|snx|^p + |sny|^p)^(1/p)
const compressionStartDistance = distance / startLpDistance

// 3. Compress toward directional horizon
if (distance > compressionStartDistance) {
  compressedDistance = applyCompressionToDistance(
    distance,
    compressionStartDistance,  // Directional
    horizonDistance,           // Directional
    strength
  )
}

// 4. Scale back along ray (unchanged)
const ratio = compressedDistance / distance
return { x: camX + dx * ratio, y: camY + dy * ratio }
```

## Key Properties

### Continuity
The Lp norm is smooth and continuous for `p > 1`, ensuring no directional discontinuities as nodes move around the viewport.

### Asymptotic Behavior
- When `lpDistance → 1`, the point approaches the viewport boundary in that direction
- The tanh compression ensures the point asymptotically approaches but never exceeds the boundary
- Different directions have different horizon distances, but all compress smoothly

### Aspect Ratio Handling
By normalizing with viewport half-extents (`halfWidth`, `halfHeight`), the Lp norm automatically adapts to non-square viewports:
- Wider viewports: horizon extends farther horizontally
- Taller viewports: horizon extends farther vertically

### Viewport-Relative
The horizon is defined relative to the **viewport bounds**, so it moves with camera panning. Content always fills the screen regardless of camera position.

## Implementation Details

### Coordinate Spaces
All systems are in the same **world-space coordinate system**:
- Node positions: World-space (UMAP layout, centered on origin, radius ~500)
- Camera position: World-space (Three.js camera.position)
- Viewport bounds: World-space (derived from camera FOV and canvas size)

No coordinate conversion is needed.

### Choosing p

The exponent `p` controls the "roundness" of the rectangle:

| p | Shape | Trade-offs |
|---|-------|-----------|
| 2 | Circle | Current behavior (not useful here) |
| 4 | Gentle squircle | Very rounded corners, some corner space wasted |
| 6 | Balanced squircle | **Recommended**: Good balance of space usage and smoothness |
| 8 | Sharp squircle | More rectangular, but still smooth transitions |
| ∞ | Square | Maximum space usage, but requires Chebyshev distance (different formula) |

**Recommendation:** Start with `p = 6`. It provides good space utilization while maintaining smooth compression and rounded corners that match typical viewport aesthetics.

### Performance
The Lp norm approach is very efficient:
- No branches or conditionals (except the initial compression check)
- No expensive operations beyond the existing sqrt
- Two additional `pow` operations per axis: `|nx|^p` and `|ny|^p`
- Modern JS engines optimize `Math.pow` well for small integer exponents

For `p = 6`:
```typescript
const nx6 = Math.abs(nx) ** 6;  // Can use ** operator
const ny6 = Math.abs(ny) ** 6;
const lpDistance = (nx6 + ny6) ** (1/6);
```

Can be optimized with repeated multiplication:
```typescript
const nx2 = nx * nx;
const nx6 = nx2 * nx2 * nx2;
// Similar for ny
```

## Alternative Approaches (Not Chosen)

### Ray-Rounded-Rectangle Intersection
**More exact**, but more complex:
- Requires intersecting ray with rounded rectangle geometry
- Needs branch logic for corner regions vs. straight edges
- Slightly more expensive (quadratic solve for corner circles)

**Why we didn't choose it:** The Lp norm approximation is "close enough" and much simpler. The difference is not visually significant for a fisheye effect.

### SDF-Based (Signed Distance Function)
**Doesn't preserve direction:**
- SDF gives shortest distance to boundary, not distance along ray
- Would distort positions in non-intuitive ways
- Not suitable for this use case

## Testing & Validation

To verify the implementation works correctly:

1. **Visual inspection:** The compressed content should fill the viewport edge-to-edge with rounded corners
2. **No overflow:** No nodes should render outside viewport bounds (check with extreme zoom/pan)
3. **Smooth transitions:** No popping or discontinuities as nodes move between directions
4. **Aspect ratio:** Test with different viewport aspect ratios (wide, tall, square)
5. **Camera panning:** Horizon should move with camera, content should stay within bounds

## References

- [PAL consultation response](../../investigations/) - Mathematical derivation and approach comparison
- [Coordinate space investigation](../../investigations/) - Verification that all systems are in same space
- Original circular fisheye: [`src/lib/fisheye-viewport.ts`](../../src/lib/fisheye-viewport.ts)
- Hyperbolic compression: [`src/lib/hyperbolic-compression.ts`](../../src/lib/hyperbolic-compression.ts)
