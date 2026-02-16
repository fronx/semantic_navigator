# Fading Visibility Animation Pattern

## Overview

The fading visibility pattern provides smooth animated transitions for items entering or leaving a Set-based visibility state. Instead of nodes/edges popping in/out instantly, they smoothly fade using linear interpolation (lerp).

## Core Hook: `useFadingVisibility`

The generic hook that powers all fading animations:

```typescript
useFadingVisibility<TId extends string | number>(
  activeIdsRef: React.RefObject<Set<TId>>,
  options: FadingVisibilityOptions,
  setupUpdateLoop: (updateCallback: () => void) => void
): React.RefObject<Map<TId, number>>
```

### How It Works

1. **Tracking**: Maintains a Map of IDs to values (0 to 1)
2. **Lerping**: Each frame, values lerp toward target (1 if in Set, 0 if not)
3. **Cleanup**: Removes entries that fade below threshold (default 0.005)
4. **Initialization**: New entries start at `initialValue` (default is `lerpSpeed`)

### Animation Loop

The hook is context-agnostic. The caller provides `setupUpdateLoop` to define how the animation runs:

- **R3F**: Use `useFrame` for 60fps updates tied to Three.js render loop
- **RAF**: Use `requestAnimationFrame` for standalone animations
- **Custom**: Any other update mechanism (timers, observables, etc.)

## Specialized Hooks

### `useFadingMembership` (R3F Context)

For React Three Fiber components. Uses `useFrame` for animation updates.

```typescript
import { useFadingMembership } from "@/hooks/useFadingMembership";

function ContentNodes({ visibleIds }: { visibleIds: Set<string> }) {
  const visibleIdsRef = useRef(visibleIds);
  visibleIdsRef.current = visibleIds;

  const fadeMapRef = useFadingMembership(visibleIdsRef, 0.08);

  useFrame(() => {
    for (let i = 0; i < nodes.length; i++) {
      const fadeValue = fadeMapRef.current.get(nodes[i].id) ?? 0;
      // Apply fadeValue as opacity or scale
      if (fadeValue < 0.005) {
        // Node fully faded out - hide it
        scaleVec.setScalar(0);
      } else {
        scaleVec.setScalar(fadeValue);
      }
    }
  });
}
```

**Key Points**:
- Returns Map of animated opacity values (0→1)
- Entries below threshold are auto-removed (cleanup)
- Newly visible items start at `lerpSpeed` and lerp to 1
- Newly invisible items start at current value and lerp to 0

### `useFadingScale` (Non-R3F Context)

For components outside R3F context. Uses `requestAnimationFrame`.

```typescript
import { useFadingScale } from "@/hooks/useFadingScale";

function ChunksScene({ focusedNodeIds }: { focusedNodeIds: Set<number> }) {
  const focusedIdsRef = useRef(focusedNodeIds);
  focusedIdsRef.current = focusedNodeIds;

  const scalesRef = useFadingScale(focusedIdsRef, { lerpSpeed: 0.1 });

  useFrame(() => {
    for (let i = 0; i < nodes.length; i++) {
      const scale = scalesRef.current.get(i) ?? 0;
      // Apply animated scale instead of binary 0/1
      scaleVec.setScalar(baseScale * scale);
    }
  });
}
```

## Options

```typescript
interface FadingVisibilityOptions {
  /** Lerp speed (0-1). Higher = faster transition. Default 0.08 */
  lerpSpeed?: number;

  /** Threshold below which items are removed. Default 0.005 */
  fadeThreshold?: number;

  /** Initial value for newly visible items. Default is lerpSpeed */
  initialValue?: number;
}
```

### Choosing `lerpSpeed`

- **0.05**: Slow, gentle fade (~60 frames to reach 95%)
- **0.08**: Default, smooth transition (~40 frames)
- **0.12**: Quick but still smooth (~25 frames)
- **0.20**: Fast, noticeable (~15 frames)

Formula: `frames ≈ -ln(0.05) / lerpSpeed` for 95% completion

## Migration Guide

### Before: Instant Visibility

```typescript
// Discontinuous: nodes instantly appear/disappear
for (let i = 0; i < nodes.length; i++) {
  if (visibleNodes.has(i)) {
    scaleVec.setScalar(1.0);
  } else {
    scaleVec.setScalar(0);  // Instant hide
  }
}
```

### After: Smooth Fade

```typescript
const visibleNodesRef = useRef(visibleNodes);
visibleNodesRef.current = visibleNodes;

const scalesRef = useFadingScale(visibleNodesRef, { lerpSpeed: 0.1 });

// In render loop:
for (let i = 0; i < nodes.length; i++) {
  const scale = scalesRef.current.get(i) ?? 0;
  scaleVec.setScalar(scale);  // Smooth transition
}
```

## Pattern: Ref-Based Tracking

Always use a ref to track the visible Set, never pass it directly:

```typescript
// ❌ Wrong: Set reference changes cause hook re-creation
const fadeMapRef = useFadingScale(visibleNodes, ...);

// ✅ Correct: Ref stays stable across renders
const visibleNodesRef = useRef(visibleNodes);
visibleNodesRef.current = visibleNodes;
const fadeMapRef = useFadingScale(visibleNodesRef, ...);
```

## Performance Considerations

1. **Map Size**: Fading entries remain in the Map until fully faded (< threshold)
2. **Iteration**: Each frame iterates all Map entries for lerping
3. **Cleanup**: Auto-removes faded entries to prevent unbounded growth
4. **RAF vs useFrame**:
   - `useFrame` syncs with R3F render loop (efficient)
   - `requestAnimationFrame` runs independently (may update more than needed)

## Common Use Cases

### Focus Mode (Keywords/Chunks)

```typescript
const focusedIdsRef = useRef(focusState?.focusedNodeIds ?? new Set());
focusedIdsRef.current = focusState?.focusedNodeIds ?? new Set();

const scalesRef = useFadingScale(focusedIdsRef);

// Nodes smoothly scale out when exiting focus, scale in when entering
```

### Search Highlighting

```typescript
const matchedIdsRef = useRef(searchResults);
matchedIdsRef.current = searchResults;

const opacitiesRef = useFadingMembership(matchedIdsRef, 0.12);

// Non-matches fade to low opacity, matches fade to full opacity
```

### Edge Visibility (LOD)

```typescript
const visibleEdgeIdsRef = useRef(new Set<string>());
const edgeFadeRef = useFadingMembership(visibleEdgeIdsRef);

useFrame(() => {
  visibleEdgeIdsRef.current.clear();
  // Determine which edges should be visible based on zoom/viewport
  for (const edge of edges) {
    if (shouldBeVisible(edge)) {
      visibleEdgeIdsRef.current.add(edge.id);
    }
  }

  // Edges smoothly fade in/out as visibility changes
  for (const edge of edges) {
    const opacity = edgeFadeRef.current.get(edge.id) ?? 0;
    material.opacity = opacity * baseOpacity;
  }
});
```

## Architecture Notes

- **Separation of Concerns**: `useFadingVisibility` is the generic engine, specialized hooks provide context-specific update loops
- **Reusability**: Same animation logic works for opacity, scale, color intensity, or any 0→1 value
- **Framework Agnostic**: Core logic has no R3F/React dependencies (just refs and callbacks)
- **Type Safety**: Generic `TId` supports both string and number IDs

## Related Files

- `/src/hooks/useFadingVisibility.ts` - Generic core
- `/src/hooks/useFadingMembership.ts` - R3F specialization
- `/src/hooks/useFadingScale.ts` - Non-R3F specialization
- `/src/components/topics-r3f/ContentNodes.tsx` - Usage example (R3F)
- `/src/components/topics-r3f/EdgeRenderer.tsx` - Usage example (R3F)
