/**
 * Manages a buffered instance count for R3F instancedMesh.
 *
 * Problem: R3F destroys/recreates <instancedMesh> when `args` changes,
 * silently dropping all event handlers (onClick, onPointerDown, etc.).
 *
 * Solution: Over-allocate with a buffer so small count changes don't
 * trigger reallocation. When reallocation does happen, a new meshKey
 * forces a proper React remount so handlers get re-registered.
 */
import { useEffect, useRef } from "react";

const DEFAULT_BUFFER_RATIO = 1.5;

/** Pure computation - given current count and previous stableCount, compute new allocation. */
export function computeStableCount(
  count: number,
  currentStableCount: number,
  bufferRatio: number
): { stableCount: number; reallocated: boolean } {
  if (count === 0 && currentStableCount === 0) {
    return { stableCount: 0, reallocated: false };
  }
  if (count <= currentStableCount) {
    return { stableCount: currentStableCount, reallocated: false };
  }
  return { stableCount: Math.ceil(count * bufferRatio), reallocated: true };
}

export function useStableInstanceCount(
  count: number,
  bufferRatio: number = DEFAULT_BUFFER_RATIO
): { stableCount: number; meshKey: number } {
  const stableCountRef = useRef(0);
  const meshKeyRef = useRef(0);
  const mountedRef = useRef(false);

  const { stableCount, reallocated } = computeStableCount(
    count,
    stableCountRef.current,
    bufferRatio
  );

  if (reallocated) {
    if (mountedRef.current && process.env.NODE_ENV === "development") {
      console.warn(
        `[useStableInstanceCount] Reallocation: ${stableCountRef.current} -> ${stableCount} (count=${count})`
      );
    }
    stableCountRef.current = stableCount;
    meshKeyRef.current += 1;
  }

  // Set in effect, not render — Strict Mode calls render twice, and setting
  // during render would cause a false reallocation warning on the second call.
  useEffect(() => { mountedRef.current = true; }, []);

  return { stableCount: stableCountRef.current, meshKey: meshKeyRef.current };
}
