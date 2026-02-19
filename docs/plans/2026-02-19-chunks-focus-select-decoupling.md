# Focus/Select Decoupling — ChunksView Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Decouple "reading a node" from "re-centering the lens" in ChunksView so users can explore a neighborhood without every click displacing focus.

**Architecture:** Four changes: (1) double-click to focus instead of single-click, (2) Reader clicks no longer move the lens, (3) visual hierarchy between primary and secondary focus seeds, (4) breathing animation on the selected/reading node.

**Tech Stack:** React, React Three Fiber, Three.js, TypeScript

---

## Key constants to know

- `src/lib/chunks-geometry.ts`: `FOCUS_SEED_SCALE = 2` (current focus boost; primary keeps this)
- `src/lib/node-color-effects.ts`: `FOCUS_GLOW_FACTOR = 0.5` (focus brightness lerp)
- `ChunksScene.tsx:58`: `MAX_FOCUS_SEEDS = 2`
- `ChunksScene.tsx:277`: `focusSeeds: FocusSeed[]` — newest seed = `focusSeeds.at(-1)`, older seed = `focusSeeds[0]`
- `ChunksScene.tsx:601`: `handleCardClick` — the click handler that currently does both select and focus
- `ChunksScene.tsx:460`: `useEffect` for `focusChunk` — calls `addFocusSeeds` when Reader changes chunk; this needs removal
- `ChunksView.tsx:239`: `focusChunk: { id: string; seq: number }` state — replaces with `selectedChunkId: string | null`

---

## Task 1: Double-click to focus, single click to select

**Files:**
- Modify: `src/components/chunks-r3f/ChunksScene.tsx` (around line 601)

Double-click detection is handled entirely inside `handleCardClick` using a `lastClickRef`. No changes to `useInstancedMeshDrag`.

**Step 1: Add lastClickRef before handleCardClick**

Find the line `const handleCardClick = useCallback((index: number) => {` and add this ref just before it:

```ts
const DOUBLE_CLICK_MS = 300;
const lastClickRef = useRef<{ index: number; time: number } | null>(null);
```

**Step 2: Modify handleCardClick**

Replace the current `handleCardClick` (lines ~601–613):

```ts
// Before:
const handleCardClick = useCallback((index: number) => {
  bringToFront(index);
  const pulled = pulledChunkMapRef.current.get(index);
  if (pulled && flyToRef.current) {
    flyToRef.current(pulled.realX, pulled.realY);
  }
  onSelectChunk(chunks[index].id);
  // Exit cluster focus mode when user clicks a node — enters single-node walk.
  if (clusterFocusSetRef.current !== null) {
    setClusterFocusSet(null);
  }
  addFocusSeeds([index]);
}, [bringToFront, onSelectChunk, addFocusSeeds, chunks]);
```

```ts
// After:
const handleCardClick = useCallback((index: number) => {
  bringToFront(index);
  const pulled = pulledChunkMapRef.current.get(index);
  if (pulled && flyToRef.current) {
    flyToRef.current(pulled.realX, pulled.realY);
  }
  onSelectChunk(chunks[index].id);

  // Double-click to focus: re-centers lens on the node.
  // Single click only selects (opens Reader) without moving the lens.
  const now = performance.now();
  const last = lastClickRef.current;
  const isDoubleClick = last !== null && last.index === index && (now - last.time) < DOUBLE_CLICK_MS;
  lastClickRef.current = { index, time: now };

  if (isDoubleClick) {
    if (clusterFocusSetRef.current !== null) setClusterFocusSet(null);
    addFocusSeeds([index]);
  }
}, [bringToFront, onSelectChunk, addFocusSeeds, chunks]);
```

**Step 3: Run type check**
```bash
npx tsc --noEmit
```
Expected: no errors

**Step 4: Manual test**

Start `npm run dev`. Open ChunksView. Enter focus mode by double-clicking a node (lens should appear). Single-click another node — Reader should open but lens should not move. Double-click a visible node — lens should re-center.

**Step 5: Commit**
```bash
git add src/components/chunks-r3f/ChunksScene.tsx
git commit -m "feat: double-click to focus, single click to select in ChunksView"
```

---

## Task 2: Remove Reader → lens coupling

The Reader's `onActiveChunkChange` currently triggers `addFocusSeeds` + camera fly in ChunksScene via the `focusChunk` prop. This needs to be replaced with `selectedChunkId` that only drives a visual highlight.

**Files:**
- Modify: `src/components/ChunksView.tsx`
- Modify: `src/components/chunks-r3f/ChunksCanvas.tsx`
- Modify: `src/components/chunks-r3f/ChunksScene.tsx`

**Step 1: Update ChunksView.tsx**

Replace:
```ts
const [focusChunk, setFocusChunk] = useState<{ id: string; seq: number } | null>(null);
const handleActiveChunkChange = useCallback((chunkId: string) => {
  setFocusChunk((prev) => ({ id: chunkId, seq: (prev?.seq ?? 0) + 1 }));
}, []);
```

With:
```ts
const [selectedChunkId, setSelectedChunkId] = useState<string | null>(null);
const handleActiveChunkChange = useCallback((chunkId: string) => {
  setSelectedChunkId(chunkId);
}, []);
```

And on the `<ChunksCanvas>` element, replace:
```ts
focusChunk={focusChunk}
```
With:
```ts
selectedChunkId={selectedChunkId}
```

**Step 2: Update ChunksCanvas.tsx**

In the props interface, replace:
```ts
focusChunk?: { id: string; seq: number } | null;
```
With:
```ts
selectedChunkId?: string | null;
```

In the destructure and pass-through to `<ChunksScene>`, replace `focusChunk` with `selectedChunkId`.

**Step 3: Update ChunksScene.tsx — replace focusChunk prop**

In `ChunksSceneProps`, replace:
```ts
focusChunk?: { id: string; seq: number } | null;
```
With:
```ts
selectedChunkId?: string | null;
```

In the destructure at the top of the component, replace `focusChunk` with `selectedChunkId`.

**Step 4: Replace the focusChunk effect with selectedChunkIndex derivation**

Remove the existing `focusChunk` effect (lines ~460–471):
```ts
// REMOVE this effect entirely:
useEffect(() => {
  if (!focusChunk) return;
  const index = chunks.findIndex((c) => c.id === focusChunk.id);
  if (index < 0) return;
  setClusterFocusSet(null);
  addFocusSeeds([index]);
  const x = layoutPositionsRef.current[index * 2];
  const y = layoutPositionsRef.current[index * 2 + 1];
  if (x !== undefined && y !== undefined) flyToRef.current?.(x, y);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [focusChunk]);
```

Add a `selectedChunkIndexRef` and a replacement effect that only tracks the index for rendering:
```ts
const selectedChunkIndexRef = useRef<number | null>(null);
useEffect(() => {
  if (!selectedChunkId) {
    selectedChunkIndexRef.current = null;
    return;
  }
  const index = chunks.findIndex((c) => c.id === selectedChunkId);
  selectedChunkIndexRef.current = index >= 0 ? index : null;
}, [selectedChunkId, chunks]);
```

**Step 5: Run type check**
```bash
npx tsc --noEmit
```
Expected: no errors

**Step 6: Manual test**

Open the Reader. Click different chunk bars in the Reader. The graph should highlight the corresponding node (next task adds the visual, but verify lens does NOT move). Switch article tabs — again, lens should stay put.

**Step 7: Commit**
```bash
git add src/components/ChunksView.tsx src/components/chunks-r3f/ChunksCanvas.tsx src/components/chunks-r3f/ChunksScene.tsx
git commit -m "feat: Reader clicks no longer re-center the lens, only track selectedChunkId"
```

---

## Task 3: Focus node visual hierarchy (primary vs secondary)

Currently both focus seeds render identically. Primary (newest) should be larger and brighter; secondary (older) should be medium-size, slightly dimmer. Both should be circular with no text-length distortion.

**Files:**
- Modify: `src/lib/chunks-geometry.ts`
- Modify: `src/lib/__tests__/chunks-geometry.test.ts`
- Modify: `src/lib/node-color-effects.ts`
- Modify: `src/lib/__tests__/node-color-effects.test.ts`
- Modify: `src/components/chunks-r3f/ChunksScene.tsx`

### 3a: Update computeFocusSeedBoost

**Step 1: Write failing tests**

In `src/lib/__tests__/chunks-geometry.test.ts`, add new tests for the updated signature:

```ts
describe('computeFocusSeedBoost (tiered)', () => {
  it('returns given scale for a focus seed with no hover animation', () => {
    expect(computeFocusSeedBoost(FOCUS_SEED_SCALE, 0)).toBe(FOCUS_SEED_SCALE);
    expect(computeFocusSeedBoost(SECONDARY_FOCUS_SEED_SCALE, 0)).toBe(SECONDARY_FOCUS_SEED_SCALE);
  });

  it('returns 1 for scale=1 (non-focus node)', () => {
    expect(computeFocusSeedBoost(1, 0)).toBe(1);
  });

  it('returns 1 while hover animation is in progress (prevents scale spike)', () => {
    expect(computeFocusSeedBoost(FOCUS_SEED_SCALE, 0.5)).toBe(1);
    expect(computeFocusSeedBoost(SECONDARY_FOCUS_SEED_SCALE, 0.01)).toBe(1);
  });
});
```

Run: `npm test -- src/lib/__tests__/chunks-geometry.test.ts --run`
Expected: FAIL (SECONDARY_FOCUS_SEED_SCALE not exported)

**Step 2: Update chunks-geometry.ts**

Add the secondary constant and update the function signature:

```ts
export const FOCUS_SEED_SCALE = 2;
export const SECONDARY_FOCUS_SEED_SCALE = 1.4;

/**
 * Compute the scale boost for a focus seed node.
 * `scale` is the desired boost (FOCUS_SEED_SCALE for primary, SECONDARY_FOCUS_SEED_SCALE for secondary, 1 for none).
 * The boost is suppressed during hover animation to avoid scale spikes on hover-out.
 */
export function computeFocusSeedBoost(scale: number, hoverProgress: number): number {
  return hoverProgress === 0 ? scale : 1;
}
```

Update the existing tests to use the new signature (replace `computeFocusSeedBoost(true/false, ...)` with `computeFocusSeedBoost(FOCUS_SEED_SCALE/1, ...)`).

**Step 3: Run tests**
```bash
npm test -- src/lib/__tests__/chunks-geometry.test.ts --run
```
Expected: PASS

### 3b: Update applyFocusGlow for secondary tier

**Step 1: Add secondary glow constant and test**

In `src/lib/__tests__/node-color-effects.test.ts`, add:
```ts
it('applies secondary focus glow at reduced intensity', () => {
  const color = new THREE.Color(0.5, 0.5, 0.5);
  const glowTarget = new THREE.Color(1, 1, 1);
  applyFocusGlow(color, glowTarget, 'secondary', false);
  const expected = new THREE.Color(0.5, 0.5, 0.5).lerp(new THREE.Color(1, 1, 1), SECONDARY_FOCUS_GLOW_FACTOR);
  expect(color.r).toBeCloseTo(expected.r, 4);
});
```

Run: `npm test -- src/lib/__tests__/node-color-effects.test.ts --run`
Expected: FAIL

**Step 2: Update node-color-effects.ts**

Add `SECONDARY_FOCUS_GLOW_FACTOR` and update `applyFocusGlow` to accept a focus tier:

```ts
export const FOCUS_GLOW_FACTOR = 0.5;
export const SECONDARY_FOCUS_GLOW_FACTOR = 0.3;
export const HOVER_GLOW_FACTOR = 0.35;
export const HOVER_FOCUSED_GLOW_FACTOR = 0.105;

export function applyFocusGlow(
  color: THREE.Color,
  glowTarget: THREE.Color,
  focused: boolean | 'primary' | 'secondary',
  hovered: boolean,
): void {
  if (!focused && !hovered) return;
  if (focused) {
    const factor = focused === 'secondary' ? SECONDARY_FOCUS_GLOW_FACTOR : FOCUS_GLOW_FACTOR;
    color.lerp(glowTarget, factor);
  }
  if (hovered) color.lerp(glowTarget, focused ? HOVER_FOCUSED_GLOW_FACTOR : HOVER_GLOW_FACTOR);
}
```

Note: passing `true` continues to use `FOCUS_GLOW_FACTOR` (backwards compatible for TopicsView usage).

**Step 3: Run tests**
```bash
npm test -- src/lib/__tests__/node-color-effects.test.ts --run
```
Expected: PASS

### 3c: Update useFrame render loop in ChunksScene

**Step 1: Compute primary/secondary focus indices per-frame**

In the useFrame callback, before the per-node loop, add:

```ts
let primaryFocusIndex: number | null = null;
let secondaryFocusIndex: number | null = null;
if (clusterFocusSetRef.current === null) {
  const seeds = focusSeedsRef.current;
  if (seeds.length > 0) primaryFocusIndex = seeds[seeds.length - 1].index;
  if (seeds.length >= 2) secondaryFocusIndex = seeds[0].index;
}
```

**Step 2: Update per-node classification**

Replace the existing `isFocusSeed` computation:
```ts
// Before:
const isFocusSeed = clusterFocusSetRef.current === null && lensInfoRef.current?.depthMap.get(i) === 0;
```

With:
```ts
const isPrimaryFocus = i === primaryFocusIndex;
const isSecondaryFocus = i === secondaryFocusIndex;
const isFocusSeed = isPrimaryFocus || isSecondaryFocus; // used for other existing checks (e.g. vpTarget, maxFinalScale)
```

**Step 3: Update heightRatio for focus nodes**

Change the `isFocusSeed ? actualHeightRatio` branch to use `1` (no text-length distortion):
```ts
// Before:
const heightRatio = isPulled ? 1
  : isFocusSeed ? actualHeightRatio
    : 1 + (actualHeightRatio - 1) * t * hoverMulT;
```
```ts
// After:
const heightRatio = (isPulled || isFocusSeed) ? 1
  : 1 + (actualHeightRatio - 1) * t * hoverMulT;
```

**Step 4: Update shape morphing for focus nodes**

After the `morphT` computation, force circle shape for focus nodes:
```ts
// Before:
if (cornerAttr) (cornerAttr.array as Float32Array)[i] = 0.08 + morphT * 0.92;
```
```ts
// After:
if (cornerAttr) {
  (cornerAttr.array as Float32Array)[i] = isFocusSeed ? 1.0 : (0.08 + morphT * 0.92);
}
```

**Step 5: Update computeFocusSeedBoost call**

```ts
// Before:
const focusSeedBoost = computeFocusSeedBoost(isFocusSeed, rawProgress);
```
```ts
// After:
const focusSeedScale = isPrimaryFocus ? FOCUS_SEED_SCALE : isSecondaryFocus ? SECONDARY_FOCUS_SEED_SCALE : 1;
const focusSeedBoost = computeFocusSeedBoost(focusSeedScale, rawProgress);
```

Add the import at the top of ChunksScene:
```ts
import { ..., SECONDARY_FOCUS_SEED_SCALE } from "@/lib/chunks-geometry";
```

**Step 6: Update applyFocusGlow call**

```ts
// Before:
applyFocusGlow(tempColor.current, glowTarget, isFocusSeed, isHovered || isClusterHoverMember);
```
```ts
// After:
const focusTier = isPrimaryFocus ? 'primary' : isSecondaryFocus ? 'secondary' : false;
applyFocusGlow(tempColor.current, glowTarget, focusTier, isHovered || isClusterHoverMember);
```

**Step 7: Run type check**
```bash
npx tsc --noEmit
```
Expected: no errors

**Step 8: Manual test**

Double-click a node to enter focus mode. Double-click another node to add a second seed. Verify:
- Primary (newest) is largest and brightest
- Secondary (older) is slightly smaller and dimmer
- Both are circular (no card shape)
- Both have no text-length height distortion (they look like uniform discs)

**Step 9: Commit**
```bash
git add src/lib/chunks-geometry.ts src/lib/__tests__/chunks-geometry.test.ts src/lib/node-color-effects.ts src/lib/__tests__/node-color-effects.test.ts src/components/chunks-r3f/ChunksScene.tsx
git commit -m "feat: visual hierarchy for primary vs secondary focus nodes in ChunksView" -m "Primary seed: largest, brightest. Secondary: medium size, dimmer. Both fixed-circle shape with no text-length distortion."
```

---

## Task 4: Breathing animation for selected node

The selected node (what the Reader is showing) pulses with a slow sine-wave oscillation in both scale and brightness (~2.5s period).

**Files:**
- Modify: `src/components/chunks-r3f/ChunksScene.tsx`

**Step 1: Add breathing constants near the top of ChunksScene (with the other constants)**

```ts
const BREATH_PERIOD = 2.5; // seconds per breath cycle
const BREATH_SCALE_AMP = 0.12; // 12% scale oscillation
const BREATH_GLOW_AMP = 0.18; // glow lerp amplitude on top of normal
```

**Step 2: Add breathPhaseRef near other render refs**

Near the `hoverProgressRef` declaration, add:
```ts
const breathPhaseRef = useRef(0);
```

**Step 3: Increment breathPhase in useFrame (before the per-node loop)**

```ts
breathPhaseRef.current += delta / BREATH_PERIOD;
```

**Step 4: Apply breathing to selected node in the per-node loop**

After computing `isPrimaryFocus` / `isSecondaryFocus`, add:
```ts
const isSelectedNode = selectedChunkIndexRef.current === i;
// Focus takes visual precedence over selection: a node that's both focused and selected shows focus style.
const showBreathing = isSelectedNode && !isPrimaryFocus && !isSecondaryFocus;
const breathT = showBreathing
  ? (Math.sin(breathPhaseRef.current * Math.PI * 2) + 1) * 0.5
  : 0;
```

Apply to `finalScale` / `finalScaleY`: after the `finalScale` computation, multiply by the breathing factor:
```ts
// Apply breathing expansion (only for selected non-focus nodes)
const breathScaleMul = 1 + breathT * BREATH_SCALE_AMP;
const finalScaleWithBreath = finalScale * breathScaleMul;
const finalScaleYWithBreath = finalScaleY * breathScaleMul;
```

Update the matrix composition to use `finalScaleWithBreath` / `finalScaleYWithBreath`:
```ts
scaleVec.current.set(finalScaleWithBreath, finalScaleYWithBreath, finalScaleWithBreath);
```

Also update the screen rect projection (uses `finalScale` and `finalScaleY`) to use the breath-adjusted values.

**Step 5: Apply breathing glow to color**

After `applyBrightness`, add:
```ts
if (breathT > 0) {
  tempColor.current.lerp(glowTarget, breathT * BREATH_GLOW_AMP);
}
```

**Step 6: Force circle shape and no height distortion for selected node**

The `heightRatio` line should also handle `isSelectedNode`:
```ts
const heightRatio = (isPulled || isFocusSeed || isSelectedNode) ? 1
  : 1 + (actualHeightRatio - 1) * t * hoverMulT;
```

The corner ratio line should also handle `isSelectedNode`:
```ts
if (cornerAttr) {
  (cornerAttr.array as Float32Array)[i] = (isFocusSeed || isSelectedNode) ? 1.0 : (0.08 + morphT * 0.92);
}
```

**Step 7: Force color update every frame when any node is selected**

The color update currently has an early-exit guard. Add `selectedChunkIndexRef.current !== null` as a condition that forces the update:

```ts
if (colorChunksRef.current !== chunkColors || colorDirtyRef.current || desatChanged || previewActive || pullResult.pulledMap.size > 0 || lensActiveRef.current || !mesh.instanceColor || selectedChunkIndexRef.current !== null) {
```

**Step 8: Run type check**
```bash
npx tsc --noEmit
```
Expected: no errors

**Step 9: Manual test**

Open the Reader by single-clicking a node. Verify the corresponding node in the graph slowly pulses (scale and brightness oscillate with a ~2.5s period). Verify the breathing stops if you double-click that node (it becomes a focus seed, and focus visuals take over). Verify breathing continues while you scroll through the Reader.

Tune `BREATH_PERIOD`, `BREATH_SCALE_AMP`, and `BREATH_GLOW_AMP` until the animation feels pleasant. Target: slow, calm, clearly visible but not distracting.

**Step 10: Commit**
```bash
git add src/components/chunks-r3f/ChunksScene.tsx
git commit -m "feat: breathing pulse animation on selected/reading node in ChunksView" -m "Slow sine-wave oscillation in scale and brightness (~2.5s period) for the node currently shown in the Reader. Focus visuals take precedence when the node is also a focus seed."
```

---

## Final verification

```bash
npm test -- --run
npx tsc --noEmit
```

Manual walkthrough:
1. Open ChunksView. Single-click a node → Reader opens, no focus mode.
2. Double-click a node → lens activates, node becomes primary focus (large circle, bright).
3. Single-click another visible node → Reader updates, lens stays, breathing animation starts on the clicked node.
4. Double-click a third node → it becomes new primary focus, old primary becomes secondary (smaller, dimmer).
5. Click a ghost node at viewport edge → camera flies there, Reader opens. Lens does not change.
6. Click chunk bars in the Reader → corresponding nodes in graph get/lose breathing animation, lens stays.
7. Zoom out past threshold → focus exits, breathing node returns to normal.
