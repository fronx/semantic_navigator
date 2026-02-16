# Fading Visibility Animation - Implementation Summary

## What Was Extracted

The smooth focus mode animation from TopicsView has been extracted into reusable hooks that work in both R3F and non-R3F contexts.

## Files Created

### 1. `/src/hooks/useFadingVisibility.ts`

**Purpose**: Generic animation engine for Set-based visibility transitions.

**Key Features**:
- Context-agnostic (works anywhere)
- Type-safe generic IDs (string or number)
- Configurable lerp speed, fade threshold, and initial values
- Auto-cleanup of fully faded entries

**How it works**:
```typescript
// Maintains a Map<TId, number> with animated values (0→1)
// Each update:
// 1. Lerps existing values toward target (1 if in Set, 0 if not)
// 2. Removes values below fadeThreshold
// 3. Initializes newly visible items at initialValue
```

### 2. `/src/hooks/useFadingMembership.ts`

**Purpose**: R3F-specific specialization using `useFrame`.

**Changes**:
- Refactored to use `useFadingVisibility` internally
- Same API as before (backward compatible)
- Uses `useFrame` for animation loop

**Usage** (unchanged from before):
```typescript
const visibleIdsRef = useRef(new Set<string>());
const fadeMapRef = useFadingMembership(visibleIdsRef, 0.08);

useFrame(() => {
  const opacity = fadeMapRef.current.get(nodeId) ?? 0;
  // Apply opacity to mesh
});
```

### 3. `/src/hooks/useFadingScale.ts`

**Purpose**: Non-R3F specialization using `requestAnimationFrame`.

**Use Case**: ChunksView focus mode (or any non-R3F animation).

**Usage**:
```typescript
const visibleIdsRef = useRef(new Set<number>());
const scalesRef = useFadingScale(visibleIdsRef, { lerpSpeed: 0.1 });

useFrame(() => {
  const scale = scalesRef.current.get(nodeIndex) ?? 0;
  // Apply scale to instance
});
```

## Animation Behavior Analysis

### TopicsView (Current Implementation)

**Location**: `src/components/topics-r3f/ContentNodes.tsx`

**Behavior**:
1. `visibleContentIdsRef` is a Set tracking which content nodes should be visible
2. `useFadingMembership` creates an animated fade map from this Set
3. Each frame:
   - Nodes in the Set fade **toward 1.0** (appear)
   - Nodes not in the Set fade **toward 0.0** (disappear)
   - Values below 0.005 are cleaned up (fully faded)
4. Scale is multiplied by fade value: `nodeScale *= fadeOpacity`

**Properties**:
- **Duration**: ~40 frames to 95% completion (lerpSpeed=0.08)
- **Smoothness**: Linear interpolation (exponential decay curve)
- **Cleanup**: Auto-removes faded entries to prevent Map growth

### ChunksView (Current Implementation)

**Location**: `src/components/chunks-r3f/ChunksScene.tsx`

**Behavior**:
```typescript
// Lines 268-272: Non-focused nodes
if (lensActive && lensNodeSet && !lensNodeSet.has(i)) {
  scaleVec.current.setScalar(0);  // ← Instant hide
  matrixRef.current.compose(...);
  mesh.setMatrixAt(i, matrixRef.current);
  continue;
}
```

**Properties**:
- **Duration**: Instant (0 frames)
- **Smoothness**: None (binary on/off)
- **Issue**: Jarring visual when entering/exiting focus mode

## How to Apply to ChunksView

### Step 1: Import the Hook

```typescript
import { useFadingScale } from "@/hooks/useFadingScale";
```

### Step 2: Track Visible Node Indices

```typescript
// Add after existing refs
const visibleNodeIndicesRef = useRef(new Set<number>());
```

### Step 3: Create Animated Scale Map

```typescript
// Add with other hooks
const nodeScalesRef = useFadingScale(visibleNodeIndicesRef, {
  lerpSpeed: 0.1,  // Slightly faster than default for responsiveness
});
```

### Step 4: Update Visible Set in useFrame

```typescript
useFrame(() => {
  // ... existing code ...

  // Update visible set based on lens
  visibleNodeIndicesRef.current.clear();
  if (lensActive && lensNodeSet) {
    for (const nodeIndex of lensNodeSet) {
      visibleNodeIndicesRef.current.add(nodeIndex);
    }
  } else {
    // All nodes visible when lens inactive
    for (let i = 0; i < n; i++) {
      visibleNodeIndicesRef.current.add(i);
    }
  }

  // ... rest of useFrame ...
});
```

### Step 5: Apply Animated Scale

```typescript
// Replace the instant hide with animated scale
for (let i = 0; i < n; i++) {
  const animatedScale = nodeScalesRef.current.get(i) ?? 0;

  // Skip fully invisible nodes (optimization)
  if (animatedScale < 0.005) {
    scaleVec.current.setScalar(0);
    matrixRef.current.compose(posVec.current, quat.current, scaleVec.current);
    mesh.setMatrixAt(i, matrixRef.current);
    continue;
  }

  // Apply lens scale AND animated fade
  const lensScale = usingLensBuffer ? renderScalesRef.current[i] : 1;
  const finalScale = CARD_SCALE * lensScale * animatedScale;

  posVec.current.set(targetPositions[i * 2], targetPositions[i * 2 + 1], 0);
  scaleVec.current.setScalar(finalScale);
  matrixRef.current.compose(posVec.current, quat.current, scaleVec.current);
  mesh.setMatrixAt(i, matrixRef.current);
}
```

## Configuration Options

### Lerp Speed Comparison

| Speed | Frames to 95% | Use Case |
|-------|---------------|----------|
| 0.05  | ~60 frames    | Slow, gentle transitions |
| 0.08  | ~40 frames    | Default, smooth (TopicsView) |
| 0.10  | ~30 frames    | Recommended for ChunksView (responsive but smooth) |
| 0.15  | ~20 frames    | Quick transitions |
| 0.20  | ~15 frames    | Fast, noticeable |

### Other Options

```typescript
{
  lerpSpeed: 0.1,        // Animation speed
  fadeThreshold: 0.005,  // Cleanup threshold
  initialValue: 0.1,     // Starting value for new items (defaults to lerpSpeed)
}
```

## Performance Considerations

### Memory
- Map grows to include all **transitioning** nodes (entering or leaving)
- Auto-cleanup removes entries below threshold
- Max size ≈ number of nodes × transition duration
- ChunksView example: 1000 nodes × 30 frames ÷ 60 fps = ~500ms of retained entries

### CPU
- Each frame iterates **all Map entries** (not all nodes)
- Lerping is O(map size), not O(total nodes)
- Map size scales with transition duration and change frequency

### Optimization Tips
1. **Higher lerp speed** = faster cleanup = smaller Map
2. **Higher threshold** = earlier cleanup = smaller Map
3. **Stable Sets** = fewer transitions = smaller Map

## Testing Strategy

### Visual Verification
1. Enter focus mode (click a node)
2. Observe: nodes should **smoothly scale out** over ~0.5 seconds
3. Exit focus mode (background click or zoom out)
4. Observe: nodes should **smoothly scale in** over ~0.5 seconds

### Performance Testing
1. Monitor FPS during focus transitions
2. Check Map size: `console.log(nodeScalesRef.current.size)`
3. Verify cleanup: Map size should decrease after transition completes

### Edge Cases
- **Rapid toggling**: Multiple clicks should queue smoothly (no snapping)
- **Partial visibility**: Some nodes visible, some not (no flickering)
- **All invisible**: Map should be empty after fade completes

## Next Steps

1. **Implement in ChunksView** following the steps above
2. **Test visual smoothness** compared to current instant hide/show
3. **Tune lerpSpeed** based on feel (start with 0.1)
4. **Measure performance** impact (FPS, Map size)
5. **Consider edge interactions** (how do animated scales interact with edge opacity?)

## Related Files

- Pattern documentation: `/docs/patterns/fading-visibility-animation.md`
- Generic hook: `/src/hooks/useFadingVisibility.ts`
- R3F hook: `/src/hooks/useFadingMembership.ts`
- Non-R3F hook: `/src/hooks/useFadingScale.ts`
- TopicsView example: `/src/components/topics-r3f/ContentNodes.tsx` (lines 116-118, 254-277)
- ChunksView target: `/src/components/chunks-r3f/ChunksScene.tsx` (lines 107-109, 268-272)
