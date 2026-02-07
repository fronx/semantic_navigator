# Enforcing Callback Stability

Multiple approaches to prevent unstable callback bugs at different stages of development.

## The Problem

Unstable callbacks in `useEffect` dependencies cause expensive recreation (label managers, WebGL contexts, etc.), leading to:
- Visible UI flicker
- Performance degradation
- Memory leaks from improper cleanup

See [Label Manager Stability](label-manager-stability.md) for the specific pattern.

## Defense in Depth

### 1. ESLint Rule (Build Time) ⚙️

**Best for:** Catching obvious mistakes before code review

The custom rule `eslint-rules/no-unstable-ref-callbacks.js` detects inline arrow functions that assign to refs:

```typescript
// ❌ Detected by linter
<Component onHover={(id) => {
  hoveredRef.current = id;  // Ref assignment in inline function
  callback(id);
}} />
```

**To enable:**

```js
// .eslintrc.js
module.exports = {
  plugins: ['local-rules'],
  rules: {
    'local-rules/no-unstable-ref-callbacks': 'error',
  },
};
```

**Requires:** ESLint plugin setup for local rules. See https://github.com/taskworld/eslint-plugin-local-rules

### 2. TypeScript Branded Types (Compile Time) 🔧

**Best for:** Enforcing stability at API boundaries

Use `StableCallback<T>` type to require callers to explicitly stabilize:

```typescript
import { StableCallback, makeStableCallback } from '@/lib/stable-types';
import { useStableCallback } from '@/hooks/useStableRef';

interface MyComponentProps {
  // ❌ Regular callback - can be unstable
  onRegularClick?: (id: string) => void;

  // ✓ Stable callback - enforced by type system
  onStableClick: StableCallback<(id: string) => void>;
}

// In parent:
const stable = useStableCallback((id) => console.log(id));
<MyComponent onStableClick={makeStableCallback(stable)} />

// This won't compile:
<MyComponent onStableClick={(id) => console.log(id)} />
//           ~~~~~~~~~~~ Type error: not assignable to StableCallback
```

**Pros:**
- Type-safe
- Self-documenting (API makes stability requirement explicit)
- Catches at compile time

**Cons:**
- Verbose (requires `makeStableCallback` wrapper)
- Only works at TypeScript boundaries (doesn't catch internal instability)

### 3. Runtime Detection (Dev Mode) 🔍

**Best for:** Finding subtle instability during development

Use `useStableEffect` instead of `useEffect` for expensive operations:

```typescript
import { useStableEffect } from '@/hooks/useStableEffect';

// Replace this:
useEffect(() => {
  const manager = createLabelManager({ onHover, onChunkLabel });
  return () => manager.destroy();
}, [onHover, onChunkLabel]);

// With this:
useStableEffect(
  () => {
    const manager = createLabelManager({ onHover, onChunkLabel });
    return () => manager.destroy();
  },
  [onHover, onChunkLabel],
  {
    name: 'label-manager',
    maxRunsBeforeWarn: 3,  // Warn if runs >3x in 1 second
  }
);
```

When dependencies change too frequently, you'll see:

```
[useStableEffect] Effect "label-manager" ran 10 times in 1000ms (max: 3).
This suggests unstable dependencies. Check for:
  1. Inline arrow functions in JSX props
  2. useCallback/useMemo with frequently-changing dependencies
  3. Objects/arrays created inline without memoization

Dependencies: [ƒ, ƒ, Map(5)]
```

**Pros:**
- Catches issues that slip through linting/types
- Provides actionable warnings with dependency values
- Zero runtime cost in production

**Cons:**
- Only detects at runtime (user must exercise the code path)

## Recommended Setup

Use **all three** for maximum protection:

1. **ESLint rule** → Catches obvious inline functions during development
2. **TypeScript types** → Documents API contracts and enforces at boundaries
3. **Runtime detection** → Safety net for subtle issues

```typescript
// In LabelsOverlay.tsx

import { StableCallback } from '@/lib/stable-types';
import { useStableEffect } from '@/hooks/useStableEffect';

interface LabelsOverlayProps {
  // Type system enforces stability
  onKeywordHover: StableCallback<(id: string | null) => void>;
}

export function LabelsOverlay({ onKeywordHover, contentsByKeyword }) {
  // Use ref for volatile data
  const contentsByKeywordRef = useRef(contentsByKeyword);
  contentsByKeywordRef.current = contentsByKeyword;

  const handleChunkLabel = useCallback((id, container) => {
    const data = contentsByKeywordRef.current;
    // ... use data
  }, []); // Empty deps - reads from ref

  // Runtime detection catches if dependencies become unstable
  useStableEffect(
    () => {
      const manager = createLabelManager({
        onKeywordHover,
        onChunkLabel: handleChunkLabel,
      });
      return () => manager.destroy();
    },
    [onKeywordHover, handleChunkLabel],
    { name: 'label-manager' }
  );
}
```

## When to Use Each

| Approach | When to Use |
|----------|-------------|
| **ESLint** | Always enable for the project |
| **TypeScript** | Public APIs, components with expensive effects |
| **Runtime** | Wrap expensive effects during active development, remove once stable |

## Related

- [Label Manager Stability Pattern](label-manager-stability.md) - The specific bug this prevents
- [Stable Refs Pattern](stable-refs.md) - General `useStableCallback` usage
