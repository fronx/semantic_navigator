# Work in Progress: Cluster Label Shadows & R3F Hover Highlighting

**Date:** 2026-02-09
**Status:** Partially Complete

## Overview

Two features being implemented for the R3F renderer:
1. **Cluster label soft drop shadows** - Improve readability when zoomed out
2. **Topological hover highlighting** - Bring D3's spatial-semantic highlighting to R3F

## Feature 1: Cluster Label Shadows

### ✅ Completed

1. **Settings Infrastructure**
   - Added `clusterLabelShadowStrength` to `useTopicsSettings.ts` (default: 0.8)
   - Added slider in ControlSidebar under "Cluster Labels" subsection
   - Threaded prop through: TopicsView → R3FTopicsCanvas → R3FTopicsScene → ClusterLabels3D

2. **Shadow Rendering System**
   - Modified `ClusterLabels3D.tsx` to support shadow rendering
   - Added `shadowMaterial` to `LabelRegistration` interface
   - Shadow opacity now updates in `useFrame` loop, synced with label fade
   - Shadow fades with label (size fade + label fade + search opacity)

3. **UI Organization**
   - Added "Cluster Labels" subsection in ControlSidebar Display section
   - Clear separation from general display settings

### ✅ Shadow Implementation - Simplified (2026-02-09)

**Current approach:**
- Single shadow mesh positioned close behind text at `[2, -2, -0.13]`
- Shadow opacity identical to label opacity (guaranteed by using same `finalOpacity` value)
- No scaling - shadow is same size as text
- `shadowStrength` slider (0-2) controls whether shadow is shown (0 = no shadow, >0 = show shadow)

**Key design decision:**
- Shadow tracks label opacity exactly - they fade together as one unit
- Simpler than multi-layer approach, no duplicated opacity logic
- Not true Gaussian blur, but clean and performant

**Future improvements (if needed):**
1. **troika-three-text** - Has built-in drop shadow with `outlineBlur` + `outlineOffset`
2. **Post-processing** - Selective blur pass for true soft shadows
3. **Hybrid approach** - Use troika just for cluster labels, keep three-text for keyword labels

### Files Modified

- `src/hooks/useTopicsSettings.ts` - Added setting
- `src/components/ControlSidebar.tsx` - Added slider with subsection
- `src/components/topics-r3f/ClusterLabels3D.tsx` - Shadow rendering (needs rework)
- `src/components/topics-r3f/R3FTopicsScene.tsx` - Pass shadowStrength prop
- `src/components/topics-r3f/R3FTopicsCanvas.tsx` - Pass shadowStrength prop
- `src/components/TopicsView.tsx` - Accept shadowStrength prop
- `src/app/topics/page.tsx` - Pass setting to TopicsView

---

## Feature 2: Topological Hover Highlighting

### 📋 Plan (Not Started)

**Goal:** Bring D3's spatial-semantic hover highlighting to R3F renderer

**Current state:**
- Algorithm already shared in `topics-hover-controller.ts`
- D3 renderer uses it successfully
- R3F only tracks cursor position, no highlighting

**Implementation approach:**
1. Create `useR3FHoverController` hook (bridge between shared algorithm and R3F)
2. Integrate into `R3FTopicsCanvas` (mouse event handlers)
3. Update `R3FTopicsScene` to pass highlight refs
4. Add hover dimming to `KeywordNodes.tsx` (dim non-highlighted to 15% opacity)
5. Add hover dimming to `KeywordEdges.tsx` (dim edges where endpoints not highlighted)
6. Add hover dimming to `ContentNodes.tsx` and `ContentEdges.tsx`

**Key pattern:**
- Ref-based imperative updates in `useFrame` (avoid React re-renders at 60fps)
- Opacity application order: base → tier → search → **hover** (LAST)
- Use `useStableCallback` for all callbacks to prevent recreation

**Files to create/modify:**
- `src/hooks/useR3FHoverController.ts` (NEW)
- `src/components/topics-r3f/R3FTopicsCanvas.tsx`
- `src/components/topics-r3f/R3FTopicsScene.tsx`
- `src/components/topics-r3f/KeywordNodes.tsx`
- `src/components/topics-r3f/KeywordEdges.tsx`
- `src/components/topics-r3f/ContentNodes.tsx`
- `src/components/topics-r3f/ContentEdges.tsx`

---

## Additional User Requests

### 1. Click-to-Focus Behavior Change

**Current behavior:**
- Click on keyword → focus on that keyword + 2-hop neighbors
- Single-node center + margin nodes

**Requested behavior:**
- Click while hovering with highlighter active → set ALL highlighted keywords as focus zone
- Multi-node focus center instead of single node
- More flexible than current 2-hop pattern

**Implementation approach:**
- Modify hover controller's `handleClick()` to read `highlightedIdsRef`
- Pass highlighted set to focus state creator
- Update `createFocusState` to support multi-node centers
- May need to adjust focus animation (currently animates from single center)

**Files to modify:**
- `src/lib/topics-hover-controller.ts` - Update click handler
- `src/lib/focus-mode.ts` - Support multi-node focus centers
- `src/components/topics-r3f/KeywordNodes.tsx` - Update focus animation if needed

---

## Testing Checklist

### Cluster Label Shadows (After Gaussian Blur Fix)
- [ ] Shadow appears behind cluster labels
- [ ] Shadow is soft/blurred, not hard-edged
- [ ] Shadow fades with label (zoom in/out)
- [ ] Shadow fades with label (cross-fade with keyword labels)
- [ ] Shadow opacity controlled by slider (0-2 range)
- [ ] Shadow works in both light and dark mode
- [ ] Performance: no significant FPS drop

### Topological Highlighter
- [ ] Hovering over graph highlights nodes within spatial radius
- [ ] Semantically similar nodes are highlighted
- [ ] Non-highlighted nodes dimmed to ~15% opacity
- [ ] Edges between highlighted nodes remain visible
- [ ] Edges to dimmed nodes nearly invisible
- [ ] Behavior matches D3 renderer
- [ ] No label flicker (callbacks use useStableCallback)
- [ ] Click-to-focus uses highlighted set (not single node)

---

## Technical Notes

### Cluster Label Shadow Opacity (Simplified)
```typescript
// In useFrame loop (ClusterLabels3D.tsx):
const finalOpacity = baseOpacity * sizeFade * (1 - labelFadeT);

// Shadow uses IDENTICAL opacity - no separate calculation
material.opacity = finalOpacity;
shadowMaterial.opacity = finalOpacity; // Same value!

// Where:
// - baseOpacity: visibility ratio * search opacity
// - sizeFade: smoothstep fade based on screen pixel size
// - (1 - labelFadeT): cross-fade with keyword labels
// - shadowStrength: only controls whether shadow is shown (>0) or hidden (0)
```

### Label Flicker Prevention Pattern
```typescript
// WRONG - recreates callback every mouse move:
<Component onHover={(id) => { ref.current = id; }} />

// CORRECT - stable callback:
const stableOnHover = useStableCallback((id) => {
  ref.current = id;
  onKeywordHover(id);
});
<Component onHover={stableOnHover} />
```

### R3F Hover Highlighting Data Flow
```
Mouse move
  → hoverController.handleMouseMove()
  → computeHoverHighlight() (spatial-semantic algorithm)
  → adapter.applyHighlight()
  → writes to highlightedIdsRef
  → useFrame reads ref
  → applies opacity via colorRef.multiplyScalar()
```

---

## Next Steps

1. **Research soft shadow techniques** (web search + THREE.js docs)
2. **Implement proper Gaussian blur shadow** for cluster labels
3. **Create useR3FHoverController hook** with adapter
4. **Integrate hover highlighting** into all R3F components
5. **Modify click behavior** to use highlighted set for focus
6. **Test end-to-end** with both features working together

---

## References

- Original plan: `/Users/fnx/.claude/plans/adaptive-frolicking-torvalds.md`
- Shared hover algorithm: `src/lib/topics-hover-controller.ts`
- D3 implementation: `src/hooks/useD3TopicsRenderer.ts`
- Label stability patterns: `docs/patterns/label-manager-stability.md`
- Focus mode: `src/lib/focus-mode.ts`
