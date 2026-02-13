# Content Card Spacing: Problem Space

**Date:** 2026-02-13
**Status:** Analysis

## Problem

Content cards around keywords don't get the right amount of space. The simulation allocates space using a static heuristic (`sqrt(N) * radius * factor`) based on total content count, but the "right amount of space" depends on runtime conditions the simulation doesn't know about: what's visible, how big cards appear at the current zoom, and whether fisheye compression is active.

## Current System

Three mechanisms govern content card positioning:

### 1. Tether Force (world space, static)

In `useContentSimulation.ts` / `UnifiedSimulation.tsx`, each content node is spring-pulled toward its parent keyword(s). A hard max distance constrains how far it can drift:

```
maxDistance = keywordRadius * 2.5 + sqrt(contentCount) * contentRadius * 1.5
```

- `keywordRadius` = `BASE_DOT_RADIUS * DOT_SCALE_FACTOR` (fixed)
- `contentRadius` = `keywordRadius * contentSizeMultiplier * 1.2` (fixed, from slider)
- `contentCount` = total chunks attached to a keyword (all of them, not just visible)

### 2. Collision Force (world space, static)

D3's `forceCollide` prevents overlap using the same fixed `contentRadius`. All content nodes participate, regardless of visibility.

### 3. Visual Scaling (screen space, dynamic)

At render time, `calculateScales(cameraZ)` produces a `contentScale` (0 to 0.3) that multiplies the card's transform. Cards grow/shrink on screen as you zoom. But the simulation footprint — the space allocated around the keyword — stays the same.

## What the Simulation Doesn't Know

| Runtime factor | Affects visible layout? | Simulation aware? |
|---|---|---|
| Which cards are on-screen | Yes — off-screen cards push on-screen ones away | No |
| Visual card size at current zoom | Yes — `contentScale` ranges 0.01 to 0.3 | No |
| Fisheye compression (focus mode) | Yes — radially compresses positions post-sim | No |
| Edge pulling | Yes — pulled cards rendered at 0.6x scale | No |
| Neighboring keyword proximity | Yes — cards can intrude on neighbors | Only indirectly (charge force between keywords) |

## Three Specific Problems

### A. Off-screen cards occupy space

The simulation positions ALL content nodes for every visible keyword. A keyword with 15 chunks gets `sqrt(15) * contentRadius * 1.5` additional spread — even if 12 of those chunks are off-screen.

Visibility filtering in `ContentNodes.tsx` (lines 260-263) only controls rendering:

```ts
const hasVisibleParent = node.parentIds.some(pid => primaryKeywordIds.has(pid));
const isContentDriven = contentDrivenNodeIds.has(node.id);
const allParentsPushed = allMarginParents.has(node.id);
const isVisible = (hasVisibleParent || isContentDriven) && !allParentsPushed;
```

Invisible cards still participate in collision, pushing visible cards further from their parent.

### B. Card size changes but spacing doesn't

As you zoom in, `contentScale` goes from ~0 to 0.3 (capped in `content-scale.ts:69`). The collision radius stays at `contentRadius * 1.2` regardless.

- **Far zoom**: Cards are tiny on screen but spaced as if full-size → too much empty space around keywords
- **Close zoom**: Cards are at max visual size but spacing was set for a "one size fits all" → can feel cramped when many cards are large

### C. Fisheye creates a separate geometry

In focus mode, `fisheye-viewport.ts` applies asymptotic radial compression AFTER the simulation runs. Cards that the simulation spread out nicely get compressed into a smaller area.

The simulation has no awareness of this compression, so cards that had no overlap in natural space may overlap in compressed space.

## The Fundamental Tension

The simulation runs in **world space** with fixed parameters. The "right amount of space" is a **screen-space** question that depends on:

1. **What's visible** — viewport position + zoom level determine which cards need spacing
2. **How big they appear** — zoom → `contentScale` → visual card size in screen pixels
3. **Available room** — viewport bounds, neighboring keywords, fisheye compression zone
4. **Mode** — normal (natural positions) vs. focus (fisheye-compressed positions)

## Possible Approaches (not yet evaluated)

### I. Zoom-aware simulation parameters

Scale `contentRadius` and `maxDistance` by something derived from `contentScale`, so the simulation matches what's actually rendered. The simulation already receives `cameraZ` in `UnifiedSimulation` (for alpha/velocity tuning) — could extend this to collision radii.

**Tension**: Changing collision radii causes simulation instability (nodes suddenly overlap or fly apart). Would need careful damping.

### II. Viewport-filtered simulation input

Only feed content nodes that are (or will be) on-screen to the simulation. Off-screen nodes get no collision space.

**Tension**: Nodes pop in/out as you pan. Need hysteresis or fade-in to avoid jarring transitions. Also, the simulation needs time to converge after nodes enter.

### III. Post-simulation screen-space constraint pass

Keep the simulation for organic spread, but apply a second pass in `useFrame` (during render) that checks actual screen-space overlap and resolves it. Like a screen-space collision pass.

**Tension**: Runs every frame, could be expensive with many nodes. Also, corrections fight the simulation — nodes bounce between two systems.

### IV. Replace simulation with direct placement

Don't use D3 force simulation at all. Instead, compute positions analytically: arrange visible cards in a grid/spiral/ring around their parent keyword, sized to match current zoom. Recompute on zoom/pan changes.

**Tension**: Loses the organic feel of force-directed layout. Transitions between zoom levels would need explicit animation.

### V. Hybrid: simulation for topology, constraints for geometry

Use the simulation only to determine relative ordering/clustering of cards (which card is near which). Then, in the render pass, apply screen-space-aware scaling to spread them by the right amount given current zoom and viewport.

**Tension**: Two-phase system is more complex but separates concerns cleanly.

## Open Questions

1. Should content cards that are off-screen still exist in the simulation at all? Or should they be removed and re-added as they scroll into view?
2. Is the fisheye case different enough from normal mode to need its own spacing logic?
3. How much does simulation instability matter? (Users see it as "cards jittering" during zoom.)
4. Is analytical placement (Approach IV) worth the loss of organic layout?
