# Stable Refs Pattern

## Problem

React effects re-run when their dependencies change. When a component receives callbacks or config objects as props, these often have new identities on every parent render, causing unwanted effect re-runs.

This is especially problematic for D3 visualizations where effect re-runs mean:
- Simulation restarts (nodes scatter and re-layout)
- Lost user interactions (zoom position, drag state)
- Performance overhead

## Solution

Use `useLatest` and `useStableCallback` from `src/hooks/useStableRef.ts` to create stable references that don't trigger re-renders.

### useLatest(value)

Returns a ref that always contains the latest value. Use when you need to read a prop/state inside an effect without adding it as a dependency.

```tsx
// Instead of this (causes re-run when config changes):
useEffect(() => {
  doSomething(config.threshold);
}, [config]); // effect re-runs on every config change

// Do this (effect runs once, always reads latest config):
const configRef = useLatest(config);
useEffect(() => {
  doSomething(configRef.current.threshold);
}, []); // stable - never re-runs
```

### useStableCallback(fn)

Returns a stable function that always calls the latest version. Use for callbacks passed to effects or child components.

```tsx
// Instead of this (effect re-runs when parent re-renders):
const handleChange = useCallback((x) => onChange?.(x), [onChange]);
useEffect(() => {
  subscribe(handleChange);
}, [handleChange]); // re-runs if onChange identity changes

// Do this (effect runs once, always calls latest onChange):
const handleChange = useStableCallback(onChange);
useEffect(() => {
  subscribe(handleChange);
}, []); // stable - never re-runs
```

## When to Use

Use stable refs when:
- **D3/Canvas effects** that shouldn't restart on prop changes
- **Event handlers** that read props but shouldn't cause re-setup
- **Subscriptions** that should persist across re-renders

Don't use when:
- The effect genuinely needs to re-run when the value changes
- You want React's normal re-render behavior

## Example: TopicsView

TopicsView has two types of updates:

1. **Layout updates** (expensive) - rebuild simulation when nodes/edges change
2. **Visual updates** (cheap) - update colors/labels without relayout

```tsx
// Stable callbacks - won't trigger layout effect re-runs
const handleZoomChange = useStableCallback(onZoomChange);
const handleKeywordClick = useStableCallback(onKeywordClick);

// Stable ref for config accessed in event handlers
const hoverConfigRef = useLatest(hoverConfig);

// Layout effect - only runs when graph structure changes
useEffect(() => {
  const renderer = createRenderer({
    callbacks: {
      onKeywordClick: handleKeywordClick, // stable
      onZoomEnd: (t) => handleZoomChange(t.k), // stable
    },
  });
  // ...
}, [nodes, edges, knnStrength, contrast]); // no callbacks in deps

// Visual update effect - runs when clusters change (no relayout)
useEffect(() => {
  // Update node colors and labels in place
  rendererRef.current?.refreshClusters();
}, [nodeToCluster, baseClusters, labels]);
```

## Files

- `src/hooks/useStableRef.ts` - Hook implementations
- `src/components/TopicsView.tsx` - Example usage
