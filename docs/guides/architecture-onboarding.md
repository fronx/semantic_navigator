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

## TDD Workflow for TopicsView Features

When implementing features with test-first approach, use the **`superpowers:test-driven-development`** skill to enforce TDD discipline (RED-GREEN-REFACTOR cycle), combined with these project-specific test patterns.

### Why TDD for This Project

Past bugs that TDD would have caught:
- Desaturation slider breaking all colors to white/blue (chroma `.css()` incompatible with THREE.Color)
- Infinite render loops from setState in useFrame
- Cluster ID mismatches between precomputed and runtime systems
- Missing text on article nodes (articles use `summary` not `content` field)
- Dim keyword labels from dual opacity setters

### Common Edge Cases to Test

Based on this project's history, always include tests for:

#### 1. THREE.Color Compatibility
```typescript
test('desaturated colors are valid THREE.Color hex format', () => {
  const color = desaturateColor('#ff0000', 0.5)
  expect(color).toMatch(/^#[0-9a-f]{6}$/) // hex format, not rgb()
  expect(() => new THREE.Color(color)).not.toThrow()
})
```
**Why:** `chroma.css()` returns `rgb()` format; THREE.Color needs hex. Use `chroma.hex()` instead.

#### 2. React/R3F Render Loops
```typescript
test('slider changes do not trigger canvas re-renders', () => {
  const { rerender } = render(<TopicsView />)
  const initialRenderCount = renderCount
  fireEvent.change(slider, { target: { value: 0.5 } })
  expect(renderCount).toBe(initialRenderCount)
})
```
**Why:** Calling setState inside `useFrame` causes 60fps re-renders. Use refs instead.

#### 3. InstancedMesh Colors
```typescript
test('keyword nodes have explicit instanceColor attributes', () => {
  const { container } = render(<KeywordNodes />)
  const mesh = container.querySelector('instancedMesh')
  expect(mesh.geometry.attributes.instanceColor).toBeDefined()
})
```
**Why:** InstancedMesh requires explicit `instanceColor` attribute per instance; base material color alone won't work.

#### 4. Database Schema Nulls
```typescript
test('handles null summary from database gracefully', () => {
  const node = { id: '1', type: 'article', summary: null, content: null }
  expect(() => renderArticleNode(node)).not.toThrow()
  expect(getNodeText(node)).toBe('') // or some default
})
```
**Why:** Check `supabase/schema.sql` for nullable fields. Articles may have null `summary`, chunks may have null `content`.

#### 5. Multiple Opacity Setters
```typescript
test('keyword label opacity comes from single source', () => {
  // Test that only ONE system sets opacity, not multiple conflicting ones
  const label = renderKeywordLabel({ opacity: 0.5 })
  const computedOpacity = getComputedStyle(label).opacity
  expect(computedOpacity).toBe('0.5')

  // Verify no other systems override it
  simulateZoomChange(10)
  expect(getComputedStyle(label).opacity).toBe('0.5') // still 0.5
})
```
**Why:** This project has had bugs where `baseOpacity`, `keywordLabelOpacity`, and zoom-based fading all set opacity on the same element, causing dim labels.

#### 6. Cluster ID Systems
```typescript
test('uses correct cluster ID system (precomputed vs runtime)', () => {
  const { result } = renderHook(() => useTopicsFilter())

  // Click a cluster label
  act(() => result.current.handleClusterClick('cluster_5'))

  // Verify it queries precomputed clusters, not runtime ones
  expect(mockGraphQuery).toHaveBeenCalledWith({
    clusterId: 'cluster_5',
    usePrecomputed: true
  })
})
```
**Why:** Project uses BOTH precomputed clusters (from database) and runtime clusters (client-side). They have different ID systems.

### Test Structure Patterns

**Component tests:**
```typescript
// src/components/__tests__/KeywordNodes.test.tsx
import { render } from '@testing-library/react'
import { Canvas } from '@react-three/fiber'
import { KeywordNodes } from '../topics-r3f/KeywordNodes'

test('renders keyword nodes with correct colors', () => {
  render(
    <Canvas>
      <KeywordNodes nodes={mockNodes} />
    </Canvas>
  )
  // assertions
})
```

**Hook tests:**
```typescript
// src/hooks/__tests__/useTopicsFilter.test.ts
import { renderHook, act } from '@testing-library/react'
import { useTopicsFilter } from '../useTopicsFilter'

test('filters nodes by cluster', () => {
  const { result } = renderHook(() => useTopicsFilter(mockData))
  act(() => result.current.setClusterFilter('cluster_5'))
  expect(result.current.filteredNodes).toHaveLength(10)
})
```

**Utility tests:**
```typescript
// src/lib/__tests__/topics-graph-nodes.test.ts
import { convertToSimNodes } from '../topics-graph-nodes'

test('converts graph data to simulation nodes', () => {
  const simNodes = convertToSimNodes(mockGraphData)
  expect(simNodes).toHaveLength(mockGraphData.nodes.length)
  expect(simNodes[0]).toHaveProperty('id')
  expect(simNodes[0]).toHaveProperty('x')
})
```

### Running Tests

```bash
npm test                                      # Watch mode
npm test -- --run                             # Run once
npm test -- src/lib/__tests__/parser.test.ts --run  # Specific file
npx tsc --noEmit                              # Type check
```

### Integration with Superpowers TDD Skill

Use `superpowers:test-driven-development` for the TDD process discipline. This guide provides the **what to test** for this specific project; the skill enforces the **how to test** (RED-GREEN-REFACTOR).

**Workflow:**
1. Invoke `/superpowers:test-driven-development`
2. Follow RED-GREEN-REFACTOR cycle from the skill
3. Use the edge cases above to guide what tests to write
4. Reference architecture files (the three essential files) when designing tests

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
