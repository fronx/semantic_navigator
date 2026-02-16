/**
 * Example usage patterns for usePositionInterpolation hooks.
 *
 * This file demonstrates how to use the position interpolation hooks
 * in both TopicsView (Map-based) and ChunksView (Float32Array-based) contexts.
 */

import { useFrame } from "@react-three/fiber";
import { useRef, useEffect } from "react";
import {
  usePositionInterpolation,
  useArrayPositionInterpolation,
  easeOutCubic,
  type MapPositions,
} from "./usePositionInterpolation";

// ============================================================================
// Example 1: Map-based positions with R3F (TopicsView pattern)
// ============================================================================

/**
 * R3F-based position interpolation for keyword nodes.
 * Animates positions when focus mode is activated/deactivated.
 */
function ExampleTopicsViewFocusAnimation() {
  // Simulate focus mode state
  const focusActive = true;
  const marginNodeIds = new Set(["keyword1", "keyword2", "keyword3"]);

  // Compute target positions based on focus state
  const targetPositions: MapPositions<string> | null = focusActive
    ? new Map([
        ["keyword1", { x: 100, y: 200 }],
        ["keyword2", { x: 300, y: 400 }],
        ["keyword3", { x: 500, y: 100 }],
      ])
    : null; // null = return to natural positions

  // Animate positions using R3F's useFrame
  const interpolatedPositionsRef = usePositionInterpolation(
    {
      targetPositions,
      duration: 500, // 500ms push animation
      easing: easeOutCubic,
      initialPositions: new Map([
        ["keyword1", { x: 0, y: 0 }],
        ["keyword2", { x: 0, y: 0 }],
        ["keyword3", { x: 0, y: 0 }],
      ]),
    },
    (updateCallback) => {
      // Setup R3F animation loop
      useFrame(updateCallback);
    }
  );

  // Use interpolated positions in render loop
  useFrame(() => {
    const positions = interpolatedPositionsRef.current;
    // Apply positions to instancedMesh, edges, labels, etc.
    for (const [nodeId, pos] of Array.from(positions.entries())) {
      console.log(`Node ${nodeId} at (${pos.x}, ${pos.y})`);
    }
  });
}

// ============================================================================
// Example 2: Array-based positions with R3F (ChunksView pattern)
// ============================================================================

/**
 * Float32Array position interpolation for chunk nodes.
 * Animates compression when lens mode is activated.
 */
function ExampleChunksViewLensAnimation() {
  const lensActive = true;

  // Base UMAP positions (unchanged)
  const basePositions = new Float32Array([0, 0, 100, 100, 200, 200]);

  // Compute compressed positions when lens is active
  const compressedPositions = lensActive
    ? new Float32Array([0, 0, 80, 80, 140, 140]) // Simulated fisheye compression
    : null;

  // Animate compression
  const interpolatedPositionsRef = useArrayPositionInterpolation(
    {
      targetPositions: compressedPositions,
      duration: 400,
      easing: easeOutCubic,
      initialPositions: basePositions,
    },
    (updateCallback) => {
      useFrame(updateCallback);
    }
  );

  useFrame(() => {
    const positions = interpolatedPositionsRef.current;
    // Apply positions to instancedMesh
    for (let i = 0; i < positions.length / 2; i++) {
      const x = positions[i * 2];
      const y = positions[i * 2 + 1];
      console.log(`Chunk ${i} at (${x}, ${y})`);
    }
  });
}

// ============================================================================
// Example 3: Non-R3F context using requestAnimationFrame
// ============================================================================

/**
 * Map-based position interpolation outside R3F context.
 * Uses requestAnimationFrame instead of useFrame.
 */
function ExampleNonR3FAnimation() {
  const focusActive = true;

  const targetPositions: MapPositions<string> | null = focusActive
    ? new Map([["node1", { x: 100, y: 100 }]])
    : null;

  const interpolatedPositionsRef = usePositionInterpolation(
    {
      targetPositions,
      duration: 400,
      easing: easeOutCubic,
      initialPositions: new Map([["node1", { x: 0, y: 0 }]]),
    },
    (updateCallback) => {
      // Setup RAF loop (non-R3F)
      useEffect(() => {
        let rafId: number | null = null;
        const tick = () => {
          updateCallback();
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
        return () => {
          if (rafId !== null) cancelAnimationFrame(rafId);
        };
      }, []);
    }
  );

  // Access interpolated positions
  const positions = interpolatedPositionsRef.current;
  console.log(positions.get("node1"));
}

// ============================================================================
// Example 4: Multiple animations in sequence
// ============================================================================

/**
 * Demonstrates chaining multiple position animations.
 * Useful for complex transitions like: focus activate → adjust to camera pan → focus deactivate
 */
function ExampleSequentialAnimations() {
  const [animationPhase, setAnimationPhase] = useState<
    "idle" | "pushing" | "tracking" | "returning"
  >("idle");

  const targetPositions: MapPositions<string> | null = (() => {
    switch (animationPhase) {
      case "pushing":
        return new Map([["node1", { x: 100, y: 200 }]]); // Push to edge
      case "tracking":
        return new Map([["node1", { x: 120, y: 220 }]]); // Track viewport
      case "returning":
        return null; // Return to natural position
      default:
        return null;
    }
  })();

  const interpolatedPositionsRef = usePositionInterpolation(
    {
      targetPositions,
      duration: animationPhase === "pushing" ? 500 : 400,
      easing: easeOutCubic,
    },
    (updateCallback) => {
      useFrame(updateCallback);
    }
  );

  // Simulate phase transitions
  useEffect(() => {
    if (animationPhase === "idle") {
      setTimeout(() => setAnimationPhase("pushing"), 1000);
    } else if (animationPhase === "pushing") {
      setTimeout(() => setAnimationPhase("tracking"), 500);
    } else if (animationPhase === "tracking") {
      setTimeout(() => setAnimationPhase("returning"), 2000);
    }
  }, [animationPhase]);
}

// ============================================================================
// Helper: Detect when animation completes
// ============================================================================

/**
 * Utility to trigger callbacks when animation completes.
 */
function useAnimationCompleteCallback(
  isAnimating: boolean,
  onComplete: () => void
) {
  const prevAnimatingRef = useRef(isAnimating);

  useEffect(() => {
    if (prevAnimatingRef.current && !isAnimating) {
      onComplete();
    }
    prevAnimatingRef.current = isAnimating;
  }, [isAnimating, onComplete]);
}

function ExampleWithCompletionCallback() {
  const focusActive = true;
  const targetPositions: MapPositions<string> | null = focusActive
    ? new Map([["node1", { x: 100, y: 100 }]])
    : null;

  const animationCompleteRef = useRef(false);

  const interpolatedPositionsRef = usePositionInterpolation(
    {
      targetPositions,
      duration: 400,
      easing: easeOutCubic,
    },
    (updateCallback) => {
      useFrame(() => {
        const wasAnimating = !animationCompleteRef.current;
        updateCallback();
        const isAnimating = targetPositions !== null;

        if (wasAnimating && !isAnimating) {
          console.log("Animation completed!");
          animationCompleteRef.current = true;
        }
      });
    }
  );
}
