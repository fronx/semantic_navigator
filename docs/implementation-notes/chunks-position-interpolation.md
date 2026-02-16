# ChunksView Position Interpolation Implementation

**Date**: 2026-02-17
**Component**: `/src/components/chunks-r3f/ChunksScene.tsx`

## Summary

Applied smooth position interpolation to ChunksView lens mode transitions using `useArrayPositionInterpolation` hook. The graph now morphs continuously between natural and compressed layouts instead of jumping discontinuously.

## Implementation Details

### Key Changes

1. **Extracted lens position computation** (lines 166-234):
   - Moved fisheye compression calculation from `useFrame` to `useEffect`
   - Computes target compressed positions when lens activates
   - Sets `compressedPositionsRef.current = null` when lens deactivates
   - Stores both positions and scales in separate refs

2. **Applied position interpolation** (lines 237-247):
   ```tsx
   const interpolatedPositionsRef = useArrayPositionInterpolation(
     {
       targetPositions: compressedPositionsRef.current,
       duration: 400,
       easing: easeOutCubic,
       initialPositions: layoutPositions,
     },
     (updateCallback) => { useFrame(updateCallback); }
   );
   ```

3. **Simplified render loop** (lines 287-348):
   - Removed inline position computation
   - Uses `interpolatedPositionsRef.current` directly
   - Edges and labels automatically follow interpolated positions

### Animation Behavior

- **Lens activation**: Smoothly compresses positions toward viewport center over 400ms
- **Lens deactivation**: Smoothly returns to natural UMAP layout over 400ms
- **Combined animations**: Position interpolation + `useFadingScale` for node visibility
- **Easing**: `easeOutCubic` for fast start, smooth deceleration (matches TopicsView)

### Pattern Consistency

Follows the same pattern as TopicsView focus mode:
- **TopicsView**: Uses `usePositionInterpolation` (Map-based) for focus push animations
- **ChunksView**: Uses `useArrayPositionInterpolation` (Float32Array-based) for lens compression

Both provide:
- Zero GC pressure (ref-based updates)
- Configurable duration and easing
- Automatic cleanup when animation completes
- Context-agnostic (works with R3F, vanilla Three.js, or canvas)

## Testing

Run the app and verify:
1. Click a chunk to activate lens mode → graph smoothly compresses
2. Click background to deactivate → graph smoothly expands back
3. No discontinuous jumps or flicker
4. Edges and labels follow positions during animation
5. Node scales fade in/out smoothly (from `useFadingScale`)

## See Also

- `/docs/patterns/position-interpolation.md` - Pattern documentation
- `/src/hooks/usePositionInterpolation.ts` - Hook implementation
- `/src/components/topics-r3f/KeywordNodes.tsx` - TopicsView focus animation reference
