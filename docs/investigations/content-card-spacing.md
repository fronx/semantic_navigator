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

**Planned fix**: Collapse off-screen content nodes to their parent keyword centroid with zero collision radius, so they take up no space. See "Off-Screen Collapse" section below.

### B. Card size changes but spacing doesn't

As you zoom in, `contentScale` goes from ~0 to 0.3 (capped in `content-scale.ts:69`). The collision radius stays at `contentRadius * 1.2` regardless.

- **Far zoom**: Cards are tiny on screen but spaced as if full-size — too much empty space around keywords
- **Close zoom**: Cards are at max visual size but spacing was set for a "one size fits all" — can feel cramped when many cards are large

### C. Fisheye creates a separate geometry

In focus mode, `fisheye-viewport.ts` applies asymptotic radial compression AFTER the simulation runs. Cards that the simulation spread out nicely get compressed into a smaller area.

The simulation has no awareness of this compression, so cards that had no overlap in natural space may overlap in compressed space.

## Key Insight: Spacing Should Be Emergent, Not Prescribed

The current system prescribes a max distance envelope based on content count:
```
maxDistance = keywordRadius * 2.5 + sqrt(contentCount) * contentRadius * 1.5
```

This is wrong in principle. The correct distance between a card and its keyword is not determined by the number of cards or the zoom level as abstract parameters. It's determined by **how much physical space is needed to pack the visible cards at their current rendered size around the keyword dot**.

This means:
- **No max distance formula** — remove the `maxDistance` constraint entirely
- **No count-based heuristics** — `sqrt(N)` doesn't belong in spacing logic
- **Collision radius = actual visual size** — scale collision with `contentScale` so the simulation matches what's rendered
- **Strong attraction** — cards are pulled toward keyword; the only thing stopping them from overlapping is their physical size and each other

The equilibrium distance emerges naturally:
- Few visible cards at close zoom (large) → cards orbit close, spread by their own size
- Many visible cards at close zoom → cards pack tighter, overflow into a second ring
- Far zoom (tiny cards) → collision radius is tiny, cards cluster tight around keyword
- Isolated keyword with lots of room → cards spread slightly more (no neighbor pressure)

### What This Looks Like in the Simulation

The tether force simplifies to:
1. **Spring attraction** toward parent keyword (existing, keep)
2. **No max distance enforcement** (remove the `closestDist > maxDistance` block)

The collision force changes to:
1. **Radius = `contentRadius * contentScale`** instead of fixed `contentRadius`
2. Where `contentScale` is read from a ref updated per-frame from `calculateScales(cameraZ)`

This is a cleaner separation: attraction pulls cards in, collision at the right size pushes them apart, and the equilibrium is exactly right for the current zoom and visible count.

## Planned Changes

### 1. Off-Screen Collapse (Problem A)

**Status**: Architecture designed, ready for implementation.

Extract `computePrimaryKeywordIds()` from ContentNodes render loop into a shared utility. Compute in R3FTopicsScene's useFrame before simulation tick. In the custom tether force, content nodes with no visible parent collapse to parent centroid with zero velocity and zero collision radius.

Files:
- `src/lib/content-primary-keywords.ts` (new — extract primary keyword computation)
- `src/hooks/useContentSimulation.ts` (modify — read primaryKeywordIdsRef, collapse off-screen nodes)
- `src/components/topics-r3f/UnifiedSimulation.tsx` (modify — same treatment)
- `src/components/topics-r3f/R3FTopicsScene.tsx` (modify — compute primary keywords before tick)
- `src/components/topics-r3f/ContentNodes.tsx` (modify — read from ref instead of computing locally)

### 2. Zoom-Proportional Collision (Problem B)

Make collision radius track actual visual size by scaling with `contentScale`.

- Pass `cameraZ` (or a `contentScaleRef`) to the simulation
- Collision radius function: `contentRadius * contentScale` (instead of fixed `contentRadius`)
- This means: at far zoom, collision is tiny (cards cluster tight); at close zoom, collision matches card size (correct spacing)
- The `maxDistance` constraint in tetherToParent is removed — distance emerges from packing

**Tension**: `contentScale` changes every frame during zoom. D3's `forceCollide` caches radii; would need to call `.radius(fn)` each time contentScale changes significantly, or use a custom collision force that reads a ref.

### 3. Fisheye-Aware Spacing (Problem C)

Still open. Options:
- Run a second collision pass after fisheye compression
- Make fisheye aware of card sizes and adjust compression to preserve spacing
- Accept some overlap in fisheye mode as a visual trade-off

## Open Questions

1. How to handle the transition when zooming: collision radius changing means the simulation re-heats. How much jitter is acceptable during zoom?
2. Should `contentScale` feed directly into D3's collision, or should we use a custom collision force that reads a ref? (D3's forceCollide caches radii — updating requires `.radius(fn)` call which reinitializes.)
3. Is fisheye overlap acceptable, or does it need its own spacing solution?
4. With emergent spacing, is the spring strength the right tuning knob? (Stronger spring = tighter packing, weaker = more spread.)
