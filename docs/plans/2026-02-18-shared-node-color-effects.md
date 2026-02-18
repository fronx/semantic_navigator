# Shared Node Color Effects + ChunksView Focus Glow

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract shared node color effects into a reusable module, eliminate duplication across TopicsView components, and wire focus glow into ChunksView.

**Architecture:** Create `src/lib/node-color-effects.ts` following the `edge-pulling.ts` pattern — shared pure functions in `src/lib/`, view-specific decisions stay in components. Refactor 3 existing components to use the shared module, then add ChunksView as a new consumer.

**Tech Stack:** Three.js (Color manipulation), React Three Fiber (useFrame loops)

---

### Task 1: Create shared `node-color-effects.ts`

**Files:**
- Create: `src/lib/node-color-effects.ts`
- Test: `src/lib/__tests__/node-color-effects.test.ts`

**Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { applyFocusGlow, initGlowTarget, FOCUS_GLOW_FACTOR, HOVER_GLOW_FACTOR, HOVER_FOCUSED_GLOW_FACTOR, MARGIN_DIM } from "../node-color-effects";

describe("node-color-effects", () => {
  describe("initGlowTarget", () => {
    it("sets white for dark mode", () => {
      const target = new THREE.Color();
      initGlowTarget(target, true);
      expect(target.getHex()).toBe(0xffffff);
    });

    it("sets black for light mode", () => {
      const target = new THREE.Color();
      initGlowTarget(target, false);
      expect(target.getHex()).toBe(0x000000);
    });
  });

  describe("applyFocusGlow", () => {
    it("does nothing when neither focused nor hovered", () => {
      const color = new THREE.Color(0.5, 0.5, 0.5);
      const original = color.clone();
      const glowTarget = new THREE.Color(1, 1, 1);
      applyFocusGlow(color, glowTarget, false, false);
      expect(color.equals(original)).toBe(true);
    });

    it("applies focus glow when focused", () => {
      const color = new THREE.Color(0.5, 0.5, 0.5);
      const glowTarget = new THREE.Color(1, 1, 1);
      applyFocusGlow(color, glowTarget, true, false);
      // Should lerp toward white by FOCUS_GLOW_FACTOR (0.245)
      const expected = new THREE.Color(0.5, 0.5, 0.5).lerp(new THREE.Color(1, 1, 1), FOCUS_GLOW_FACTOR);
      expect(color.r).toBeCloseTo(expected.r, 4);
    });

    it("applies hover glow when hovered (not focused)", () => {
      const color = new THREE.Color(0.5, 0.5, 0.5);
      const glowTarget = new THREE.Color(1, 1, 1);
      applyFocusGlow(color, glowTarget, false, true);
      const expected = new THREE.Color(0.5, 0.5, 0.5).lerp(new THREE.Color(1, 1, 1), HOVER_GLOW_FACTOR);
      expect(color.r).toBeCloseTo(expected.r, 4);
    });

    it("applies both glows when focused and hovered", () => {
      const color = new THREE.Color(0.5, 0.5, 0.5);
      const glowTarget = new THREE.Color(1, 1, 1);
      applyFocusGlow(color, glowTarget, true, true);
      // Focus first (0.245), then hover at reduced intensity (0.105)
      const expected = new THREE.Color(0.5, 0.5, 0.5);
      expected.lerp(new THREE.Color(1, 1, 1), FOCUS_GLOW_FACTOR);
      expected.lerp(new THREE.Color(1, 1, 1), HOVER_FOCUSED_GLOW_FACTOR);
      expect(color.r).toBeCloseTo(expected.r, 4);
    });
  });

  describe("constants", () => {
    it("exports expected values", () => {
      expect(FOCUS_GLOW_FACTOR).toBe(0.245);
      expect(HOVER_GLOW_FACTOR).toBe(0.35);
      expect(HOVER_FOCUSED_GLOW_FACTOR).toBe(0.105);
      expect(MARGIN_DIM).toBe(0.4);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/__tests__/node-color-effects.test.ts --run`
Expected: FAIL — module not found

**Step 3: Write implementation**

```ts
/**
 * Shared per-node color effects for useFrame render loops.
 * Pure functions that mutate THREE.Color in place (zero allocation).
 * Used by KeywordNodes, KeywordLabels3D, ContentNodes (TopicsView) and ChunksScene (ChunksView).
 */
import * as THREE from "three";

// --- Glow blend factors ---
/** Focused node glow: lerp toward theme highlight */
export const FOCUS_GLOW_FACTOR = 0.245;
/** Hovered (not focused) node glow */
export const HOVER_GLOW_FACTOR = 0.35;
/** Hovered + focused node: additional hover lerp (stacks with focus) */
export const HOVER_FOCUSED_GLOW_FACTOR = 0.105;

// --- Dim factors ---
/** Multiplier for margin / pulled nodes (reduces brightness) */
export const MARGIN_DIM = 0.4;

/**
 * Set glow target color based on dark/light mode.
 * Call once per frame before the per-node loop.
 * @param isDark - pass isDarkMode() result (avoids repeated media queries)
 */
export function initGlowTarget(glowTarget: THREE.Color, isDark: boolean): void {
  glowTarget.set(isDark ? 0xffffff : 0x000000);
}

/**
 * Apply focus and/or hover glow to a color via lerp toward glowTarget.
 * Mutates `color` in place. No-op if neither focused nor hovered.
 */
export function applyFocusGlow(
  color: THREE.Color,
  glowTarget: THREE.Color,
  focused: boolean,
  hovered: boolean,
): void {
  if (!focused && !hovered) return;
  if (focused) color.lerp(glowTarget, FOCUS_GLOW_FACTOR);
  if (hovered) color.lerp(glowTarget, focused ? HOVER_FOCUSED_GLOW_FACTOR : HOVER_GLOW_FACTOR);
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/__tests__/node-color-effects.test.ts --run`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/node-color-effects.ts src/lib/__tests__/node-color-effects.test.ts
git commit -m "feat: add shared node-color-effects module"
```

---

### Task 2: Refactor KeywordNodes.tsx to use shared module

**Files:**
- Modify: `src/components/topics-r3f/KeywordNodes.tsx`

**Step 1: Replace inline glow and dim**

Replace the import of `isDarkMode` and inline glow/dim code with the shared module:

- Add import: `import { applyFocusGlow, initGlowTarget, MARGIN_DIM } from "@/lib/node-color-effects";`
- Remove: `import { isDarkMode } from "@/lib/theme";` (if no other usages in file)
- Remove: `const glowTarget = useMemo(() => new THREE.Color(), []);` — replace with module-level `const glowTarget = new THREE.Color();` outside the component (no React dependency needed for a temp)
- At the top of the useFrame loop (before the per-node loop), add: `initGlowTarget(glowTarget, isDarkMode());`
  - Actually keep `isDarkMode` import since `initGlowTarget` needs it. Check if isDarkMode is used elsewhere in the file first.
- Replace lines 261-263 (margin dim):
  ```ts
  // Before:
  if (isFocusMargin || isPulled) {
    colorRef.current.multiplyScalar(0.4);
  }
  // After:
  if (isFocusMargin || isPulled) {
    colorRef.current.multiplyScalar(MARGIN_DIM);
  }
  ```
- Replace lines 282-289 (glow):
  ```ts
  // Before:
  const isFocused = currentFocusId === node.id;
  const isHovered = hoveredKeywordIdRef?.current === node.id;
  if (isFocused || isHovered) {
    glowTarget.set(isDarkMode() ? 0xffffff : 0x000000);
    if (isFocused) colorRef.current.lerp(glowTarget, 0.245);
    if (isHovered) colorRef.current.lerp(glowTarget, isFocused ? 0.105 : 0.35);
  }
  // After:
  const isFocused = currentFocusId === node.id;
  const isHovered = hoveredKeywordIdRef?.current === node.id;
  applyFocusGlow(colorRef.current, glowTarget, isFocused, isHovered);
  ```
- Move `initGlowTarget(glowTarget, isDarkMode())` to the top of useFrame, before the per-node loop (avoids calling isDarkMode inside the loop).
- Remove the `useMemo(() => new THREE.Color(), [])` for glowTarget; use a plain ref or module-level const instead.

**Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/topics-r3f/KeywordNodes.tsx
git commit -m "refactor: KeywordNodes uses shared node-color-effects"
```

---

### Task 3: Refactor KeywordLabels3D.tsx to use shared module

**Files:**
- Modify: `src/components/topics-r3f/KeywordLabels3D.tsx`

**Step 1: Replace inline glow**

Same pattern as Task 2:
- Add import: `import { applyFocusGlow, initGlowTarget } from "@/lib/node-color-effects";`
- Remove `isDarkMode` import if not used elsewhere in file
- Replace `const glowTarget = useMemo(() => new THREE.Color(), []);` with module-level const or useRef
- Add `initGlowTarget(glowTarget, isDarkMode())` at top of useFrame
- Replace lines 302-309:
  ```ts
  // Before:
  tempColor.copy(entry.baseColor);
  const isFocused = keywordTiers?.get(id) === "selected";
  if (isFocused || isHovered) {
    glowTarget.set(isDarkMode() ? 0xffffff : 0x000000);
    if (isFocused) tempColor.lerp(glowTarget, 0.245);
    if (isHovered) tempColor.lerp(glowTarget, isFocused ? 0.105 : 0.35);
  }
  // After:
  tempColor.copy(entry.baseColor);
  const isFocused = keywordTiers?.get(id) === "selected";
  applyFocusGlow(tempColor, glowTarget, isFocused, isHovered);
  ```

**Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/topics-r3f/KeywordLabels3D.tsx
git commit -m "refactor: KeywordLabels3D uses shared node-color-effects"
```

---

### Task 4: Refactor ContentNodes.tsx to use shared module

**Files:**
- Modify: `src/components/topics-r3f/ContentNodes.tsx`

**Step 1: Replace inline margin dim**

- Add import: `import { MARGIN_DIM } from "@/lib/node-color-effects";`
- Replace line 359:
  ```ts
  // Before:
  colorRef.current.multiplyScalar(0.4);
  // After:
  colorRef.current.multiplyScalar(MARGIN_DIM);
  ```

**Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/topics-r3f/ContentNodes.tsx
git commit -m "refactor: ContentNodes uses shared MARGIN_DIM constant"
```

---

### Task 5: Add focus glow to ChunksScene

**Files:**
- Modify: `src/components/chunks-r3f/ChunksScene.tsx`

**Step 1: Add focus glow to the color loop**

- Add import: `import { applyFocusGlow, initGlowTarget } from "@/lib/node-color-effects";`
- Add import: `import { isDarkMode } from "@/lib/theme";`
- Add a module-level `const glowTarget = new THREE.Color();` (or useRef)
- Store `lensInfo` in a ref so the useFrame loop can access it without causing re-renders:
  ```ts
  const lensInfoRef = useRef(lensInfo);
  lensInfoRef.current = lensInfo;
  ```
  (Check if a ref already exists — if lensInfo is already accessible in useFrame via closure, use that.)

- In the useFrame color loop condition (~line 638), add `lensActive` to the dirty check so colors update every frame during lens mode:
  ```ts
  if (colorChunksRef.current !== chunkColors || colorDirtyRef.current || desatChanged || previewActive || pullResult.pulledMap.size > 0 || lensActiveRef.current || !mesh.instanceColor) {
  ```
  (Need a `lensActiveRef` too — same ref pattern.)

- At the top of the color loop body, before the per-node loop:
  ```ts
  initGlowTarget(glowTarget, isDarkMode());
  ```

- Inside the per-node color loop, after pulled dim (line 652) and before `setColorAt` (line 653), add:
  ```ts
  const depth = lensInfoRef.current?.depthMap.get(i);
  if (depth === 0) {
    applyFocusGlow(tempColor.current, glowTarget, true, false);
  }
  ```

- Also check: is hovered index available in the color loop? If so, also wire hover glow:
  ```ts
  const isHovered = hoveredIndexRef.current === i;
  const isFocusSeed = lensInfoRef.current?.depthMap.get(i) === 0;
  applyFocusGlow(tempColor.current, glowTarget, isFocusSeed, isHovered);
  ```

**Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Manual test**

1. Open ChunksView
2. Click a chunk to activate lens
3. Verify focus seed has a glow (lighter/brighter than neighbors)
4. Hover over the focus seed — should get additional glow
5. Hover over a non-focused chunk — should get hover-only glow

**Step 4: Commit**

```bash
git add src/components/chunks-r3f/ChunksScene.tsx
git commit -m "feat: add focus glow to ChunksView using shared node-color-effects"
```

---

### Task 6: Delete unused `applyLensColorEmphasis` from chunks-lens.ts

**Files:**
- Modify: `src/lib/chunks-lens.ts`

**Step 1: Remove dead code**

- Delete the `applyLensColorEmphasis` function (lines 164-171)
- Delete the `HIGHLIGHT_COLOR` constant (line 14) if not used elsewhere (grep first)

**Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/lib/chunks-lens.ts
git commit -m "cleanup: remove unused applyLensColorEmphasis from chunks-lens"
```

---

### Task 7: Add architectural guideline to CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add cross-view sharing guideline**

In the "Development Principles" section (after the "Build reusable primitives" paragraph), add:

```markdown
**Share rendering logic between views via `src/lib/`.** TopicsView and ChunksView share visual behaviors (glow, dim, edge pulling, desaturation). When adding a visual effect, implement it as a pure function in `src/lib/` (e.g., `node-color-effects.ts`, `edge-pulling.ts`) and import from both views. View-specific decisions (which nodes to highlight) stay in components; the effect implementation (how to highlight) lives in the shared module. Never duplicate rendering logic inline across views.
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add cross-view rendering logic sharing guideline to CLAUDE.md"
```
