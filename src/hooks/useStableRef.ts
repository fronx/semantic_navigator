/**
 * Hooks for stable references that don't trigger re-renders.
 *
 * Use these when you need to access the latest value of a prop or state
 * inside an effect or callback without adding it to dependencies.
 */
import { useRef, useCallback } from "react";

/**
 * Returns a ref that always contains the latest value.
 * Use this to access props/state in effects without adding them as dependencies.
 *
 * @example
 * const configRef = useLatest(config);
 * useEffect(() => {
 *   // Access configRef.current - always has latest value
 *   // but doesn't cause effect to re-run when config changes
 * }, []);
 */
export function useLatest<T>(value: T): React.MutableRefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/**
 * Returns a stable callback that always calls the latest version of the function.
 * The returned function reference never changes, so it's safe to use in dependency arrays.
 *
 * @example
 * // Parent passes inline function - would normally cause child effects to re-run
 * <Child onSave={(data) => saveToServer(data)} />
 *
 * // Child uses stable callback - effect only runs once
 * const stableOnSave = useStableCallback(onSave);
 * useEffect(() => {
 *   // stableOnSave is stable, won't trigger re-runs
 *   setupAutoSave(stableOnSave);
 * }, [stableOnSave]);
 */
export function useStableCallback<T extends ((...args: any[]) => any) | undefined>(
  callback: T
): T extends undefined ? (() => void) : NonNullable<T> {
  const ref = useRef(callback);
  ref.current = callback;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback(
    ((...args: any[]) => ref.current?.(...args)) as T extends undefined
      ? () => void
      : NonNullable<T>,
    []
  );
}
