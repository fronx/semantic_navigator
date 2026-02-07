/**
 * useStableEffect - Like useEffect but warns when dependencies change too frequently.
 *
 * Use this for expensive effects (like creating/destroying managers) to detect
 * instability bugs during development.
 */

import { useEffect, useRef } from 'react';

interface StableEffectOptions {
  /**
   * Name for this effect (shown in warnings)
   */
  name: string;

  /**
   * Maximum number of times effect can run in the warning window
   * before triggering a warning. Default: 5
   */
  maxRunsBeforeWarn?: number;

  /**
   * Time window in ms to count runs. Default: 1000ms
   */
  windowMs?: number;

  /**
   * Whether to enable warnings. Default: true in development, false in production
   */
  enabled?: boolean;
}

/**
 * Like useEffect, but warns when it runs too frequently.
 *
 * @example
 * useStableEffect(
 *   () => {
 *     const manager = createLabelManager(...);
 *     return () => manager.destroy();
 *   },
 *   [callback1, callback2, data],
 *   {
 *     name: 'label-manager',
 *     maxRunsBeforeWarn: 3,  // Warn if runs >3 times in 1 second
 *   }
 * );
 */
export function useStableEffect(
  effect: React.EffectCallback,
  deps: React.DependencyList,
  options: StableEffectOptions
): void {
  const {
    name,
    maxRunsBeforeWarn = 5,
    windowMs = 1000,
    enabled = process.env.NODE_ENV === 'development',
  } = options;

  const runTimestampsRef = useRef<number[]>([]);
  const hasWarnedRef = useRef(false);

  useEffect(() => {
    if (enabled) {
      const now = Date.now();
      const timestamps = runTimestampsRef.current;

      // Add current run
      timestamps.push(now);

      // Remove runs outside the window
      const cutoff = now - windowMs;
      while (timestamps.length > 0 && timestamps[0]! < cutoff) {
        timestamps.shift();
      }

      // Check if we're running too frequently
      if (timestamps.length > maxRunsBeforeWarn && !hasWarnedRef.current) {
        console.warn(
          `[useStableEffect] Effect "${name}" ran ${timestamps.length} times in ${windowMs}ms (max: ${maxRunsBeforeWarn}). ` +
          `This suggests unstable dependencies. Check for:\n` +
          `  1. Inline arrow functions in JSX props\n` +
          `  2. useCallback/useMemo with frequently-changing dependencies\n` +
          `  3. Objects/arrays created inline without memoization\n\n` +
          `Dependencies:`, deps
        );
        hasWarnedRef.current = true;
      }
    }

    // Run the actual effect
    return effect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * Example usage - replace this:
 *
 * useEffect(() => {
 *   const manager = createManager({ onHover, onChunkLabel });
 *   return () => manager.destroy();
 * }, [onHover, onChunkLabel]);
 *
 * With this:
 *
 * useStableEffect(
 *   () => {
 *     const manager = createManager({ onHover, onChunkLabel });
 *     return () => manager.destroy();
 *   },
 *   [onHover, onChunkLabel],
 *   { name: 'label-manager' }
 * );
 *
 * Now you'll get warnings if the effect runs too frequently (e.g., on every mouse move).
 */
