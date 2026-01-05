/**
 * Custom D3 force functions for graph simulations.
 *
 * These forces extend D3's built-in force simulation with specialized behaviors.
 * Each force is a factory function that returns a force function compatible with
 * d3.Simulation.force().
 */

import type { SimulationNodeDatum } from "d3";

/**
 * Options for the boundary force.
 */
export interface BoundaryForceOptions {
  /** Container width - used to compute center */
  width: number;
  /** Container height - used to compute center */
  height: number;
  /** Radius as a factor of min(width, height). Default: 1.5 */
  radiusFactor?: number;
  /** Strength multiplier for the pull-back force (default: 0.1) */
  strength?: number;
}

/**
 * Creates a boundary force that only affects nodes beyond a specified radius.
 *
 * Unlike d3.forceX/forceY with a strength function (which is evaluated once at
 * initialization), this force evaluates distance on every tick, making it truly
 * dynamic.
 *
 * Nodes inside the boundary radius feel no force. Nodes outside are pulled back
 * toward the boundary edge with strength proportional to how far they've drifted.
 *
 * @example
 * ```ts
 * const { simulation, nodes } = createForceSimulation(mapNodes, mapEdges, width, height);
 *
 * simulation.force("boundary", forceBoundary(nodes, { width, height }));
 * ```
 */
export function forceBoundary<T extends SimulationNodeDatum>(
  nodes: T[],
  options: BoundaryForceOptions
): () => void {
  const {
    width,
    height,
    radiusFactor = 1.5,
    strength = 0.1,
  } = options;

  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * radiusFactor;

  return () => {
    for (const node of nodes) {
      const dx = (node.x ?? 0) - centerX;
      const dy = (node.y ?? 0) - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > radius) {
        // Strength proportional to how far past boundary
        const overshoot = dist - radius;
        const force = strength * overshoot / dist;
        node.vx = (node.vx ?? 0) - dx * force;
        node.vy = (node.vy ?? 0) - dy * force;
      }
    }
  };
}
