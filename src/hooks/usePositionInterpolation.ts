/**
 * Generic position interpolation hook for smooth transitions between coordinate sets.
 *
 * Provides time-based lerp animation with easing functions, similar to how useFadingVisibility
 * handles opacity/scale transitions. Works with both Map-based positions (TopicsView string IDs)
 * and array-based positions (ChunksView numeric indices).
 *
 * Common use cases:
 * - Focus mode transitions (nodes pushed to viewport edges)
 * - Lens mode compression (fisheye distortion)
 * - Layout transitions (force simulation → static positions)
 *
 * @example Map-based positions (TopicsView):
 * ```ts
 * const positionsRef = usePositionInterpolation({
 *   targetPositions: { nodeId: { x: 100, y: 200 }, ... },
 *   duration: 500,
 *   easing: easeOutCubic,
 * }, useFrame);
 * ```
 *
 * @example Array-based positions (ChunksView):
 * ```ts
 * const positionsRef = usePositionInterpolation({
 *   targetPositions: Float32Array[x1, y1, x2, y2, ...],
 *   duration: 400,
 *   easing: easeOutCubic,
 * }, useFrame);
 * ```
 */

import { useRef } from "react";

/** Ease-out cubic: fast start, smooth deceleration */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Ease-in-out cubic: smooth acceleration and deceleration */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Linear easing: constant speed */
export function linear(t: number): number {
  return t;
}

export type EasingFunction = (t: number) => number;

/** Position with x,y coordinates */
export interface Position {
  x: number;
  y: number;
}

/** Map-based positions: node ID → {x, y} */
export type MapPositions<TId extends string | number> = Map<TId, Position>;

/** Array-based positions: [x1, y1, x2, y2, ...] */
export type ArrayPositions = Float32Array;

/**
 * Animation state tracking start positions, targets, and timing.
 */
interface AnimationState<TId extends string | number> {
  /** Start positions for each node */
  startPositions: Map<TId, Position>;
  /** Target positions for each node */
  targetPositions: Map<TId, Position>;
  /** Animation start timestamp */
  startTime: number;
  /** Animation duration in milliseconds */
  duration: number;
}

export interface PositionInterpolationOptions<TId extends string | number> {
  /** Target positions to animate toward. When changed, triggers new animation. */
  targetPositions: MapPositions<TId> | null;
  /** Animation duration in milliseconds. Default 400ms */
  duration?: number;
  /** Easing function. Default easeOutCubic */
  easing?: EasingFunction;
  /** Initial positions (fallback when no animation is running). Default empty Map */
  initialPositions?: MapPositions<TId>;
}

/**
 * Generic position interpolation hook for Map-based positions.
 *
 * @param options - Animation configuration
 * @param setupUpdateLoop - Function that sets up the animation loop (useFrame for R3F, rAF for others)
 * @returns Ref to Map with interpolated positions
 */
export function usePositionInterpolation<TId extends string | number>(
  options: PositionInterpolationOptions<TId>,
  setupUpdateLoop: (updateCallback: () => void) => void,
): React.RefObject<MapPositions<TId>> {
  const {
    targetPositions,
    duration = 400,
    easing = easeOutCubic,
    initialPositions = new Map<TId, Position>(),
  } = options;

  const currentPositionsRef = useRef(new Map<TId, Position>());
  const animationStateRef = useRef<AnimationState<TId> | null>(null);
  const prevTargetPositionsRef = useRef<MapPositions<TId> | null>(null);

  const updatePositions = () => {
    // Detect target change → start new animation
    if (targetPositions !== prevTargetPositionsRef.current) {
      if (targetPositions && targetPositions.size > 0) {
        const startPositions = new Map<TId, Position>();

        // Capture current positions as start positions
        for (const [id, target] of Array.from(targetPositions.entries())) {
          const current = currentPositionsRef.current.get(id);
          startPositions.set(id, current ? { ...current } : { ...target });
        }

        animationStateRef.current = {
          startPositions,
          targetPositions: new Map(targetPositions),
          startTime: performance.now(),
          duration,
        };
      } else {
        // Clear animation when target is null/empty
        animationStateRef.current = null;
      }
      prevTargetPositionsRef.current = targetPositions;
    }

    // Run animation interpolation
    const anim = animationStateRef.current;
    if (anim) {
      const elapsed = performance.now() - anim.startTime;
      const rawT = Math.min(1, elapsed / anim.duration);
      const t = easing(rawT);

      for (const [id, start] of Array.from(anim.startPositions.entries())) {
        const target = anim.targetPositions.get(id);
        if (!target) continue;

        currentPositionsRef.current.set(id, {
          x: start.x + (target.x - start.x) * t,
          y: start.y + (target.y - start.y) * t,
        });
      }

      // Animation complete → finalize and clear
      if (rawT >= 1) {
        animationStateRef.current = null;
      }
    } else if (targetPositions) {
      // No animation running: use target positions directly
      currentPositionsRef.current = new Map(targetPositions);
    } else {
      // No target: use initial positions
      currentPositionsRef.current = new Map(initialPositions);
    }
  };

  setupUpdateLoop(updatePositions);

  return currentPositionsRef;
}

/**
 * Array-based position interpolation for Float32Array [x1, y1, x2, y2, ...].
 *
 * @param options - Animation configuration
 * @param setupUpdateLoop - Function that sets up the animation loop
 * @returns Ref to Float32Array with interpolated positions
 */
export interface ArrayPositionInterpolationOptions {
  /** Target positions as flat Float32Array [x1, y1, x2, y2, ...] */
  targetPositions: ArrayPositions | null;
  /** Animation duration in milliseconds. Default 400ms */
  duration?: number;
  /** Easing function. Default easeOutCubic */
  easing?: EasingFunction;
  /** Initial positions (fallback when no animation is running) */
  initialPositions?: ArrayPositions;
}

interface ArrayAnimationState {
  startPositions: Float32Array;
  targetPositions: Float32Array;
  startTime: number;
  duration: number;
}

export function useArrayPositionInterpolation(
  options: ArrayPositionInterpolationOptions,
  setupUpdateLoop: (updateCallback: () => void) => void,
): React.RefObject<ArrayPositions> {
  const {
    targetPositions,
    duration = 400,
    easing = easeOutCubic,
    initialPositions = new Float32Array(0),
  } = options;

  const currentPositionsRef = useRef(new Float32Array(0));
  const animationStateRef = useRef<ArrayAnimationState | null>(null);
  const prevTargetPositionsRef = useRef<ArrayPositions | null>(null);

  const updatePositions = () => {
    // Detect target change → start new animation
    if (targetPositions !== prevTargetPositionsRef.current) {
      if (targetPositions && targetPositions.length > 0) {
        // Allocate if needed
        if (currentPositionsRef.current.length !== targetPositions.length) {
          currentPositionsRef.current = new Float32Array(targetPositions.length);
        }

        const startPositions = new Float32Array(targetPositions.length);
        startPositions.set(currentPositionsRef.current.length > 0
          ? currentPositionsRef.current
          : targetPositions
        );

        animationStateRef.current = {
          startPositions,
          targetPositions: new Float32Array(targetPositions),
          startTime: performance.now(),
          duration,
        };
      } else {
        animationStateRef.current = null;
      }
      prevTargetPositionsRef.current = targetPositions;
    }

    // Run animation interpolation
    const anim = animationStateRef.current;
    if (anim) {
      const elapsed = performance.now() - anim.startTime;
      const rawT = Math.min(1, elapsed / anim.duration);
      const t = easing(rawT);

      const n = anim.startPositions.length;
      for (let i = 0; i < n; i++) {
        currentPositionsRef.current[i] =
          anim.startPositions[i] + (anim.targetPositions[i] - anim.startPositions[i]) * t;
      }

      if (rawT >= 1) {
        animationStateRef.current = null;
      }
    } else if (targetPositions && targetPositions.length > 0) {
      // No animation: use target directly
      if (currentPositionsRef.current.length !== targetPositions.length) {
        currentPositionsRef.current = new Float32Array(targetPositions);
      } else {
        currentPositionsRef.current.set(targetPositions);
      }
    } else {
      // No target: use initial
      if (currentPositionsRef.current.length !== initialPositions.length) {
        currentPositionsRef.current = new Float32Array(initialPositions);
      } else {
        currentPositionsRef.current.set(initialPositions);
      }
    }
  };

  setupUpdateLoop(updatePositions);

  return currentPositionsRef;
}
