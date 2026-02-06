# Architecture Onboarding Guide

This guide helps you (and Claude Code) understand the key architectural patterns before implementing new features, preventing common "wrong approach" mistakes.

## Quick Start: The Three Essential Files

Before implementing ANY new feature in TopicsView, read these three files to understand existing patterns:

1. **`src/lib/topics-hover-controller.ts`** - Shared interaction controller (hover/click)
2. **`src/components/topics-r3f/R3FTopicsScene.tsx`** - R3F component orchestration and data flow
3. **`src/lib/topics-graph-nodes.ts`** - Canonical data transformation schema

**Rule:** Use existing systems — do NOT create parallel implementations.

---

## Copy-Pasteable Prompt Template

Use this when asking Claude Code to implement features:

```
Before implementing anything, read these architecture files to understand existing patterns:

1. src/lib/topics-hover-controller.ts - Shows the shared interaction controller (hover/click)
2. src/components/topics-r3f/R3FTopicsScene.tsx - Shows the R3F component orchestration and data flow
3. src/lib/topics-graph-nodes.ts - Shows the canonical data transformation schema

Use existing systems — do NOT create parallel implementations.

Then implement: [YOUR REQUEST HERE]
```

---

## When to Read Which Files

| **If you're adding...** | **Read these files first** |
|-------------------------|----------------------------|
| **New interaction** (hover, click, drag) | `topics-hover-controller.ts` |
| **New rendering layer** (nodes, edges, overlays) | `R3FTopicsScene.tsx` + `topics-graph-nodes.ts` |
| **New node type or data transformation** | `topics-graph-nodes.ts` |
| **Filtering or clustering feature** | `topics-graph-nodes.ts` + `label-overlays.ts` |
| **General TopicsView feature** | All three |

---

## File Details

### Priority 1: `src/lib/topics-hover-controller.ts`

**What it demonstrates:**
- **Renderer-agnostic abstraction**: `RendererAdapter` interface abstracts D3 vs Three.js differences
- **Throttled event handling**: Uses `requestAnimationFrame` to batch expensive hover computations
- **Separation of concerns**: Cursor tracking (cheap) decoupled from highlighting (expensive)
- **Refs over state**: Interaction state stored in refs to avoid React re-renders

**Mistakes it prevents:**
- ❌ Building a new hover system that duplicates logic across renderers
- ❌ Calling expensive computations on every mousemove without throttling
- ❌ Mixing interaction state with React component state (causes re-renders)
- ❌ Coupling renderer-specific code with interaction logic

**When to read:** Before implementing any new interaction (hover, click, drag) or changing highlighting.

---

### Priority 2: `src/components/topics-r3f/R3FTopicsScene.tsx`

**What it demonstrates:**
- **Three-layer simulation architecture**: Keywords (D3-force), content (constrained forces), labels (DOM overlay)
- **Ref-based Canvas↔DOM bridging**: `labelRefs` shares simulation data without re-rendering Canvas
- **Data transformation pipeline**: Raw graph data → simulation nodes → renderable components
- **Lazy loading pattern**: Content nodes created only after keywords have positions
- **useFrame safety rule**: NO React setState inside `useFrame` (causes 60fps re-renders)

**Mistakes it prevents:**
- ❌ Calling `setState` inside `useFrame` (re-renders entire Canvas 60x/sec)
- ❌ Building separate label management systems (use shared `LabelOverlayManager`)
- ❌ Recreating content nodes on every parent render (memoize on `keywordNodes`)
- ❌ Bypassing established component hierarchy
- ❌ Creating new interaction handlers instead of using `topics-hover-controller`

**When to read:** Before adding rendering layers or changing component communication.

---

### Priority 3: `src/lib/topics-graph-nodes.ts`

**What it demonstrates:**
- **Single source of truth for IDs**: `"kw:label"`, `"proj:id"`, `"chunk:id"` format
- **Renderer-agnostic conversion**: `convertToSimNodes()` is the universal converter
- **ProjectNode embedding**: Shows how user-created clusters share keyword space
- **Position preservation**: `getSavedPosition()` enables smooth filter transitions

**Mistakes it prevents:**
- ❌ Building renderer-specific node converters (use `convertToSimNodes()` everywhere)
- ❌ Using different ID formats in different parts of the code
- ❌ Losing node positions when filtering (capture/restore pattern)
- ❌ Treating project nodes differently from keyword nodes (both are SimNode)

**When to read:** Before implementing a new node type, renderer, or filter system.

---

### Honorable Mention: `src/lib/label-overlays.ts`

**Why it matters:** Defines `LabelOverlayManager` factory for DOM labels. Every new label type should reuse this, not build a parallel system.

**Key insight:** Labels are positioned via `worldToScreen()` and `worldToScreen3D()` callbacks — new renderers just provide those functions.

---

## Learning Path for New Developers

1. **Start with context**: `docs/patterns/threejs-r3f/index.md` (high-level patterns)
2. **Understand the schema**: `topics-graph-nodes.ts` (data format)
3. **See the orchestration**: `R3FTopicsScene.tsx` (component architecture)
4. **Learn interactions**: `topics-hover-controller.ts` (event handling patterns)
5. **Dive into details**: Specific component files (ForceSimulation, KeywordNodes, etc.)

---

## Example Prompts

### Example 1: Adding a new hover effect

```
Before implementing anything, read src/lib/topics-hover-controller.ts to understand the existing interaction controller pattern. Use the RendererAdapter interface — do NOT create a parallel hover system.

Then implement: Add a tooltip that shows keyword metadata on hover
```

### Example 2: Adding a new node type

```
Before implementing anything, read these files:
1. src/lib/topics-graph-nodes.ts - Shows how nodes are converted from API data
2. src/components/topics-r3f/R3FTopicsScene.tsx - Shows how nodes flow through the rendering pipeline

Use the existing convertToSimNodes() pattern — do NOT create renderer-specific converters.

Then implement: Add "author" nodes that connect to related keywords
```

### Example 3: Implementing a filter feature

```
Before implementing anything, read these files:
1. src/lib/topics-graph-nodes.ts - Shows position capture/restore pattern
2. src/components/topics-r3f/R3FTopicsScene.tsx - Shows how filters propagate through layers

Use the existing getSavedPosition() pattern for smooth transitions.

Then implement: Add a slider to filter keywords by embedding similarity
```

---

## Why These Files Prevent Common Mistakes

Based on usage insights analysis, the main friction patterns were:

1. **"Building new hover/interaction systems"** → `topics-hover-controller.ts` shows the canonical pattern
2. **"Not understanding rendering architecture"** → `R3FTopicsScene.tsx` shows component hierarchy
3. **"Confusion between precomputed vs runtime clusters"** → `label-overlays.ts` clarifies runtime cluster handling
4. **"Missing existing shared components"** → All three files reference shared utilities

These three files form the **architectural skeleton** that prevents parallel implementations.
