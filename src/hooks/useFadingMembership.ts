/**
 * Animated set membership for R3F: smoothly fades opacity for IDs entering/leaving a Set.
 * Useful for crossfading edges, nodes, or labels as items move in/out of a group.
 *
 * Returns a ref to a Map<string, number> with animated opacities (0→1).
 * Fully faded entries are cleaned up automatically.
 *
 * Requires R3F context (uses useFrame).
 *
 * This is a specialized version of useFadingVisibility for R3F contexts.
 * For non-R3F contexts, use useFadingVisibility directly.
 */

import { useFrame } from "@react-three/fiber";
import { useFadingVisibility, type FadingVisibilityOptions } from "./useFadingVisibility";

export function useFadingMembership(
  activeIdsRef: React.RefObject<Set<string>> | undefined,
  lerpSpeed = 0.08,
): React.RefObject<Map<string, number>> {
  return useFadingVisibility(
    activeIdsRef,
    { lerpSpeed },
    (updateCallback) => {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      useFrame(updateCallback);
    }
  );
}
