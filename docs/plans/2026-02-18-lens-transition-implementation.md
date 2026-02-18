# Lens Transition Animation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a smooth 500ms easeOutCubic entrance animation to ChunksView's fisheye lens mode, matching the TopicsView focus mode feel, via a new reusable `useLensTransition` hook.

**Architecture:** A `useLensTransition` hook holds a state machine (idle → activating → tracking → deactivating → idle) that interpolates a Float32Array of positions between source (UMAP layout) and target (fisheye-compressed). ChunksScene passes its existing refs to the hook and uses the hook's output as `renderPositions`.

**Tech Stack:** React hooks, useRef, Float32Array, `easeOutCubic` from `usePositionInterpolation.ts`, R3F `useFrame` (passed in via `setupUpdateLoop`).

---

### Task 1: Create `useLensTransition` hook

**Files:**
- Create: `src/hooks/useLensTransition.ts`

**Step 1: Write the hook**

```typescript
import { useRef, useEffect } from "react";
import { easeOutCubic } from "./usePositionInterpolation";

type Phase = "idle" | "activating" | "tracking" | "deactivating";

interface LensTransitionState {
  phase: Phase;
  startPositions: Float32Array;
  startTime: number;
}

export interface LensTransitionOptions {
  activateDuration?: number;   // default 500ms
  deactivateDuration?: number; // default 400ms
  easing?: (t: number) => number;
}

/**
 * Smoothly interpolates between source and target position arrays when
 * `active` toggles. Mirrors the TopicsView focus mode push/return animation
 * pattern, but operates on flat Float32Array [x0, y0, x1, y1, ...] instead
 * of a per-node Map.
 *
 * @param sourcePositionsRef - Natural/UMAP positions (updated each frame by caller)
 * @param targetPositionsRef - Fisheye-compressed positions (updated each frame by caller)
 * @param active - Lens on/off trigger
 * @param setupUpdateLoop - Caller passes their useFrame wrapper here
 * @returns animatedPositionsRef - Use this as renderPositions
 */
export function useLensTransition(
  sourcePositionsRef: React.RefObject<Float32Array>,
  targetPositionsRef: React.RefObject<Float32Array>,
  active: boolean,
  setupUpdateLoop: (cb: () => void) => void,
  options: LensTransitionOptions = {},
): React.RefObject<Float32Array> {
  const {
    activateDuration = 500,
    deactivateDuration = 400,
    easing = easeOutCubic,
  } = options;

  const stateRef = useRef<LensTransitionState | null>(null);
  const animatedRef = useRef<Float32Array>(new Float32Array(0));
  const activeRef = useRef(active);

  // Track active changes and start transitions
  useEffect(() => {
    const prev = activeRef.current;
    activeRef.current = active;

    const source = sourcePositionsRef.current;
    const target = targetPositionsRef.current;
    if (!source || !target) return;

    const n = source.length;

    // Ensure animatedRef is the right size
    if (animatedRef.current.length !== n) {
      animatedRef.current = new Float32Array(n);
      // Initialize from source so first frame isn't garbage
      animatedRef.current.set(source);
    }

    if (active && !prev) {
      // Snapshot current animated positions as start
      const startPositions = new Float32Array(animatedRef.current);
      stateRef.current = { phase: "activating", startPositions, startTime: performance.now() };
    } else if (!active && prev) {
      const startPositions = new Float32Array(animatedRef.current);
      stateRef.current = { phase: "deactivating", startPositions, startTime: performance.now() };
    }
  }, [active, sourcePositionsRef, targetPositionsRef]);

  setupUpdateLoop(() => {
    const source = sourcePositionsRef.current;
    const target = targetPositionsRef.current;
    if (!source || !target) return;

    const n = source.length;
    if (animatedRef.current.length !== n) {
      animatedRef.current = new Float32Array(n);
      animatedRef.current.set(activeRef.current ? target : source);
    }

    const state = stateRef.current;

    if (!state) {
      // Passthrough: copy source or target directly
      animatedRef.current.set(activeRef.current ? target : source);
      return;
    }

    const elapsed = performance.now() - state.startTime;

    if (state.phase === "activating") {
      const duration = activateDuration;
      const rawT = Math.min(1, elapsed / duration);
      const t = easing(rawT);
      const start = state.startPositions;
      for (let i = 0; i < n; i++) {
        animatedRef.current[i] = start[i] + (target[i] - start[i]) * t;
      }
      if (rawT >= 1) {
        stateRef.current = { ...state, phase: "tracking" };
      }
    } else if (state.phase === "tracking") {
      // Animation done: track target directly
      animatedRef.current.set(target);
    } else if (state.phase === "deactivating") {
      const duration = deactivateDuration;
      const rawT = Math.min(1, elapsed / duration);
      const t = easing(rawT);
      const start = state.startPositions;
      for (let i = 0; i < n; i++) {
        animatedRef.current[i] = start[i] + (source[i] - start[i]) * t;
      }
      if (rawT >= 1) {
        stateRef.current = null; // back to idle
      }
    }
  });

  return animatedRef;
}
```

**Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors in the new file.

**Step 3: Commit**

```bash
git add src/hooks/useLensTransition.ts
git commit -m "feat: add useLensTransition hook for smooth lens mode position animation"
```

---

### Task 2: Wire `useLensTransition` into ChunksScene

**Files:**
- Modify: `src/components/chunks-r3f/ChunksScene.tsx`

**Context:** The position pipeline in the `useFrame` block (around line 688–748) currently:
1. Merges focus overrides into `positionsWithOverrides`
2. Applies fisheye compression → writes result to `compressedPositionsRef.current`
3. Sets `let renderPositions = positionsWithOverrides` at line 706, then reassigns to `compressedPositionsRef.current` at line 747

We want `renderPositions` in the per-node loop (lines 785–786) to use the hook's animated output instead.

**Step 1: Add import**

At the top of `ChunksScene.tsx`, add:

```typescript
import { useLensTransition } from "../../hooks/useLensTransition";
```

**Step 2: Create a stable ref for layoutPositions**

`layoutPositions` is a `Float32Array` returned from `useChunkForceLayout`. We need a ref to pass to the hook. Find where `layoutPositions` is used (around line 688) and add a ref that stays in sync. Add near the other `useRef` declarations:

```typescript
const layoutPositionsRef = useRef<Float32Array>(new Float32Array(0));
```

Then inside `useFrame`, right before the position pipeline block, add:

```typescript
layoutPositionsRef.current = layoutPositions;
```

**Step 3: Call the hook**

Add the hook call after the other hook calls (before the `useFrame`). `setupUpdateLoop` should use R3F's `useFrame` — look at how other hooks in ChunksScene are called with a `setupUpdateLoop` pattern (e.g. `usePositionInterpolation` if used, or inline the useFrame wrapper). Since `useLensTransition` needs to run inside the same frame as the fisheye computation, call it this way:

```typescript
const animatedPositionsRef = useLensTransition(
  layoutPositionsRef,
  compressedPositionsRef,
  lensActive,
  (cb) => useFrame(() => cb()),
);
```

**Important:** `lensActive` is computed at line 291. The hook call must be placed **after** `lensActive` is defined and **before** the `useFrame` that does rendering.

**Step 4: Use animated output as renderPositions**

In the `useFrame` block, the fisheye pipeline currently ends with:
```typescript
renderPositions = compressedPositionsRef.current;  // line ~747
```

After this line, add:
```typescript
renderPositions = animatedPositionsRef.current;
```

This ensures the final `renderPositions` is the animated version regardless of whether lensActive is true or false, since the hook handles the passthrough to the appropriate source.

Also update the fallback at line 706:
```typescript
let renderPositions = animatedPositionsRef.current;
```
Replace `positionsWithOverrides` with `animatedPositionsRef.current` so the non-lens path also goes through the hook (hook passes source through when idle).

**Step 5: Type-check**

```bash
npx tsc --noEmit
```

Fix any type errors (most likely Float32Array mutability — use `as Float32Array` if needed for ref assignments).

**Step 6: Manual test**

Run `npm run dev` and open ChunksView. Click a chunk to activate lens mode. Verify:
- [ ] Nodes smoothly animate into fisheye positions over ~500ms (not an instant snap)
- [ ] Clicking another area to deactivate lens smoothly animates back over ~400ms
- [ ] Scale animations (card grow/shrink) still work as before
- [ ] No console errors

**Step 7: Commit**

```bash
git add src/components/chunks-r3f/ChunksScene.tsx
git commit -m "feat: smooth lens mode transition in ChunksView using useLensTransition"
```

---

### Task 3: Update docs index

**Files:**
- Modify: `docs/README.md`

Add a link to the design doc under the plans or patterns section:

```markdown
- [Lens Transition Animation](plans/2026-02-18-lens-transition-animation-design.md)
```

**Step 1: Add link and commit**

```bash
git add docs/README.md
git commit -m "docs: link lens transition design from README"
```
