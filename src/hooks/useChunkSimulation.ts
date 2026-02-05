/**
 * D3-based force simulation for chunk nodes.
 * Provides collision detection and tethering to parent keywords.
 */

import { useEffect, useRef, useMemo } from "react";
import * as d3 from "d3-force";
import type { ChunkSimNode } from "@/lib/chunk-layout";
import type { SimNode } from "@/lib/map-renderer";
import { BASE_DOT_RADIUS, DOT_SCALE_FACTOR } from "@/lib/three/node-renderer";

/**
 * Custom force that tethers chunks to their parent keywords.
 * Applies spring force toward parent and enforces dynamic max distance constraint.
 */
function tetherToParent(
  keywords: Map<string, SimNode>,
  chunkCountsByParent: Map<string, number>,
  keywordRadius: number,
  chunkRadius: number,
  springStrength: number = 0.1,
  baseDistanceMultiplier: number = 2.5,
  chunkSpreadFactor: number = 1.5
) {
  // D3 force function: receives alpha, mutates nodes in place
  function force(alpha: number) {
    // Access nodes through simulation context
    const nodes = (force as any).nodes() as ChunkSimNode[];

    for (const chunk of nodes) {
      const parent = keywords.get(chunk.parentId);
      if (!parent || parent.x === undefined || parent.y === undefined) continue;
      if (chunk.x === undefined || chunk.y === undefined) {
        chunk.x = parent.x;
        chunk.y = parent.y;
        continue;
      }

      // Spring force toward parent
      const dx = parent.x - chunk.x;
      const dy = parent.y - chunk.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 0) {
        const forceStrength = springStrength * alpha;
        chunk.vx = (chunk.vx || 0) + dx * forceStrength;
        chunk.vy = (chunk.vy || 0) + dy * forceStrength;
      }

      // DYNAMIC max distance based on sibling count
      const chunkCount = chunkCountsByParent.get(chunk.parentId) ?? 1;
      const baseDistance = keywordRadius * baseDistanceMultiplier;
      const additionalSpace = Math.sqrt(chunkCount) * chunkRadius * chunkSpreadFactor;
      const maxDistance = baseDistance + additionalSpace;

      // Hard constraint: enforce max distance
      if (dist > maxDistance) {
        const scale = maxDistance / dist;
        chunk.x = parent.x + (chunk.x - parent.x) * scale;
        chunk.y = parent.y + (chunk.y - parent.y) * scale;
      }
    }
  }

  // Store nodes accessor for D3 simulation
  (force as any).initialize = function(nodes: ChunkSimNode[]) {
    (force as any).nodes = () => nodes;
  };

  return force;
}

export interface UseChunkSimulationOptions {
  /** Chunk nodes to simulate */
  chunks: ChunkSimNode[];
  /** Map of keyword ID to keyword node (for tethering) */
  keywords: Map<string, SimNode>;
  /** Base keyword radius (for tether distance constraint) */
  keywordRadius: number;
  /** Chunk size multiplier (1.0-3.0, affects collision radius) */
  chunkSizeMultiplier?: number;
  /** Collision strength (0-1, how hard chunks push apart) */
  collisionStrength?: number;
  /** Spread factor for dynamic tether distance (default: 1.5) */
  chunkSpreadFactor?: number;
}

export interface ChunkSimulation {
  /** Manually tick the simulation forward one step */
  tick: () => void;
  /** Current alpha (heat) of the simulation */
  alpha: () => number;
  /** Restart simulation with new heat */
  restart: () => void;
}

/**
 * Hook that manages a D3 force simulation for chunk nodes.
 *
 * Features:
 * - Collision detection between all chunks using forceCollide()
 * - Tethering to parent keywords with spring force
 * - Max distance constraint from parent
 * - Handles dynamic chunk sizing via chunkSizeMultiplier
 *
 * Usage:
 * ```tsx
 * const simulation = useChunkSimulation({ chunks, keywords, keywordRadius, chunkSizeMultiplier });
 *
 * useFrame(() => {
 *   simulation.tick(); // Advance one step per frame
 * });
 * ```
 */
export function useChunkSimulation({
  chunks,
  keywords,
  keywordRadius,
  chunkSizeMultiplier = 1.5,
  collisionStrength = 0.8,
  chunkSpreadFactor = 1.5,
}: UseChunkSimulationOptions): ChunkSimulation {
  const simulationRef = useRef<d3.Simulation<ChunkSimNode, undefined> | null>(null);

  // Calculate chunk collision radius (with 1.2x fudge factor for rounded squares)
  const chunkRadius = useMemo(() => {
    return BASE_DOT_RADIUS * DOT_SCALE_FACTOR * chunkSizeMultiplier * 1.2;
  }, [chunkSizeMultiplier]);

  // Precompute chunk counts per parent for dynamic tether distance
  const chunkCountsByParent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const chunk of chunks) {
      counts.set(chunk.parentId, (counts.get(chunk.parentId) ?? 0) + 1);
    }
    return counts;
  }, [chunks]);

  // Create simulation once
  useEffect(() => {
    const simulation = d3.forceSimulation<ChunkSimNode>()
      .alphaDecay(0.02) // Slower cooling than default (0.0228)
      .velocityDecay(0.3) // Higher damping for stability
      .force("collide", d3.forceCollide<ChunkSimNode>()
        .radius(chunkRadius)
        .strength(collisionStrength)
        .iterations(2) // More iterations = better collision resolution
      )
      .force("tether", tetherToParent(
        keywords,
        chunkCountsByParent,
        keywordRadius,
        chunkRadius,
        0.1, // springStrength
        2.5, // baseDistanceMultiplier
        chunkSpreadFactor
      ))
      .stop(); // Don't auto-tick, we'll tick manually in useFrame

    simulationRef.current = simulation;

    return () => {
      simulation.stop();
    };
  }, [keywords, keywordRadius, chunkRadius, chunkCountsByParent, collisionStrength, chunkSpreadFactor]);

  // Update nodes when chunks change
  useEffect(() => {
    if (!simulationRef.current) return;

    simulationRef.current.nodes(chunks);

    // Gentle restart if we have chunks
    if (chunks.length > 0) {
      simulationRef.current.alpha(0.3).restart();
    }
  }, [chunks]);

  // Update collision radius when chunkSizeMultiplier changes
  useEffect(() => {
    if (!simulationRef.current) return;

    const collideForce = simulationRef.current.force("collide") as d3.ForceCollide<ChunkSimNode>;
    if (collideForce) {
      collideForce.radius(chunkRadius);
      // Restart with low heat to adjust positions
      simulationRef.current.alpha(0.2).restart();
    }
  }, [chunkRadius]);

  return useMemo(() => ({
    tick: () => simulationRef.current?.tick(),
    alpha: () => simulationRef.current?.alpha() ?? 0,
    restart: () => simulationRef.current?.restart(),
  }), []);
}
