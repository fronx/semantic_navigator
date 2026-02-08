/**
 * Animated set membership: smoothly fades opacity for IDs entering/leaving a Set.
 * Useful for crossfading edges, nodes, or labels as items move in/out of a group.
 *
 * Returns a ref to a Map<string, number> with animated opacities (0→1).
 * Fully faded entries are cleaned up automatically.
 *
 * Requires R3F context (uses useFrame).
 */

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";

const FADE_THRESHOLD = 0.005;

export function useFadingMembership(
  activeIdsRef: React.RefObject<Set<string>> | undefined,
  lerpSpeed = 0.08,
): React.RefObject<Map<string, number>> {
  const fadeMapRef = useRef(new Map<string, number>());

  useFrame(() => {
    const activeIds = activeIdsRef?.current;
    if (!activeIds) return;

    const fadeMap = fadeMapRef.current;

    // Lerp tracked entries toward their target
    for (const [id, opacity] of fadeMap) {
      const target = activeIds.has(id) ? 1 : 0;
      const next = opacity + (target - opacity) * lerpSpeed;
      if (next < FADE_THRESHOLD && target === 0) {
        fadeMap.delete(id);
      } else {
        fadeMap.set(id, Math.min(next, 1));
      }
    }

    // Initialize newly active entries
    for (const id of activeIds) {
      if (!fadeMap.has(id)) {
        fadeMap.set(id, lerpSpeed);
      }
    }
  });

  return fadeMapRef;
}
