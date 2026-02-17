# Focus Activation Node Jump

**Date**: 2026-02-17
**Status**: Open
**Component**: ChunksView click-to-focus mode

## Symptoms

When clicking a node to enter focus mode (transitioning from no-focus to focused state), visible nodes jump outward from the screen center. The jump:

- Is immediate (not a gradual drift)
- Has magnitude proportional to distance from screen center — nodes near center barely move, nodes near edges jump more
- Only happens on the **first** focus activation (non-focus → focus transition)
- Does NOT happen on subsequent clicks while already in focus mode (clicking additional nodes, switching focus)
- Does NOT happen when closing the Reader / exiting focus mode

## What's been ruled out

- **Canvas resize**: The Reader is absolutely positioned (`absolute right-0`) and does not affect the flex layout. R3F's ResizeObserver (via `react-use-measure`) watches the inner container div, which doesn't change size. Confirmed by tracing the R3F resize detection code path.

## Likely cause

The transition from `lensActive=false` to `lensActive=true` activates several systems simultaneously in the first `useFrame` after re-render:

1. **Fisheye compression** (`applyFisheyeCompression`) — compresses nodes toward camera center
2. **Directional range compression** (`applyDirectionalRangeCompression`) — click-mode-only additional compression
3. **Similarity layout overrides** (`useClickFocusSimilarityLayout`) — D3 force simulation with charge repulsion
4. **Scale changes** — `computeLensNodeScale` scales lens nodes from `CARD_SCALE` to `CARD_SCALE * lensScale`

The outward-from-center pattern (proportional to distance) suggests either:
- The range compression or similarity layout introduces an initial outward displacement on the first frame
- The combined effect of position overrides + compression has a different net result on frame 1 vs steady state

On subsequent focus changes, these systems are already active, so the transition is within-system (reconfiguring) rather than off→on.

## Reproduction

1. Open ChunksView with focus mode set to "click"
2. Wait for UMAP to complete
3. Click any node — observe outward jump of visible nodes
4. Click a different node — no jump (already in focus mode)

## Files involved

- `src/components/chunks-r3f/ChunksScene.tsx` — useFrame loop where compression activates
- `src/hooks/useClickFocusSimilarityLayout.ts` — D3 simulation with charge repulsion
- `src/lib/fisheye-viewport.ts` — `applyFisheyeCompression`, `applyDirectionalRangeCompression`
- `src/lib/chunks-lens.ts` — `computeLensNodeScale`
