# Investigation: Empty Chunk Labels

**Date**: 2026-02-05
**Status**: Fixed
**Effort**: ~3 sessions, multiple wrong hypotheses before root cause found

## Symptom

Chunk nodes in TopicsView render as colored squares but some display no text content. The pattern seemed position-dependent ("first 2 chunks are empty") but was actually determined by whether a chunk was shared across multiple keywords.

## Why it was hard to diagnose

This bug sat at the intersection of four systems that don't easily compose for debugging:

1. **React Three Fiber** renders chunk meshes inside a Canvas via `useFrame` (60fps loop)
2. **Vanilla DOM** label system (`label-overlays.ts`) creates and positions `<div>` elements outside Canvas
3. **React portals** bridge the two: React renders markdown content into the DOM elements created by the vanilla system
4. **D3 force simulation** produces the node array that feeds both systems

The bug only manifested with real data (chunks shared across keywords), couldn't be reproduced in isolated test pages, and the visual symptom (blank box) gave no clue about which layer was at fault.

## Investigation timeline

### Hypothesis 1: Data transformation drops content (wrong)

The symptom looked like content was being lost somewhere in the pipeline: DB -> API -> ChunkNode -> ChunkSimNode -> D3 simulation -> array spread. We wrote multiple test scripts to check each step:

- `scripts/test-chunk-data-flow.ts` — traced content through every transformation
- `scripts/test-d3-object-identity.ts` — confirmed D3 preserves object identity and custom properties
- `scripts/test-sim-node-content-access.ts` — confirmed content accessible via type casting
- `scripts/test-api-query.ts` — confirmed API returns complete content

**Result**: Content was preserved at every step. D3 does not replace node objects or strip custom properties. The data pipeline was innocent.

**What this taught us**: Don't assume the most obvious explanation. The blank squares made it look like a data issue, but the data was fine. The rendering layer was the problem.

### Hypothesis 2: Falsy check on empty content string (wrong)

The portal callback had `if (visible && content)` which would skip portal creation when `content` is an empty string (`""` is falsy in JS). We theorized a race condition where content was temporarily empty during initial renders.

**What we tried**: Changed `if (visible && content)` to `if (visible)` and normalized empty content to `""`.

**Result**: Didn't fix the bug. Content was never actually empty — the race condition theory was wrong.

**What this taught us**: We were looking at the wrong layer. The callback wasn't being reached at all for the problematic chunks — a guard clause earlier in the pipeline was preventing it.

### Hypothesis 3: React portal key collision (partially right)

The user hypothesized that chunks shared across multiple keywords might be competing for the same portal. We confirmed this with test scripts:

- `scripts/test-duplicate-chunks.ts` — confirmed problematic chunks were associated with 3-4 keywords each
- `scripts/test-keyword-processing-order.ts` — confirmed "last keyword to process wins" pattern

We changed React portal keys from `chunkId` to `${parentKeywordId}-${chunkId}`.

**Result**: The portal key fix was necessary (two portals into the same container would conflict) but insufficient. The bug persisted because the collision happened at a deeper level — the DOM elements themselves were shared, not just the React portal keys.

**What this taught us**: Fixing the symptom at one layer can mask deeper issues. The portal key collision was real, but it was a consequence of the DOM element collision in `chunkLabelCache`, not the root cause.

### Hypothesis 4: Direct content lookup from source data (getting warmer)

The debug panel (which worked correctly) used `chunksByKeyword` directly. We wired LabelsOverlay to use the same data path.

**Result**: Chunks that were found in the lookup rendered correctly. But empty chunks weren't being looked up at all — the callback never fired for them. This proved the problem was upstream of the React layer.

### Breakthrough: "The empty nodes don't get looked up"

Adding diagnostic logging to `updateChunkLabels` (the function called 60fps in `useFrame`) showed that working chunks appeared in every frame's log output, but empty chunks were completely absent. They never reached the `onChunkLabelContainer` callback.

We then noticed the log: `13 chunks in nodes, 12 screen rects. Missing: []`

13 nodes, 12 screen rects, yet zero missing? This is only possible if two nodes share the same ID — the Map deduplicates keys (giving 12), but the filter `nodes.filter(n => !screenRects.has(n.id))` finds all 13 IDs present in the 12-entry Map. The "missing" check was structurally incapable of detecting this class of bug.

## Root cause

When a chunk is associated with N keywords, `createChunkNodes()` creates N separate `ChunkSimNode` objects — each with the same `id` (the chunk UUID) but different `parentId` and `(x, y)` positions. This is correct: each keyword should show its own copy of the chunk.

But three Maps downstream were keyed by `node.id` alone:

### Collision 1: `chunkScreenRectsRef` (ChunkNodes.tsx)

ChunkNodes renders all N instances as visible meshes (correct — you see N colored boxes). But it writes screen rects into a Map keyed by `node.id`. The last keyword's screen position overwrites earlier ones.

### Collision 2: `chunkLabelCache` (label-overlays.ts)

The label system creates one DOM `<div>` per unique `node.id`. When processing the duplicate, it reuses the same element, repositioning it to the second keyword's location. The first keyword's chunk box now has no label overlay at all.

### Collision 3: `seenNodes` (label-overlays.ts)

The visibility tracking Set uses `node.id`, so the cleanup logic can't distinguish the two instances.

**Result**: For each shared chunk, one keyword renders text (the last one processed), the other shows an empty box. The "first N chunks empty" pattern was coincidental — it correlated with which chunks happened to be shared and which keyword processed them last.

### Bonus bug: per-frame React re-renders

`updateChunkLabels` runs in `useFrame` (60fps) and called `onChunkLabelContainer` every frame for every visible chunk. Each call triggered `setChunkPortals(prev => new Map(prev)...)` — React sees a new Map reference as a state change, causing re-renders 60 times per second.

## Fix

### Composite keys (3 collision points)

Use `${parentId}:${chunkId}` as the Map key wherever chunks are tracked:

- **ChunkNodes.tsx:194** — `chunkScreenRectsRef.current.set(chunkKey, ...)`
- **label-overlays.ts:379-412** — `screenRects.get(chunkKey)`, `chunkLabelCache.get(chunkKey)`, `seenNodes.add(chunkKey)`

Each (keyword, chunk) pair now gets its own screen rect, its own DOM element, and its own visibility tracking. The original `node.id` is preserved in `labelEl.dataset.chunkId` for content lookup.

### Visibility change detection

Added `reportedVisibleChunks` Set to track which chunks have been reported to the React callback. `onChunkLabelContainer` only fires when a chunk transitions between visible/hidden, not every frame.

## Lessons learned

### 1. Shared IDs are a design smell

`createChunkNodes` creates multiple objects with the same `id`. Any downstream Map keyed by `id` silently loses data. The type system (`ChunkSimNode.id: string`) provides no protection.

**Prevention**: When a data model intentionally creates duplicates, add a `uniqueKey` field or document the non-uniqueness prominently. Consider making the composite key the actual `id`.

### 2. The symptom's pattern can be misleading

"First 2 chunks are empty" suggested an index-based or initialization bug. We spent significant time tracing array indices and D3 simulation ordering. The actual cause (duplicate chunk IDs) was unrelated to position — it just happened to correlate with which chunks were shared.

**Prevention**: When the pattern seems position-dependent, also check for duplicate keys and overwrites.

### 3. Multiple systems make the bug invisible to each one

- ChunkNodes: renders all boxes correctly (no collision in the instanced mesh)
- label-overlays: iterates all nodes, finds screen rects for all of them (the overwritten rect still exists)
- React portals: receives callbacks and creates portals (into a stolen DOM container)

No single system reports an error. The bug only appears in the composition.

**Prevention**: When vanilla DOM, React, and WebGL interact, add assertions at boundaries: "this Map should have the same size as the input array."

### 4. Debug panels can lie by omission

The debug panel (in `page.tsx`) used its own `useChunkLoading` call that loaded ALL keywords, while the renderer loaded only VISIBLE keywords. The debug panel showing correct data gave false confidence that the data pipeline was fine.

**Prevention**: Debug tools should read from the same data source as production code, not a parallel one.

### 5. Per-frame React state updates are silent performance killers

Calling `setState` inside `useFrame` (60fps) causes React to re-render every frame. No error, no warning — just wasted CPU and potential stale closure issues.

**Prevention**: When bridging imperative animation loops with React state, always gate on actual changes. Track "last reported state" and only call setState on transitions.

## Files modified

- `src/components/topics-r3f/ChunkNodes.tsx` — composite key for screen rects
- `src/lib/label-overlays.ts` — composite key for label cache + visibility change detection
- `src/components/topics-r3f/LabelsOverlay.tsx` — direct chunksByKeyword content lookup + portal key fix
