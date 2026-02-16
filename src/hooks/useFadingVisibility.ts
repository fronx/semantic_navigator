/**
 * Generic animated visibility hook: smoothly fades values for items entering/leaving a Set.
 *
 * This hook provides smooth transitions for any Set-based visibility state, animating
 * values from 0 to 1 as items enter the set, and from 1 to 0 as they leave.
 *
 * Unlike useFadingMembership (which is R3F-specific), this hook works in any context
 * by taking a custom update callback instead of requiring useFrame.
 *
 * Common use cases:
 * - Opacity fades for nodes/edges appearing/disappearing
 * - Scale animations for focus mode transitions
 * - Any Set-based membership animation
 *
 * @example R3F context (equivalent to useFadingMembership):
 * ```ts
 * const fadeMapRef = useFadingVisibility(visibleIdsRef, 0.08, useFrame);
 * ```
 *
 * @example React state context:
 * ```ts
 * const fadeMapRef = useFadingVisibility(visibleIdsRef, 0.08, (callback) => {
 *   useEffect(() => {
 *     const timer = setInterval(callback, 16); // ~60fps
 *     return () => clearInterval(timer);
 *   }, [callback]);
 * });
 * ```
 */

import { useRef } from "react";

const FADE_THRESHOLD = 0.005;

export interface FadingVisibilityOptions {
  /** Lerp speed (0-1). Higher = faster transition. Default 0.08 */
  lerpSpeed?: number;
  /** Threshold below which items are removed from the map. Default 0.005 */
  fadeThreshold?: number;
  /** Initial value for newly visible items. Default is lerpSpeed */
  initialValue?: number;
}

/**
 * Generic animated visibility hook.
 *
 * @param activeIdsRef - Ref to Set of currently visible IDs
 * @param options - Animation options (lerpSpeed, fadeThreshold, initialValue)
 * @param setupUpdateLoop - Function that sets up the animation loop.
 *   Receives a callback that should be called each frame.
 *   Should return cleanup function if needed.
 *
 * @returns Ref to Map<string, number> with animated values (0→1)
 */
export function useFadingVisibility<TId extends string | number>(
  activeIdsRef: React.RefObject<Set<TId>> | undefined,
  options: FadingVisibilityOptions,
  setupUpdateLoop: (updateCallback: () => void) => void,
): React.RefObject<Map<TId, number>> {
  const {
    lerpSpeed = 0.08,
    fadeThreshold = FADE_THRESHOLD,
    initialValue = lerpSpeed,
  } = options;

  const fadeMapRef = useRef(new Map<TId, number>());

  const updateFadeValues = () => {
    const activeIds = activeIdsRef?.current;
    if (!activeIds) return;

    const fadeMap = fadeMapRef.current;

    // Lerp tracked entries toward their target
    for (const [id, value] of fadeMap) {
      const target = activeIds.has(id) ? 1 : 0;
      const next = value + (target - value) * lerpSpeed;
      if (next < fadeThreshold && target === 0) {
        fadeMap.delete(id);
      } else {
        fadeMap.set(id, Math.min(next, 1));
      }
    }

    // Initialize newly active entries
    for (const id of activeIds) {
      if (!fadeMap.has(id)) {
        fadeMap.set(id, initialValue);
      }
    }
  };

  setupUpdateLoop(updateFadeValues);

  return fadeMapRef;
}

/**
 * Hook factory for creating fading visibility hooks in specific contexts.
 *
 * @example Create an R3F-specific hook:
 * ```ts
 * import { useFrame } from "@react-three/fiber";
 *
 * export function useFadingMembershipR3F(
 *   activeIdsRef: React.RefObject<Set<string>> | undefined,
 *   options: FadingVisibilityOptions = {},
 * ) {
 *   return useFadingVisibility(
 *     activeIdsRef,
 *     options,
 *     (callback) => { useFrame(callback); }
 *   );
 * }
 * ```
 */
export function createFadingVisibilityHook(
  setupUpdateLoop: (updateCallback: () => void) => void,
) {
  return function useFadingVisibilityHook<TId extends string | number>(
    activeIdsRef: React.RefObject<Set<TId>> | undefined,
    options: FadingVisibilityOptions = {},
  ): React.RefObject<Map<TId, number>> {
    return useFadingVisibility(activeIdsRef, options, setupUpdateLoop);
  };
}
