# Label Manager Stability Pattern

## Problem

Label managers (and similar DOM-based overlays) are expensive to create and destroy. When they're in a `useEffect` dependency array, any changing dependency causes them to be destroyed and recreated, resulting in visible flickering.

## Root Cause

This bug has occurred **twice** (2026-02-06, 2026-02-07) with the same symptoms:
1. Inline arrow functions in JSX that contain `ref.current` assignments
2. Callbacks with unstable dependencies (like Maps that change reference frequently)
3. These callbacks are in the label manager's `useEffect` dependency array
4. Mouse movement or content updates trigger re-renders → new function references → label manager recreation → flicker

## The Pattern: Use Refs for Volatile Data

When a component uses `useEffect` with expensive setup/teardown (like creating a label manager), ALL dependencies must be stable across re-renders.

### Anti-Pattern ❌

```typescript
// Component receives a callback and a Map that changes frequently
function LabelsOverlay({ onKeywordHover, contentsByKeyword }) {
  // ❌ Inline arrow function recreates on every mouse move
  <SomeComponent onHover={(id) => {
    hoveredRef.current = id;
    onKeywordHover(id);
  }} />

  // ❌ Callback depends on frequently-changing Map
  const handleChunkLabel = useCallback((id, container, content) => {
    if (contentsByKeyword) {
      const chunks = contentsByKeyword.get(id);
      // ... use chunks
    }
  }, [contentsByKeyword]); // Changes whenever content loads

  // Label manager recreates whenever dependencies change
  useEffect(() => {
    const manager = createLabelManager({
      onKeywordHover: onKeywordHover, // unstable inline function from parent
      onChunkLabel: handleChunkLabel, // unstable due to contentsByKeyword
    });
    return () => manager.destroy();
  }, [onKeywordHover, handleChunkLabel]); // Both unstable!
}
```

### Correct Pattern ✓

```typescript
import { useStableCallback } from "@/hooks/useStableRef";

// Parent component stabilizes callbacks
function ParentComponent({ onKeywordHover }) {
  const stableOnKeywordHover = useStableCallback((id: string | null) => {
    hoveredKeywordIdRef.current = id;
    onKeywordHover(id);
  });

  return <LabelsOverlay onKeywordHover={stableOnKeywordHover} />;
}

// Child component uses refs for volatile data
function LabelsOverlay({ onKeywordHover, contentsByKeyword }) {
  // Stabilize parent callback
  const stableOnKeywordHover = useStableCallback(onKeywordHover);

  // Use ref for frequently-changing data
  const contentsByKeywordRef = useRef(contentsByKeyword);
  contentsByKeywordRef.current = contentsByKeyword;

  // Callback has NO dependencies - reads from ref instead
  const handleChunkLabel = useCallback((id, container, content) => {
    const contentsByKeyword = contentsByKeywordRef.current;
    if (contentsByKeyword) {
      const chunks = contentsByKeyword.get(id);
      // ... use chunks
    }
  }, []); // Empty deps - stable across re-renders

  // Label manager persists because all dependencies are stable
  useEffect(() => {
    const manager = createLabelManager({
      onKeywordHover: stableOnKeywordHover, // stable
      onChunkLabel: handleChunkLabel,       // stable
    });
    return () => manager.destroy();
  }, [stableOnKeywordHover, handleChunkLabel]); // Both stable ✓
}
```

## Key Rules

1. **Never write inline arrow functions in JSX that assign to refs** → Use `useStableCallback`
2. **For frequently-changing data in useEffect dependencies** → Use refs instead of direct closure
3. **Pattern to follow**: See `searchOpacitiesRef` in `LabelsOverlay.tsx` (lines 55-57)

## Affected Components

- `R3FTopicsCanvas.tsx` - Must stabilize callbacks passed to `LabelsOverlay`
- `LabelsOverlay.tsx` - Must use refs for volatile data like `contentsByKeyword`, `searchOpacities`

## Detection

If you see labels flickering on mouse movement or content loading:
1. Check `LabelsOverlay.tsx` line ~206 for the label manager `useEffect` dependencies
2. Verify ALL dependencies are stable (don't change on every render)
3. Use `useStableCallback` for callbacks
4. Use refs for frequently-changing data

## Prevention

See [Enforcing Stability](enforcing-stability.md) for:
- ESLint rules to detect unstable callbacks at build time
- TypeScript branded types to enforce stability at compile time
- Runtime detection hooks to catch issues during development

## Related

- [Stable Refs Pattern](stable-refs.md) - General pattern for stable callbacks
- [Enforcing Stability](enforcing-stability.md) - How to prevent this bug with tooling
- Investigation: [Keyword Node Clicks Broken](../investigations/keyword-node-clicks-broken-2026-02-06.md) - Different bug, same `useStableCallback` solution
