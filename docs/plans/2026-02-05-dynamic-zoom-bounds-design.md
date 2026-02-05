# Dynamic Zoom Bounds Design

**Date:** 2026-02-05
**Status:** Approved for implementation

## Goal

Enable users to zoom out to see the total size of the graph being displayed with a 50% margin. The maximum zoom-out distance should dynamically adapt to the graph size rather than using a fixed limit.

## Requirements Summary

1. **Smart boundary**: CAMERA_Z_MAX dynamically adjusts based on graph size
2. **Continuous updates**: Recalculate as nodes move during simulation
3. **Filtered nodes**: Calculate bounds from `activeNodes` (visible/filtered subset)
4. **Keywords only**: Chunk nodes handled implicitly by 50% margin
5. **Fallback behavior**: Use default CAMERA_Z_MAX (20000) when calculation fails

## Architecture

### Core Components

**New utility** (`src/lib/dynamic-zoom-bounds.ts`):
- `calculateBoundingBox(nodes)`: Find min/max X/Y from positioned nodes
- `calculateCameraZForBounds(bounds, viewport, margin)`: Compute required camera Z to fit bounds

**Modified files**:
1. `CameraController.tsx` - Accept dynamic `maxDistance` prop
2. `TopicsView.tsx` - Calculate dynamic bounds from active nodes
3. `R3FTopicsCanvas.tsx` - Pass dynamic max to CameraController
4. R3F renderer - Access node positions from force simulation

### Calculation Flow

1. **Get node positions**: Access from force simulation (R3F renderer)
2. **Calculate bounding box**: Iterate active nodes, find min/max X/Y
3. **Apply margin**: Multiply dimensions by 1.5 (50% margin)
4. **Compute camera Z**: Use FOV and aspect ratio to determine required distance
5. **Update limit**: Pass to CameraController as `maxDistance` prop
6. **Timing**: Recalculate on every simulation tick or position update

### Math

With narrow FOV (10°) for orthogonal-like projection:

```typescript
// Bounding box with margin
const width = (maxX - minX) * 1.5;
const height = (maxY - minY) * 1.5;

// Required camera Z to fit bounds in viewport
const fov = 10 * (Math.PI / 180); // Convert to radians
const cameraZ = Math.max(
  width / (2 * Math.tan(fov / 2) * aspect),
  height / (2 * Math.tan(fov / 2))
);
```

## Edge Cases

### Fallback Scenarios

| Scenario | Behavior |
|----------|----------|
| No positioned nodes | Return CAMERA_Z_MAX default (20000) |
| All nodes at origin (0,0) | Return default |
| Single node | Use sensible default radius (e.g., 500 units) |
| Very tight cluster | Enforce minimum bounds size |

### Smoothness

**Initial approach**: Accept minor jitter during simulation settling as acceptable feedback.

**If needed later**: Apply exponential moving average to smooth CAMERA_Z_MAX changes.

### Multi-Renderer Support

- **R3F (primary)**: Full implementation with dynamic bounds
- **Three.js**: Share same bounds calculation logic
- **D3/SVG**: May need different approach (uses transforms, not camera)

## Performance

- Bounds calculation is O(n) over active nodes
- Fast math operations, no DOM manipulation
- Only recalculate when node positions change
- Negligible performance impact

## Implementation Notes

### Skip nodes without positions
```typescript
const validNodes = nodes.filter(n =>
  n.x !== undefined && n.y !== undefined &&
  (n.x !== 0 || n.y !== 0)
);
```

### Handle viewport aspect ratio
The camera Z calculation must account for viewport aspect ratio to ensure bounds fit in both dimensions.

### Thread through props
`TopicsView` → `R3FTopicsCanvas` → `CameraController` (pass `maxDistance` prop)

## Success Criteria

1. ✅ User can zoom out to see entire filtered graph + margin
2. ✅ Zoom limit adapts when applying semantic filters
3. ✅ No excessive jitter during simulation settling
4. ✅ Fallback behavior works for empty/small graphs
5. ✅ Performance remains smooth (no lag from bounds calculation)
