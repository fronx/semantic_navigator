# Keyword Label UX Improvements

**Date**: 2026-02-07
**Status**: Implemented (initial pass)

## Goals

Improve the usability of 3D keyword labels with three key enhancements:

1. **Opacity cross-fading** between cluster labels and keyword labels
2. **Cursor-proximity filtering** (max 12 labels around mouse)
3. **Keyword node fade-out** when labels are visible

## Implementation Summary

### Fade Coordinator (`src/lib/label-fade-coordinator.ts`)

`computeLabelFade(cameraZ, range)` returns 0-1:
- 0 = far away (cluster labels visible, keyword labels hidden)
- 1 = zoomed in (keyword labels visible, cluster labels hidden)

Reuses existing `zoomPhaseConfig.keywordLabels` range (start=13961 far, full=1200 close) with smoothstep interpolation.

### Cross-fading (ClusterLabels3D + KeywordLabels3D)

- `ClusterLabels3D`: opacity multiplied by `(1 - labelFadeT)` — fades out as you zoom in
- `KeywordLabels3D`: opacity multiplied by `labelFadeT` — fades in as you zoom in
- Both retain existing pixel-size-based fade for when labels get too large

### Cursor-Proximity Filtering (KeywordLabels3D)

Replaced degree-threshold filtering with proximity-based:
- Removed `computeDegreeThreshold`, `nodeDegrees` prop, `keywordLabelRange` prop
- Each frame: compute squared distance from cursor to each keyword, sort, take top 12
- Rank-based tail fade: labels 10-12 fade from 1.0 to 0.3 (prevents hard cutoff)
- Uses `cursorWorldPosRef` (already computed in R3FTopicsScene's useFrame)
- Reusable sort buffer avoids per-frame allocation

### Keyword Node Fade-Out (KeywordNodes)

- Scale multiplied by `(1 - labelFadeT)` — nodes shrink to 0 as labels become fully visible
- Applies to ALL keyword nodes uniformly (not just the 12 with visible labels)

### Wiring (R3FTopicsScene)

- Computes `labelFadeT` from `cameraZ ?? camera.position.z` using `computeLabelFade`
- Passes `labelFadeT` to ClusterLabels3D, KeywordLabels3D, KeywordNodes
- Passes `cursorWorldPosRef` to KeywordLabels3D
- Removed unused `nodeDegrees` React state (labelRefs.nodeDegreesRef still computed for other systems)

## Open Questions (resolved)

1. **Fade range**: Reuses existing `zoomPhaseConfig.keywordLabels` Z thresholds
2. **Cursor position source**: `labelRefs.cursorWorldPosRef` (already computed in R3FTopicsScene useFrame)
3. **Proximity fade curve**: Rank-based tail fade on labels 10-12
4. **Node size minimum**: Nodes go to scale=0 when `labelFadeT=1`

## Tuning Notes

- `labelFadeT` is computed at React render time (not per-frame). Smooth enough since `cameraZ` prop updates on zoom changes. If lag is visible, could move to per-frame ref.
- `MAX_VISIBLE_LABELS = 12` is a constant in KeywordLabels3D
- Tail fade covers last 3 labels (indices 9-11), fading from 1.0 to 0.3

## Files Changed

- **New**: `src/lib/label-fade-coordinator.ts`
- **Modified**: `src/components/topics-r3f/ClusterLabels3D.tsx`
- **Modified**: `src/components/topics-r3f/KeywordLabels3D.tsx`
- **Modified**: `src/components/topics-r3f/KeywordNodes.tsx`
- **Modified**: `src/components/topics-r3f/R3FTopicsScene.tsx`
