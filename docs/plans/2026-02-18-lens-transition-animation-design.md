# Lens Transition Animation Design

**Date**: 2026-02-18
**Status**: Approved

## Problem

ChunksView's fisheye/lens mode activates abruptly — when a chunk is clicked, nodes snap instantly to their fisheye-compressed positions. TopicsView's focus mode has a smooth 500ms easeOutCubic entrance animation that makes the transition feel continuous. We want ChunksView to match that feel, and extract the pattern into a reusable hook.

## Root Cause

TopicsView (KeywordNodes.tsx) runs a time-based lerp state machine in `useFrame` when focus activates. ChunksView writes fisheye positions directly to `compressedPositionsRef` each frame with no temporal animation.

## Solution: `useLensTransition` hook

A thin, purpose-built hook that smoothly interpolates a Float32Array of positions between a source state and a target state, triggered by an `active` boolean.

### Signature

```typescript
// src/hooks/useLensTransition.ts

export function useLensTransition(
  sourcePositionsRef: React.RefObject<Float32Array>,  // natural/UMAP positions
  targetPositionsRef: React.RefObject<Float32Array>,  // fisheye-compressed positions (updated each frame by caller)
  active: boolean,                                    // lens on/off
  setupUpdateLoop: (cb: () => void) => void,          // caller passes useFrame wrapper
  options?: {
    activateDuration?: number;    // default 500ms (matches TopicsView push)
    deactivateDuration?: number;  // default 400ms (matches TopicsView return)
    easing?: (t: number) => number; // default easeOutCubic
  }
): React.RefObject<Float32Array>  // animated positions for rendering
```

### Internal State Machine

```
active flips true
  → snapshot current animatedPositions as startPositions
  → set phase = "activating", startTime = now

each frame while activating:
  t = easeOutCubic(elapsed / 500ms)
  animated[i] = start[i] + (target[i] - start[i]) * t
  when t >= 1: phase = "tracking" (passthrough to target)

active flips false
  → snapshot current animatedPositions as startPositions
  → set phase = "deactivating", startTime = now

each frame while deactivating:
  t = easeOutCubic(elapsed / 400ms)
  animated[i] = start[i] + (source[i] - start[i]) * t
  when t >= 1: phase = "idle" (passthrough to source)
```

Snapshoting current animated positions (not the target) as the start of each transition ensures mid-animation reversals don't snap — the deactivation begins from wherever the nodes currently are.

### Why Float32Array (not Map)

ChunksView positions are stored as flat `[x0, y0, x1, y1, ...]` arrays. This matches the existing `useArrayPositionInterpolation` variant in `usePositionInterpolation.ts`, and avoids per-frame Map allocations.

### Easing

Reuses `easeOutCubic` already exported from `usePositionInterpolation.ts`:
```typescript
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
```

## Changes to ChunksScene

1. Fisheye computation block stays unchanged — continues writing into `compressedPositionsRef` every frame.
2. `useLensTransition` is called with:
   - `sourcePositionsRef` = ref to `layoutPositions` (the UMAP+force Float32Array)
   - `targetPositionsRef` = `compressedPositionsRef` (fisheye output)
   - `active` = `lensActive`
3. The hook's returned `animatedPositionsRef` replaces `renderPositions` in the per-node matrix loop.

## What Does Not Change

- Scale animations (`useFadingScale`, `computeLensNodeScale`, hover scale) — already feel good, untouched.
- Fisheye compression logic — runs every frame as before.
- The existing `usePositionInterpolation` hook — `useLensTransition` is a sibling, not a replacement.

## Timings

Match TopicsView exactly:
- Activate: **500ms**, easeOutCubic
- Deactivate: **400ms**, easeOutCubic

## Files Affected

| File | Change |
|------|--------|
| `src/hooks/useLensTransition.ts` | New file |
| `src/components/chunks-r3f/ChunksScene.tsx` | Use hook output for `renderPositions` |
