/**
 * Animated scale for focus mode transitions.
 *
 * Similar to useFadingMembership but works with requestAnimationFrame
 * instead of R3F's useFrame, making it suitable for any rendering context.
 *
 * Returns a ref to a Map<number, number> with animated scale values (0→1).
 * Useful for smooth focus mode transitions in chunks view where nodes
 * should smoothly scale in/out rather than pop in/out.
 */

import { useRef, useEffect } from "react";
import { useFadingVisibility, type FadingVisibilityOptions } from "./useFadingVisibility";

/**
 * Animated scale hook using requestAnimationFrame.
 *
 * @param activeIdsRef - Ref to Set of currently visible IDs (typically node indices)
 * @param options - Animation options (lerpSpeed, fadeThreshold, initialValue)
 * @returns Ref to Map with animated scale values (0→1)
 *
 * @example
 * ```ts
 * const visibleNodesRef = useRef(new Set<number>());
 * const scalesRef = useFadingScale(visibleNodesRef, { lerpSpeed: 0.1 });
 *
 * // In render loop:
 * const scale = scalesRef.current.get(nodeIndex) ?? 0;
 * ```
 */
export function useFadingScale(
  activeIdsRef: React.RefObject<Set<number>> | undefined,
  options: FadingVisibilityOptions = {},
): React.RefObject<Map<number, number>> {
  const updateCallbackRef = useRef<(() => void) | null>(null);

  const fadeMapRef = useFadingVisibility(
    activeIdsRef,
    options,
    (updateCallback) => {
      updateCallbackRef.current = updateCallback;
    }
  );

  // Set up RAF loop
  useEffect(() => {
    let rafId: number | null = null;

    const tick = () => {
      updateCallbackRef.current?.();
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, []);

  return fadeMapRef;
}
