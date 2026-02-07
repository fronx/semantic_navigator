# Click-to-Focus: Animated Margin Push Interaction

## Context

Replace the current click-to-filter behavior with a more fluid "focus mode" interaction. Currently, clicking a keyword applies semantic filtering (hides unrelated nodes). The new behavior will keep all nodes visible but push non-neighbors to viewport margins with smooth animation.

**User requirements:**
- Click keyword → push all except 1st and 2nd order connections to margins
- Click background → reset (animate nodes back)
- Smooth animation with easing
- No filtering (all nodes remain visible)

**Why this is better:**
- Maintains spatial context (no nodes disappear)
- More fluid, less jarring than filter on/off
- Leverages existing viewport edge magnets infrastructure

## Implementation Plan

### 1. Core Focus Mode Computation (NEW file)

**Create:** `src/lib/focus-mode.ts`

Pure computation functions for focus state:

```typescript
export interface FocusState {
  focusedKeywordId: string;
  focusedNodeIds: Set<string>;  // focused + 1-hop + 2-hop neighbors
  marginNodeIds: Set<string>;   // all others (pushed to margin)
}

export interface FocusAnimationTarget {
  nodeId: string;
  targetX: number;
  targetY: number;
  startX: number;
  startY: number;
}
```

**Key functions:**
- `computeFocusState()` - Use existing `computeSemanticNeighborhoods()` from `topics-filter.ts` to identify 1-hop and 2-hop neighbors
- `computeMarginTargets()` - Reuse `clampToBounds()` from `viewport-edge-magnets.ts` to position margin nodes at viewport edges
- `computeReturnTargets()` - Calculate positions for animating nodes back to natural positions

### 2. State Management

**Modify:** `src/components/TopicsView.tsx`

- Add `focusState: FocusState | null` state
- Add `handleFocusClick(keywordId: string | null)` handler
  - Build adjacency map from `activeEdges`
  - Call `computeFocusState()` when clicking keyword
  - Set `null` when clicking background
- Pass `focusState` to `<R3FTopicsCanvas>`

**Modify:** `src/lib/topics-hover-controller.ts`

Update `handleClick()`:
- If empty space → call `onFocusClick(null)` to clear focus
- If keyword hovered → call `onFocusClick(keywordId)` to activate focus
- Remove existing `onFilterClick()` behavior

### 3. Animation Infrastructure

**Modify:** `src/components/topics-r3f/R3FTopicsScene.tsx`

Add focus animation ref (ref-driven, no React re-renders):
```typescript
const focusAnimationRef = useRef<{
  targets: Map<string, FocusAnimationTarget>;
  startTime: number;
  duration: number;  // 500ms for push, 400ms for return
  currentPositions: Map<string, { x: number; y: number }>;
} | null>(null);
```

In `useEffect` watching `focusState`:
- When focus activates → compute margin targets and initialize animation
- When focus clears → compute return targets and initialize reverse animation
- Pass `focusAnimationRef` to `<KeywordNodes>`

**Modify:** `src/components/topics-r3f/KeywordNodes.tsx`

In `useFrame`:
- Add ease-out cubic easing function: `(t) => 1 - (1 - t)^3`
- For each animating node, interpolate position:
  ```typescript
  const x = startX + (targetX - startX) * eased
  const y = startY + (targetY - startY) * eased
  ```
- **Position priority:** focus animation > viewport edge magnets > natural position
- Update `currentPositions` map for chaining animations
- Clear `focusAnimationRef` when `t >= 1`

### 4. Visual Hierarchy

**In KeywordNodes.tsx:**

Apply visual tiers based on focus state:
- **Focused keyword:** 1.2x scale (or use existing tier scaling from `semantic-filter-config.ts`)
- **1-hop neighbors:** 1.0x scale (normal)
- **2-hop neighbors:** 1.0x scale (normal)
- **Margin nodes:** 0.6x scale, 0.4x opacity (same as pulled nodes)

### 5. Edge Rendering

**Modify:** `src/components/topics-r3f/KeywordEdges.tsx`

- Add `focusPositionsRef` prop (similar to `pulledPositionsRef`)
- In edge rendering, use focus positions with priority:
  ```typescript
  const pos = focusPositionsRef.get(nodeId) ?? pulledPositionsRef.get(nodeId) ?? naturalPos
  ```
- Show edges from margin nodes to focused cluster (user preference)

**Modify:** `src/components/topics-r3f/LabelsOverlay.tsx`

- Add `focusPositionsRef` to label position calculation
- Same priority: focus > pulled > natural

### 6. Click Handler Integration

**Modify:** `src/components/topics-r3f/KeywordNodes.tsx`

Update `handleClick`:
- Remove special case for pulled nodes (or keep if focus mode should respect it)
- Call `onKeywordClick(clickedNode.id)` which flows to `handleFocusClick`

**Modify:** `src/components/topics-r3f/R3FTopicsCanvas.tsx`

- Replace `onKeywordClick` with focus-aware handler
- Keep `onPointerMissed` for background clicks

## Critical Files

### Core implementation:
- `src/lib/focus-mode.ts` (NEW) - Computation logic
- `src/components/topics-r3f/KeywordNodes.tsx` - Animation in useFrame
- `src/components/topics-r3f/R3FTopicsScene.tsx` - Animation coordination
- `src/components/TopicsView.tsx` - State management
- `src/lib/topics-hover-controller.ts` - Click handling

### Supporting updates:
- `src/components/topics-r3f/KeywordEdges.tsx` - Edge positioning
- `src/components/topics-r3f/LabelsOverlay.tsx` - Label positioning

### Reuse existing utilities:
- `src/lib/topics-filter.ts` → `computeSemanticNeighborhoods()` for 1-hop/2-hop
- `src/lib/viewport-edge-magnets.ts` → `clampToBounds()` for margin positioning
- `src/lib/semantic-filter-config.ts` → Tier scaling constants

## Implementation Sequence

1. Create `focus-mode.ts` with computation functions
2. Add state management in `TopicsView.tsx`
3. Add animation ref in `R3FTopicsScene.tsx`
4. Implement animation in `KeywordNodes.tsx` useFrame
5. Update click handlers in hover controller
6. Update edge/label rendering for focus positions
7. Test and refine animation timing/easing

## Verification

**Manual testing:**
1. Click a keyword → verify non-neighbors smoothly animate to margins (500ms)
2. Click background → verify nodes smoothly return to natural positions (400ms)
3. Verify edges follow animated positions (no detachment)
4. Verify labels follow animated positions
5. Click different keyword during animation → verify graceful interrupt
6. Test with very small graph (all nodes are neighbors) → verify margin set is empty
7. Test interaction with viewport edge magnets (zoom/pan to trigger automatic pulling)

**Visual checks:**
- Focused keyword is larger than neighbors
- Margin nodes are 0.6x scale, 0.4x opacity
- Edges from margin to focus cluster are visible
- Animation uses smooth ease-out (no linear motion)

**Performance:**
- No React re-renders during animation (ref-driven)
- Smooth 60fps animation on graphs with 500+ nodes
- Check console for no useEffect flicker warnings

## Notes

- Animation is fully ref-driven (no setState in useFrame)
- Priority system ensures focus animation overrides viewport edge magnets
- Reuses existing infrastructure (clampToBounds, computeSemanticNeighborhoods)
- Edge case: clicking pulled node might need special handling (TBD during implementation)
