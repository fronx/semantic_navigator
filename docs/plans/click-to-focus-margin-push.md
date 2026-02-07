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

## Implementation Insights (captured during coding)

### Click handler mismatch (pre-existing)
The R3F click path passes **node IDs** (`KeywordNodes.handleClick → onKeywordClick(clickedNode.id)`), but `handleKeywordClickInternal` in TopicsView expected **keyword labels** (`activeNodes.find(n => n.label === keyword)`). This meant the old click-to-filter never actually worked for R3F keyword node clicks. Focus mode fixes this by accepting IDs directly via `handleFocusClick(keywordId: string)`.

### Animation lives in KeywordNodes.useFrame (not R3FTopicsScene)
Original plan put animation coordination in R3FTopicsScene. Actual implementation puts it in KeywordNodes.useFrame because:
- Margin target positions need `clampToBounds()` which requires current camera/viewport zones
- Camera is only available via `useThree()` inside the render loop
- KeywordNodes already computes pulled positions using the same viewport zones
- Same pattern: compute positions → write to shared ref → other components read

### focusPositionsRef is NOT in LabelRefs
Kept as a separate prop chain (R3FTopicsCanvas → R3FTopicsScene → KeywordNodes/KeywordEdges/KeywordLabels3D) rather than adding to LabelRefs. Reason: keyword labels are now 3D (KeywordLabels3D), so the DOM-based LabelsOverlay doesn't need focus positions. Adding to LabelRefs would be unnecessary coupling.

### Post-animation viewport tracking
After the 500ms push animation completes, margin nodes must continuously track the viewport edges (recalculated each frame via `clampToBounds`). Without this, panning/zooming while focused would leave margin nodes stranded at stale positions.

### topics-hover-controller.ts: NO changes needed
The hover controller's `onFilterClick` isn't connected to R3F at all (R3F handles clicks via `onPointerMissed` on Canvas and `onClick` on instancedMesh). No need to modify the hover controller.

### Focus mode edge filtering
Only edges within the focus set + boundary outgoing edges are shown. The rule: if either endpoint is a margin node, the edge is hidden UNLESS the non-margin endpoint is `"neighbor-2"` (the boundary of the focus set). This keeps the graph readable while preserving structural context at the focus boundary. Uses `keywordTiers` passed through to EdgeRenderer.

### Focus mode labels: no cursor dependency
In focus mode, all keyword labels are unconditionally visible — no proximity-based filtering, no cursor position needed. The `isFocusActive` flag (derived from `focusPositionsRef.current.size > 0`) bypasses both the `MAX_VISIBLE_LABELS` proximity limit and the `labelFadeT` cross-fade.

### Content node visibility in focus mode
Content nodes are only shown for "primary" keywords — on-screen, not in cliff zone, and not focus-margin pushed. The `focusPositionsRef` is checked when building `primaryKeywordIds` in ContentNodes. Content edges to non-primary keywords are also hidden via the same EdgeRenderer focus filtering.

### Camera center fallback
When the mouse isn't hovering over the canvas, `cursorWorldPosRef` falls back to camera center instead of null. This ensures proximity-based label filtering still works (labels near screen center visible).

### Implicit zoom-out reset
Focus is automatically cleared when zooming out past the keyword label range (`zoomPhaseConfig.keywordLabels.start`), returning to cluster-level view.

## Implementation Status — COMPLETE

1. `src/lib/focus-mode.ts` — `FocusState` type + `createFocusState()` using `createSemanticFilter` + `computeKeywordTiers`
2. `src/components/TopicsView.tsx` — `focusState` state, `handleFocusClick` (toggles focus), `handleBackgroundClick` (clears), zoom-out reset, passes `focusState` + effective tiers to R3FTopicsCanvas
3. `src/components/topics-r3f/R3FTopicsCanvas.tsx` — accepts `focusState`, `onBackgroundClick`; creates `focusPositionsRef`; wires `onPointerMissed` → `onBackgroundClick`; passes down
4. `src/components/topics-r3f/R3FTopicsScene.tsx` — accepts + passes `focusState`, `focusPositionsRef`, `keywordTiers` to KeywordNodes, KeywordEdges, ContentEdges, ContentNodes, KeywordLabels3D; camera center fallback for cursorWorldPosRef
5. `src/components/topics-r3f/KeywordNodes.tsx` — full animation logic:
   - `FocusAnimationState` ref with push/return types
   - Detects focusState changes via `prevFocusIdRef`
   - Push animation (500ms ease-out cubic) computes targets via `clampToBounds`
   - Return animation (400ms) from current positions back to natural
   - Post-animation continuous viewport tracking
   - Position priority: focus > pulled > natural
   - Margin nodes: 0.6x scale, 0.4x opacity (same as pulled)
   - Click on margin node → flyTo real position
6. `src/components/topics-r3f/KeywordEdges.tsx` — accepts + passes `focusPositionsRef` and `keywordTiers` to EdgeRenderer
7. `src/components/topics-r3f/EdgeRenderer.tsx` — focus position priority (focus > pulled > natural); focus edge filtering using `keywordTiers` (only focus-set + boundary→margin edges shown)
8. `src/components/topics-r3f/KeywordLabels3D.tsx` — `focusPositionsRef` for position overrides, focus-active bypasses proximity limit and labelFadeT, margin labels 0.7x scale / 0.3x opacity
9. `src/components/topics-r3f/ContentNodes.tsx` — `focusPositionsRef` excludes margin keywords from primary set, hiding their content nodes
10. `src/components/topics-r3f/ContentEdges.tsx` — passes `focusPositionsRef` and `keywordTiers` to EdgeRenderer, hiding content edges to non-primary keywords

## Architecture

```
TopicsView                      (state: focusState, zoom-out reset)
  └─ R3FTopicsCanvas            (creates focusPositionsRef, wires onPointerMissed)
       ├─ R3FTopicsScene        (passes props through, camera center fallback)
       │    ├─ KeywordNodes     (WRITES focusPositionsRef in useFrame — animation + tracking)
       │    ├─ KeywordEdges     (READS focusPositionsRef + keywordTiers for edge filtering)
       │    │    └─ EdgeRenderer (focus position priority, focus edge filtering)
       │    ├─ ContentNodes     (READS focusPositionsRef for primary keyword set)
       │    ├─ ContentEdges     (READS focusPositionsRef + keywordTiers for edge filtering)
       │    │    └─ EdgeRenderer
       │    └─ KeywordLabels3D  (READS focusPositionsRef for positions + visibility)
       └─ LabelsOverlay         (NOT affected — keyword labels are 3D now)
```

## Verification

**Manual testing:**
1. Click a keyword → verify non-neighbors smoothly animate to margins (500ms)
2. Click background → verify nodes smoothly return to natural positions (400ms)
3. Verify edges follow animated positions (no detachment)
4. Verify labels follow animated positions
5. Click different keyword during animation → verify graceful interrupt
6. Test with very small graph (all nodes are neighbors) → verify margin set is empty
7. Test interaction with viewport edge magnets (zoom/pan to trigger automatic pulling)
8. Click same keyword twice → verify toggle (focus on, focus off)
9. Zoom out to cluster level → verify focus auto-clears
10. Verify only focus-set + boundary edges visible (no margin-to-margin clutter)
11. Verify content nodes hidden for non-primary keywords
12. Verify labels visible without hovering (camera center fallback)

**Visual checks:**
- Focused keyword is larger than neighbors (1.5x from tier scales)
- Margin nodes are 0.6x scale, 0.4x opacity
- Only boundary→margin edges visible (not all margin edges)
- Margin labels are 0.7x scale, 0.3x opacity
- Content nodes only shown for focus-set keywords
- Animation uses smooth ease-out (no linear motion)

**Performance:**
- No React re-renders during animation (ref-driven)
- Smooth 60fps animation on graphs with 500+ nodes
- Check console for no useEffect flicker warnings

## Notes

- Animation is fully ref-driven (no setState in useFrame)
- Priority system ensures focus animation overrides viewport edge magnets
- Reuses existing infrastructure (clampToBounds, computeSemanticNeighborhoods)
- Clicking pulled or margin node → flyTo real position (not focus toggle)
