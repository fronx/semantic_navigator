# Shared Node Color Effects + ChunksView Focus Glow

## Problem

Focus glow logic is duplicated within TopicsView (KeywordNodes.tsx, KeywordLabels3D.tsx) and margin dim is duplicated across KeywordNodes and ContentNodes. Adding focus highlighting to ChunksView would create a third copy. There's no shared module for per-node visual color treatments.

## Design

Create `src/lib/node-color-effects.ts` — shared pure functions for color transformations applied per-node in useFrame loops. Follows the `edge-pulling.ts` pattern: shared computations in `src/lib/`, view-specific decisions stay in components.

### Shared module: `node-color-effects.ts`

```ts
// Constants
FOCUS_GLOW_FACTOR = 0.245
HOVER_GLOW_FACTOR = 0.35
HOVER_FOCUSED_GLOW_FACTOR = 0.105
MARGIN_DIM = 0.4

// Sets glowTarget to white (dark mode) or black (light mode). Call once per frame.
initGlowTarget(glowTarget: THREE.Color): void

// Applies focus + hover glow via lerp. Mutates color in place.
applyFocusGlow(color: THREE.Color, glowTarget: THREE.Color, focused: boolean, hovered: boolean): void
```

### Refactor existing code

- **KeywordNodes.tsx**: Replace inline glow (lines 282-289) and margin dim (line 263) with imports from `node-color-effects.ts`
- **KeywordLabels3D.tsx**: Replace inline glow (lines 306-308) with imports
- **ContentNodes.tsx**: Replace inline margin dim (line 359) with import

### Add to ChunksView

- **ChunksScene.tsx**: In the color loop (~line 640-653), after desaturation but before `setColorAt`, call `applyFocusGlow` for focus seed nodes (depth === 0 in `lensInfo.depthMap`). Ensure color loop runs every frame when lens is active.

### Cleanup

- Delete unused `applyLensColorEmphasis` and `HIGHLIGHT_COLOR` from `chunks-lens.ts`
