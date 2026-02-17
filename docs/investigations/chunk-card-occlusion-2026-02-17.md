# Chunk Card Occlusion Investigation

**Date:** 2026-02-17
**Status:** Implemented

## Problem

When chunk cards overlap each other in the UMAP scatter plot, the text labels of background cards show through the foreground cards. Cards should occlude each other like physical cards dropped on a surface.

## Root Cause

All cards were placed at `z=0` in world space, while text labels were at `z=0.15` (closer to the camera). Since text was always closer to the camera than all cards, depth testing never blocked any text. No card could ever occlude any other card's text.

The `depthTest: true` on the text material was correct in principle, but ineffective because text was universally "in front of" all cards rather than behind the overlapping foreground cards.

## Failed Approaches Considered

### Dynamic camera-distance ordering
Place cards at `z = -distance_from_camera_center * scale`. Cards near camera center are closer (z≈0), cards far from center are pushed back (z negative). This works logically but:
- Z ordering changes every frame as the camera pans → causes flickering
- At large camera distances, depth buffer precision may be insufficient for small z differences

### Stencil buffer / clip-to-card bounds
Per-card stencil masking would work but is incompatible with instanced mesh rendering (all instances share the same draw call and renderOrder).

### Global text clipping to 4 sides
The existing bottom-clipping approach extended to all 4 sides would clip text to its own card bounds, but where card A overlaps card B, text B (clipped to B's bounds) still renders in the overlap region — both texts show in the overlap.

## Solution: Stable Per-Index Z Ordering

Assign each card a z value based purely on its array index. Card `i` sits at:

```
cardZ     = i * cardZStep           // the card face
textZForCard = i * cardZStep + cardZStep / 2  // the card's text (half-step in front)
```

Where `cardZStep = CARD_Z_RANGE / count`.

**Why it works:**
- Card `i+1` (closer to camera, z = `(i+1)*step`) is always closer than card `i`'s text (z = `i*step + step/2`), since `step > step/2`
- Any card at a higher index occludes text from any lower-index card in overlap regions
- Z ordering is computed once from the chunk array order — never changes as camera moves

**Constants:**
- `CARD_Z_RANGE = 20` (total world-unit z budget)
- `cardZStep = CARD_Z_RANGE / count` (scales with card count; text offset is `cardZStep / 2`)

## Depth Buffer Precision Analysis

Camera: near=1, far=100000, typical viewing z=200–600 (text visible below z=600).

Depth buffer precision at distance `d` from camera:
```
ε ≈ d² × 5.96e-8  (world units, for 24-bit depth buffer, near=1, far=100000)
```

At camera z=200 (text fully visible): ε ≈ 0.0024 world units
At camera z=400: ε ≈ 0.0095 world units
At camera z=600 (text starts fading in): ε ≈ 0.0215 world units

With `CARD_Z_RANGE=20` and `N=1000` cards: `step = 0.02`
- At z=200: step (0.02) >> ε (0.0024) ✓
- At z=400: step (0.02) > ε (0.0095) ✓
- At z=600: step (0.02) ≈ ε (0.0215) — borderline, but text opacity is 0 at this threshold

**Visual size variation:** When zoomed in enough to see text (~50 cards visible), those 50 cards span `50 × 0.02 = 1.0` world unit of z at camera z=200. Perspective size variation: 1.0/200 = 0.5% — imperceptible.

## Implementation

**ChunksScene.tsx:**
- Replaced `CARD_DEPTH_SCALE` / `TEXT_Z_OFFSET` constants with `CARD_Z_RANGE = 20`
- Compute `cardZStep = CARD_Z_RANGE / n` before the instance loop (stable each frame)
- `cardZ = i * cardZStep` and `textZForCard = cardZ + cardZStep / 2` per instance

**ChunkTextLabels.tsx:**
- Removed `textZ` prop — text z is now carried through `screenRect.z`
- `ScreenRect.z` is set by `projectCardToScreenRect` to `textZForCard`
- `group.position.set(x, y, screenRect.z)` positions text at the correct per-card z

**screen-rect-projection.ts:**
- `ScreenRect.z` field stores the world z for text positioning (card z + half-step offset)

## Data Flow

```
ChunksScene useFrame:
  cardZ = i * cardZStep
  textZForCard = cardZ + cardZStep / 2
  → posVec.set(x, y, cardZ)          → instancedMesh card position
  → projectCardToScreenRect(x, y, textZForCard, ...) → screenRect.z = textZForCard

ChunkTextLabels useFrame:
  screenRect = screenRectsRef.get(index)
  group.position.set(x, y, screenRect.z)  → text at textZForCard
```
