# Position Interpolation Pattern

## Overview

The position interpolation hooks (`usePositionInterpolation` and `useArrayPositionInterpolation`) provide smooth, time-based transitions between coordinate sets with configurable easing functions.

These hooks follow the same pattern as `useFadingVisibility` - they extract core animation logic into reusable primitives that work in any rendering context (R3F, vanilla Three.js, canvas, etc.).

## When to Use

- **Focus mode transitions**: Smoothly push nodes to viewport edges when focus is activated
- **Lens mode compression**: Animate fisheye distortion when lens is activated/deactivated
- **Layout transitions**: Smoothly transition between force-directed and static layouts
- **Camera-following**: Animate nodes tracking viewport during camera pan/zoom

## API

### `usePositionInterpolation<TId>` - Map-based positions

For TopicsView-style rendering with string IDs and Map-based positions.

```ts
const interpolatedPositionsRef = usePositionInterpolation(
  {
    targetPositions: Map<string, {x, y}> | null,
    duration: 400, // milliseconds
    easing: easeOutCubic, // or easeInOutCubic, linear
    initialPositions: Map<string, {x, y}>, // fallback when no animation
  },
  (updateCallback) => {
    // R3F context: useFrame runs callback every frame
    useFrame(updateCallback);

    // Non-R3F: use requestAnimationFrame
    useEffect(() => {
      let raf: number;
      const tick = () => { updateCallback(); raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }, []);
  }
);

// Access interpolated positions
const pos = interpolatedPositionsRef.current.get("nodeId");
```

### `useArrayPositionInterpolation` - Float32Array positions

For ChunksView-style rendering with numeric indices and flat position arrays.

```ts
const interpolatedPositionsRef = useArrayPositionInterpolation(
  {
    targetPositions: Float32Array([x1, y1, x2, y2, ...]) | null,
    duration: 400,
    easing: easeOutCubic,
    initialPositions: Float32Array([...]),
  },
  (updateCallback) => { useFrame(updateCallback); }
);

// Access interpolated positions
const x = interpolatedPositionsRef.current[i * 2];
const y = interpolatedPositionsRef.current[i * 2 + 1];
```

## Animation Lifecycle

1. **Trigger**: When `targetPositions` changes reference, animation starts
2. **Interpolation**: Each frame, positions lerp from start → target using easing function
3. **Completion**: When `t >= 1.0`, animation clears and positions snap to target
4. **Clearing**: When `targetPositions = null`, positions revert to `initialPositions`

## Easing Functions

- **`easeOutCubic`** (default): Fast start, smooth deceleration. Best for focus/lens activation.
- **`easeInOutCubic`**: Smooth acceleration and deceleration. Good for symmetric transitions.
- **`linear`**: Constant speed. Useful for mechanical movements.

## Pattern: Detect Animation Completion

The hook doesn't directly expose "isAnimating" state (follows ref-based pattern). To detect completion:

```ts
const prevTargetRef = useRef(targetPositions);
const animationCompleteRef = useRef(false);

useFrame(() => {
  updateCallback();

  // Detect when animation just completed
  if (prevTargetRef.current !== null && targetPositions === null) {
    // Animation cleared
    if (!animationCompleteRef.current) {
      console.log("Animation completed!");
      animationCompleteRef.current = true;
    }
  } else if (targetPositions !== null) {
    animationCompleteRef.current = false;
  }

  prevTargetRef.current = targetPositions;
});
```

## Integration Examples

### TopicsView: Focus Mode Push Animation

```ts
// In KeywordNodes.tsx:
const targetPositions = focusState
  ? computeFocusPositions(simNodes, focusState, zones)
  : null;

const focusPositionsRef = usePositionInterpolation(
  {
    targetPositions,
    duration: focusState ? 500 : 400, // push slower than return
    easing: easeOutCubic,
  },
  (cb) => { useFrame(cb); }
);

useFrame(() => {
  for (let i = 0; i < simNodes.length; i++) {
    const node = simNodes[i];
    const focusPos = focusPositionsRef.current.get(node.id);
    const x = focusPos?.x ?? node.x ?? 0;
    const y = focusPos?.y ?? node.y ?? 0;
    // Apply to instancedMesh...
  }
});
```

### ChunksView: Lens Mode Compression

```ts
// In ChunksScene.tsx:
const compressedPositions = lensActive
  ? computeCompressedPositions(basePositions, lensInfo, camera, size)
  : null;

const interpolatedPositionsRef = useArrayPositionInterpolation(
  {
    targetPositions: compressedPositions,
    duration: 400,
    easing: easeOutCubic,
    initialPositions: basePositions,
  },
  (cb) => { useFrame(cb); }
);

useFrame(() => {
  const positions = interpolatedPositionsRef.current;
  for (let i = 0; i < nodeCount; i++) {
    posVec.current.set(positions[i * 2], positions[i * 2 + 1], 0);
    // Apply to instancedMesh...
  }
});
```

## Performance Notes

- **Zero GC pressure**: Uses refs and in-place updates (no new objects per frame)
- **Lazy allocation**: Buffers only allocated when animation starts
- **Early exit**: Animation clears immediately when complete (no idle work)
- **Shared ref pattern**: Multiple consumers (nodes, edges, labels) read same ref

## Comparison with useFadingVisibility

| Feature | useFadingVisibility | usePositionInterpolation |
|---------|---------------------|-------------------------|
| **Purpose** | Opacity/scale fades for Set membership | Position transitions for coordinates |
| **Input** | Set of IDs (membership) | Map/Array of positions |
| **Animation** | Continuous lerp (no completion) | Time-based with easing (completes) |
| **Use case** | Edge fade-in, node scale on filter | Focus push, lens compression |

Both follow the same "ref-based, context-agnostic" pattern, making them composable in any rendering context.

## See Also

- `/src/hooks/useFadingVisibility.ts` - Generic fading animation pattern
- `/src/hooks/useFadingScale.ts` - Scale animation for focus mode
- `/src/components/topics-r3f/KeywordNodes.tsx` - Original focus animation (lines 173-261)
- `/src/components/chunks-r3f/ChunksScene.tsx` - Lens animation target
