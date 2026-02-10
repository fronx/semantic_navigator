# Pattern: Fisheye Viewport Compression

**Location:** `src/lib/fisheye-viewport.ts`
**Used by:** Focus mode (keyword and content node positioning)
**Related:** [Edge Pulling Architecture](../architecture/edge-pulling.md)

## Problem

When a user focuses on a keyword in the graph, we want to keep all focused keywords visible on screen, even when they're naturally positioned far apart. Simple approaches have issues:

- **Hard clamping to viewport edges**: Creates jarring discontinuities, nodes snap to boundaries
- **Filtering (hiding nodes)**: Loses spatial context, can't see the full extent of the focused set
- **Scaling everything smaller**: Loses detail, makes labels unreadable

We need a technique that:
1. Guarantees all focused nodes stay visible
2. Maintains smooth, continuous positioning
3. Preserves spatial relationships (nodes near each other stay near each other)
4. Allows graceful animation between states

## Solution: Fisheye Compression

Fisheye compression applies a radial distortion from the camera center that smoothly compresses positions as they approach the viewport edge. It's called "fisheye" because it's similar to a fisheye lens distortion in photography.

### Visual Behavior

```
Before fisheye (natural positions):     After fisheye (compressed):

     K1                                      K1

         K2                                     K2

                K3 ←── off-screen                    K3 ←── compressed inward

    ●                                      ●
  camera                                 camera


       K4                                    K4

                   K5 ←── off-screen              K5 ←── compressed inward
```

All keywords K1-K5 remain visible. Keywords near the center (K1, K2, K4) barely move. Keywords far from center (K3, K5) are compressed inward to fit within viewport bounds.

### The Math

Fisheye uses an **asymptotic compression function**:

```typescript
// For positions beyond compressionStartRadius:
excess = distance - compressionStartRadius
compressedExcess = compressionRange * (excess / (excess + scale))
compressedDistance = compressionStartRadius + compressedExcess
```

Key properties:
- **Input range:** `[compressionStartRadius, ∞)` (any distance from center)
- **Output range:** `[compressionStartRadius, maxRadius]` (guaranteed bounded)
- **Asymptotic:** As input → ∞, output → maxRadius (never exceeds)
- **Continuous:** Smooth gradient, no discontinuities
- **Tunable:** `scale` parameter controls compression aggressiveness

### Visual Explanation

```
Distance from center (r)
│
│  maxRadius ─────────────────────── (asymptotic limit)
│                              ······
│                         ·····
│                    ·····
│              ·····
│         ····
│    ····
│  ··
├──────────────────────────────────────────
│  compressionStartRadius
│  │
│  │  ← no compression zone (natural positions)
│  │
└──┴──────────────────────────────────────> position
   │
   camera center
```

## When to Use

### Use Fisheye Compression When:

✅ You need to keep a **known set** of items visible (e.g., focused keywords)
✅ The set can be **large** (10+ items scattered across space)
✅ You want **smooth, continuous** positioning without hard boundaries
✅ **Visual continuity** matters (animating between states)
✅ You control **what gets compressed** (focused items vs background)

### Use Regular Clamping When:

❌ Pulling **unknown neighbors** from off-screen (edge pulling)
❌ You want **discrete boundary** behavior (cliff zones)
❌ You need nodes to **snap to exact edge positions**
❌ Working with **non-focused content** (background elements)

## Implementation

### Basic Usage

```typescript
import { applyFisheyeCompression, computeCompressionRadii } from "@/lib/fisheye-viewport";
import { computeViewportZones } from "@/lib/edge-pulling";

// In your useFrame or render loop:
const zones = computeViewportZones(camera, canvasWidth, canvasHeight);
const { maxRadius, compressionStartRadius } = computeCompressionRadii(zones);

// For each focused node:
const compressed = applyFisheyeCompression(
  node.x,                  // Natural x position
  node.y,                  // Natural y position
  zones.viewport.camX,     // Camera center x
  zones.viewport.camY,     // Camera center y
  compressionStartRadius,  // Start compressing beyond this radius (80px from edge)
  maxRadius               // Never exceed this radius (25px from edge)
);

// Use compressed.x, compressed.y for rendering
instance.position.set(compressed.x, compressed.y, 0);
```

### With Rectangular Clamping

Fisheye is radial, but viewports are rectangular. After fisheye compression, clamp to rectangular bounds:

```typescript
const compressed = applyFisheyeCompression(x, y, camX, camY, startRadius, maxRadius);

// Clamp to rectangular pull bounds
const finalX = Math.max(
  zones.pullBounds.left,
  Math.min(zones.pullBounds.right, compressed.x)
);
const finalY = Math.max(
  zones.pullBounds.bottom,
  Math.min(zones.pullBounds.top, compressed.y)
);
```

This ensures nodes near corners don't exceed rectangular viewport bounds.

### Full Example (Focus Mode)

```typescript
// src/lib/keyword-pull-state.ts

const { maxRadius, compressionStartRadius } = computeCompressionRadii(zones);

for (const node of simNodes) {
  const isFocused = focusState?.focusedNodeIds.has(node.id) ?? false;

  if (isFocused) {
    // Apply fisheye compression for focused keywords
    const compressed = applyFisheyeCompression(
      node.x, node.y,
      zones.viewport.camX, zones.viewport.camY,
      compressionStartRadius,
      maxRadius
    );

    // Clamp to rectangular bounds
    const clampedX = Math.max(
      zones.pullBounds.left,
      Math.min(zones.pullBounds.right, compressed.x)
    );
    const clampedY = Math.max(
      zones.pullBounds.bottom,
      Math.min(zones.pullBounds.top, compressed.y)
    );

    // Store pulled position
    pulledMap.set(node.id, {
      x: clampedX,
      y: clampedY,
      realX: node.x,
      realY: node.y,
      connectedPrimaryIds: [],
    });
  }
}
```

## Configuration

### Compression Zones

The fisheye effect is controlled by two radii:

| Parameter | Typical Value | Description |
|-----------|--------------|-------------|
| `compressionStartRadius` | 80px from viewport edge (focus pull zone) | Inner boundary - no compression inside this radius |
| `maxRadius` | 25px from viewport edge (regular pull zone) | Outer boundary - asymptotic limit, never exceeded |

These are computed from viewport zones:

```typescript
// Inner boundary (80px from edge)
const focusPullDistanceRight = zones.focusPullBounds.right - camX;
const focusPullDistanceTop = zones.focusPullBounds.top - camY;
const compressionStartRadius = Math.min(focusPullDistanceRight, focusPullDistanceTop);

// Outer boundary (25px from edge)
const pullZoneDistanceRight = zones.pullBounds.right - camX;
const pullZoneDistanceTop = zones.pullBounds.top - camY;
const maxRadius = Math.min(pullZoneDistanceRight, pullZoneDistanceTop);
```

### Tuning Compression Aggressiveness

The `scale` parameter in the asymptotic function controls how aggressive the compression is:

```typescript
// In applyFisheyeCompression:
const scale = compressionRange * 0.5; // Current value

// Lower scale = more aggressive compression (nodes compress sooner)
// Higher scale = gentler compression (nodes stay near natural positions longer)
```

Current value (0.5) provides a good balance. Adjust if needed:
- **0.3**: Very aggressive, nodes compress quickly
- **0.5**: Balanced (default)
- **0.8**: Gentle, nodes stay natural longer before compressing

## Common Patterns

### Pattern 1: Conditional Fisheye

Only apply fisheye to specific nodes based on state:

```typescript
const isFocusedKeyword = focusState?.focusedNodeIds.has(node.id) ?? false;

if (isFocusedKeyword) {
  // Fisheye compression
  const compressed = applyFisheyeCompression(x, y, camX, camY, startRadius, maxRadius);
  position = compressed;
} else {
  // Regular clamping or natural position
  position = { x, y };
}
```

### Pattern 2: Hierarchical Compression

Apply fisheye to nodes AND their children:

```typescript
// Parent keywords
if (isFocusedKeyword) {
  const compressed = applyFisheyeCompression(...);
  // ...
}

// Child content nodes
const hasFocusedParent = parents.some(id => focusState.focusedNodeIds.has(id));
if (hasFocusedParent) {
  const compressed = applyFisheyeCompression(...);
  // ...
}
```

### Pattern 3: Animation with Fisheye

Fisheye provides smooth target positions for animation:

```typescript
// Compute target position with fisheye
const target = applyFisheyeCompression(x, y, camX, camY, startRadius, maxRadius);

// Animate from current to target
const t = easingFunction(elapsed / duration);
const animated = {
  x: currentX + (target.x - currentX) * t,
  y: currentY + (target.y - currentY) * t,
};
```

## Gotchas

### 1. Fisheye is Radial, Viewport is Rectangular

**Problem:** Nodes near corners can exceed rectangular bounds after fisheye compression.

**Solution:** Always clamp to rectangular bounds after fisheye:

```typescript
const compressed = applyFisheyeCompression(...);
const final = {
  x: Math.max(left, Math.min(right, compressed.x)),
  y: Math.max(bottom, Math.min(top, compressed.y)),
};
```

### 2. Compression Depends on Camera Position

**Problem:** Fisheye compresses from camera center. If camera moves, compressed positions change.

**Solution:** Recompute fisheye positions every frame in `useFrame` (not in `useMemo`):

```typescript
// ✅ Good: recompute each frame
useFrame(() => {
  const zones = computeViewportZones(camera, width, height);
  const compressed = applyFisheyeCompression(..., zones.viewport.camX, zones.viewport.camY, ...);
});

// ❌ Bad: stale camera position
const compressed = useMemo(() => {
  return applyFisheyeCompression(...);
}, [node.x, node.y]); // Missing camera dependency!
```

### 3. Division by Zero

**Problem:** When node is exactly at camera center, distance = 0.

**Solution:** Function includes guard clause:

```typescript
if (distance === 0) {
  return { x: nodeX, y: nodeY };
}
```

### 4. Mixed Compression Modes

**Problem:** Some nodes use fisheye, some use regular clamping. Edge rendering needs to know which.

**Solution:** Store both compressed and real positions:

```typescript
pulledMap.set(node.id, {
  x: compressedX,      // For rendering
  y: compressedY,
  realX: node.x,       // For click handling, debugging
  realY: node.y,
  connectedPrimaryIds: [...],
});
```

## Performance

Fisheye compression is **fast** and suitable for real-time use:

- **Per-node cost:** 1 sqrt, 4 divisions, 8 multiplications, 6 additions
- **Typical usage:** 10-50 focused nodes per frame (hundreds of microseconds)
- **No allocations:** Returns object literal (can be optimized further if needed)

For 1000+ nodes, consider:
1. Only compress focused nodes (not all nodes)
2. Use object pooling for returned positions if profiling shows allocation pressure
3. Early-exit for nodes already within compressionStartRadius (no math needed)

## Testing

Example test cases:

```typescript
describe("applyFisheyeCompression", () => {
  it("should not compress nodes within start radius", () => {
    const result = applyFisheyeCompression(50, 0, 0, 0, 100, 120);
    expect(result.x).toBe(50);
    expect(result.y).toBe(0);
  });

  it("should compress nodes beyond start radius", () => {
    const result = applyFisheyeCompression(150, 0, 0, 0, 100, 120);
    expect(result.x).toBeLessThan(150);
    expect(result.x).toBeGreaterThan(100);
    expect(result.x).toBeLessThanOrEqual(120);
  });

  it("should never exceed maxRadius", () => {
    const result = applyFisheyeCompression(10000, 0, 0, 0, 100, 120);
    expect(result.x).toBeLessThanOrEqual(120);
  });

  it("should preserve direction", () => {
    const result = applyFisheyeCompression(150, 100, 0, 0, 100, 120);
    expect(result.x).toBeGreaterThan(0);
    expect(result.y).toBeGreaterThan(0);
    expect(result.y / result.x).toBeCloseTo(100 / 150, 2);
  });
});
```

## Related Patterns

- **Edge Pulling** ([edge-pulling.md](../architecture/edge-pulling.md)): Uses hard clamping for non-focused nodes
- **Stable Refs** ([stable-refs.md](stable-refs.md)): Avoid recreating fisheye calculations in effects
- **Focus Mode** ([click-to-focus-margin-push.md](../plans/click-to-focus-margin-push.md)): Primary use case for fisheye compression

## References

- Implementation: [`src/lib/fisheye-viewport.ts`](../../src/lib/fisheye-viewport.ts)
- Usage: [`src/lib/keyword-pull-state.ts`](../../src/lib/keyword-pull-state.ts), [`src/lib/content-pull-state.ts`](../../src/lib/content-pull-state.ts)
- Tests: [`src/lib/__tests__/keyword-pull-state.test.ts`](../../src/lib/__tests__/keyword-pull-state.test.ts)
- Architecture: [`docs/architecture/edge-pulling.md`](../architecture/edge-pulling.md)
