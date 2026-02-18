import { useRef, useEffect } from "react";
import { easeOutCubic } from "./usePositionInterpolation";

type Phase = "idle" | "activating" | "tracking" | "deactivating";

interface LensTransitionState {
  phase: Phase;
  startPositions: Float32Array;
  startTime: number;
}

export interface LensTransitionOptions {
  activateDuration?: number;   // default 500ms
  deactivateDuration?: number; // default 400ms
  easing?: (t: number) => number;
}

/**
 * Smoothly interpolates between source and target position arrays when
 * `active` toggles. Mirrors the TopicsView focus mode push/return animation
 * pattern, but operates on flat Float32Array [x0, y0, x1, y1, ...] instead
 * of a per-node Map.
 *
 * @param sourcePositionsRef - Natural/UMAP positions (updated each frame by caller)
 * @param targetPositionsRef - Fisheye-compressed positions (updated each frame by caller)
 * @param active - Lens on/off trigger
 * @param setupUpdateLoop - Caller passes their useFrame wrapper here
 * @returns animatedPositionsRef - Use this as renderPositions
 */
export function useLensTransition(
  sourcePositionsRef: React.RefObject<Float32Array>,
  targetPositionsRef: React.RefObject<Float32Array>,
  active: boolean,
  setupUpdateLoop: (cb: () => void) => void,
  options: LensTransitionOptions = {},
): React.RefObject<Float32Array> {
  const {
    activateDuration = 500,
    deactivateDuration = 400,
    easing = easeOutCubic,
  } = options;

  const stateRef = useRef<LensTransitionState | null>(null);
  const animatedRef = useRef<Float32Array>(new Float32Array(0));
  const activeRef = useRef(active);

  // Track active changes and start transitions
  useEffect(() => {
    const prev = activeRef.current;
    activeRef.current = active;

    const source = sourcePositionsRef.current;
    const target = targetPositionsRef.current;
    if (!source || !target) return;

    const n = source.length;

    // Ensure animatedRef is the right size
    if (animatedRef.current.length !== n) {
      animatedRef.current = new Float32Array(n);
      // Initialize from source so first frame isn't garbage
      animatedRef.current.set(source);
    }

    if (active && !prev) {
      // Snapshot current animated positions as start
      const startPositions = new Float32Array(animatedRef.current);
      stateRef.current = { phase: "activating", startPositions, startTime: performance.now() };
    } else if (!active && prev) {
      const startPositions = new Float32Array(animatedRef.current);
      stateRef.current = { phase: "deactivating", startPositions, startTime: performance.now() };
    }
  }, [active, sourcePositionsRef, targetPositionsRef]);

  setupUpdateLoop(() => {
    const source = sourcePositionsRef.current;
    const target = targetPositionsRef.current;
    if (!source || !target) return;

    const n = source.length;
    if (animatedRef.current.length !== n) {
      animatedRef.current = new Float32Array(n);
      animatedRef.current.set(activeRef.current ? target : source);
    }

    const state = stateRef.current;

    if (!state) {
      // Passthrough: copy source or target directly
      animatedRef.current.set(activeRef.current ? target : source);
      return;
    }

    const elapsed = performance.now() - state.startTime;

    if (state.phase === "activating") {
      const duration = activateDuration;
      const rawT = Math.min(1, elapsed / duration);
      const t = easing(rawT);
      const start = state.startPositions;
      for (let i = 0; i < n; i++) {
        animatedRef.current[i] = start[i] + (target[i] - start[i]) * t;
      }
      if (rawT >= 1) {
        stateRef.current = { ...state, phase: "tracking" };
      }
    } else if (state.phase === "tracking") {
      // Animation done: track target directly
      animatedRef.current.set(target);
    } else if (state.phase === "deactivating") {
      const duration = deactivateDuration;
      const rawT = Math.min(1, elapsed / duration);
      const t = easing(rawT);
      const start = state.startPositions;
      for (let i = 0; i < n; i++) {
        animatedRef.current[i] = start[i] + (source[i] - start[i]) * t;
      }
      if (rawT >= 1) {
        stateRef.current = null; // back to idle
      }
    }
  });

  return animatedRef;
}
