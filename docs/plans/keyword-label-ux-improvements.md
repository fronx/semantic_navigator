# Keyword Label UX Improvements

**Date**: 2026-02-07
**Status**: Planning

## Goals

Improve the usability of 3D keyword labels with three key enhancements:

1. **Opacity cross-fading** between cluster labels and keyword labels
2. **Cursor-proximity filtering** (max 12 labels around mouse)
3. **Keyword node fade-out** when labels are visible

## Requirements

### 1. Cross-fading Between Cluster and Keyword Labels

**Behavior**: Inverse relationship between cluster and keyword label opacity
- As zoom increases (closer): cluster labels fade out, keyword labels fade in
- Formula: `clusterOpacity = 1 - keywordOpacity`

**Challenge**: Labels have different sizes (cluster labels ~52px, keyword labels ~16px)
- Pixel-size-based fade won't work directly (same camera position = different pixel sizes)
- Need zoom-based fade coordinator that works independent of label size

**Solution**: Extract a fade coordinator that:
- Takes camera Z position as input
- Returns normalized fade value (0-1)
- Works across the existing cluster fade range (60-100px equivalent zoom)
- Cluster labels use `fadeT` directly
- Keyword labels use `1 - fadeT`

### 2. Cursor-Proximity Filtering

**Behavior**: Show maximum 12 keyword labels, prioritized by distance to cursor

**Filtering strategy**: Remove degree threshold filtering entirely (Option A)
- Old: Filter by node degree (connections), then show eligible labels
- New: Always show the 12 closest labels to cursor, regardless of connections

**Implementation**:
- Track cursor position in 3D world space
- Each frame, compute distance from cursor to each keyword node
- Sort by distance ascending
- Take top 12
- Apply smooth opacity fade based on rank/distance to prevent pop-in

**Transition**: Smooth fade-in/fade-out as cursor moves
- Labels smoothly fade when entering/leaving top 12
- Consider hysteresis or distance-based fade curve to prevent flickering

### 3. Keyword Node Fade-Out

**Behavior**: Keyword nodes shrink as labels become visible (inverse relationship)

**Fade property**: Size (not opacity)
- When `keywordLabelOpacity = 1.0` → `keywordNodeScale = 0` (or very small)
- When `keywordLabelOpacity = 0.0` → `keywordNodeScale = 1.0` (normal size)

**Implementation**: In `KeywordNodes.tsx`:
- Import/use the same fade coordinator as labels
- Apply inverse fade to scale multiplier: `scale *= (1 - keywordLabelFadeT)`

## Implementation Steps

### Step 1: Create Fade Coordinator

**File**: `src/lib/label-fade-coordinator.ts`

```typescript
export interface LabelFadeConfig {
  /** Camera Z distance where keyword labels start appearing */
  fadeStartZ: number;
  /** Camera Z distance where keyword labels are fully visible */
  fadeEndZ: number;
}

export function computeLabelFade(cameraZ: number, config: LabelFadeConfig): number {
  // Returns 0-1 where:
  // - 0 = cluster labels fully visible, keyword labels hidden
  // - 1 = keyword labels fully visible, cluster labels hidden
  const { fadeStartZ, fadeEndZ } = config;
  const t = (cameraZ - fadeStartZ) / (fadeEndZ - fadeStartZ);
  return smoothstep(clamp(t, 0, 1));
}
```

**Configuration**: Map from existing cluster label pixel thresholds (60-100px) to camera Z distances

### Step 2: Update ClusterLabels3D

- Import fade coordinator
- Replace pixel-based fade with zoom-based fade: `opacity *= (1 - fadeT)`
- Keep pixel-based size fade for consistency (labels should still fade when too small)

### Step 3: Update KeywordLabels3D

**Remove degree filtering**:
- Delete `computeDegreeThreshold` function
- Remove degree threshold logic from `useFrame`

**Add cursor-proximity filtering**:
- Track cursor position (from props or context)
- Compute world-space cursor position from screen coords
- Each frame:
  1. Compute distance from cursor to each keyword node
  2. Sort by distance
  3. Assign rank (0-11 for top 12, Infinity for rest)
  4. Apply rank-based opacity fade
- Base opacity formula: `opacity = keywordLabelFadeT * rankFadeT`

**Add smooth transitions**:
- Use distance-based fade curve (e.g., fade over last 20% of distance to 13th label)
- Or use rank-based fade (labels 10-12 fade to prevent hard cutoff)

### Step 4: Update KeywordNodes.tsx

- Import fade coordinator
- Apply inverse fade to scale: `scaleMultiplier *= (1 - keywordLabelFadeT)`
- Ensure this applies to all keyword nodes, not just the 12 with labels

### Step 5: Wire Through Props

- `R3FTopicsScene` computes `labelFadeT` using fade coordinator
- Pass to `ClusterLabels3D`, `KeywordLabels3D`, `KeywordNodes`
- May need to add `cursorPosition` to `KeywordLabels3D` props

## Open Questions

1. **Fade range**: What camera Z distances should map to the fade transition?
   - Need to calibrate based on existing cluster label behavior
   - Cluster labels currently fade based on 60-100px pixel size
   - Convert to equivalent camera Z range

2. **Cursor position source**: Where do we get cursor position?
   - Already tracked somewhere in hover controller?
   - Or need to add new tracking in canvas?

3. **Proximity fade curve**: How should the 12th → 13th label transition?
   - Hard cutoff (12 visible, rest hidden)?
   - Soft fade (labels 10-12 fade gradually)?
   - Distance-based fade (fade over distance threshold)?

4. **Node size minimum**: When labels are fully visible, should nodes be:
   - Completely invisible (scale = 0)?
   - Very small but still visible (scale = 0.1)?

## Success Criteria

- [ ] Cluster labels and keyword labels cross-fade smoothly (inverse relationship)
- [ ] Only 12 keyword labels visible at any time, closest to cursor
- [ ] Labels smoothly fade in/out as cursor moves (no popping)
- [ ] Keyword nodes shrink as labels appear (inverse relationship)
- [ ] No flicker or performance issues with cursor tracking
- [ ] Text remains readable (nodes don't overlap labels)
