/**
 * D3-based force simulation for content nodes.
 * Provides collision detection and tethering to parent keywords.
 */

import { useEffect, useRef, useMemo } from "react";
import * as d3 from "d3-force";
import type { ContentSimNode } from "@/lib/content-layout";
import type { SimNode } from "@/lib/map-renderer";
import { BASE_DOT_RADIUS, DOT_SCALE_FACTOR } from "@/lib/three/node-renderer";

/**
 * Custom force that tethers content nodes to their parent keywords.
 * Applies spring force toward parent and enforces dynamic max distance constraint.
 */
function tetherToParent(
  keywords: Map<string, SimNode>,
  contentCountsByParent: Map<string, number>,
  keywordRadius: number,
  contentRadius: number,
  springStrength: number = 0.1,
  baseDistanceMultiplier: number = 2.5,
  contentSpreadFactor: number = 1.5
) {
  // D3 force function: receives alpha, mutates nodes in place
  function force(alpha: number) {
    // Access nodes through simulation context
    const nodes = (force as any).nodes() as ContentSimNode[];

    for (const node of nodes) {
      const parent = keywords.get(node.parentId);
      if (!parent || parent.x === undefined || parent.y === undefined) continue;
      if (node.x === undefined || node.y === undefined) {
        node.x = parent.x;
        node.y = parent.y;
        continue;
      }

      // Spring force toward parent
      const dx = parent.x - node.x;
      const dy = parent.y - node.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 0) {
        const forceStrength = springStrength * alpha;
        node.vx = (node.vx || 0) + dx * forceStrength;
        node.vy = (node.vy || 0) + dy * forceStrength;
      }

      // DYNAMIC max distance based on sibling count
      const contentCount = contentCountsByParent.get(node.parentId) ?? 1;
      const baseDistance = keywordRadius * baseDistanceMultiplier;
      const additionalSpace = Math.sqrt(contentCount) * contentRadius * contentSpreadFactor;
      const maxDistance = baseDistance + additionalSpace;

      // Hard constraint: enforce max distance
      if (dist > maxDistance) {
        const scale = maxDistance / dist;
        node.x = parent.x + (node.x - parent.x) * scale;
        node.y = parent.y + (node.y - parent.y) * scale;
      }
    }
  }

  // Store nodes accessor for D3 simulation
  (force as any).initialize = function(nodes: ContentSimNode[]) {
    (force as any).nodes = () => nodes;
  };

  return force;
}

export interface UseContentSimulationOptions {
  /** Content nodes to simulate */
  contentNodes: ContentSimNode[];
  /** Map of keyword ID to keyword node (for tethering) */
  keywords: Map<string, SimNode>;
  /** Base keyword radius (for tether distance constraint) */
  keywordRadius: number;
  /** Content size multiplier (1.0-3.0, affects collision radius) */
  contentSizeMultiplier?: number;
  /** Collision strength (0-1, how hard content nodes push apart) */
  collisionStrength?: number;
  /** Spread factor for dynamic tether distance (default: 1.5) */
  contentSpreadFactor?: number;
}

export interface ContentSimulation {
  /** Manually tick the simulation forward one step */
  tick: () => void;
  /** Current alpha (heat) of the simulation */
  alpha: () => number;
  /** Restart simulation with new heat */
  restart: () => void;
}

/**
 * Hook that manages a D3 force simulation for content nodes.
 *
 * Features:
 * - Collision detection between all content nodes using forceCollide()
 * - Tethering to parent keywords with spring force
 * - Max distance constraint from parent
 * - Handles dynamic content node sizing via contentSizeMultiplier
 *
 * Usage:
 * ```tsx
 * const simulation = useContentSimulation({ contentNodes, keywords, keywordRadius, contentSizeMultiplier });
 *
 * useFrame(() => {
 *   simulation.tick(); // Advance one step per frame
 * });
 * ```
 */
export function useContentSimulation({
  contentNodes,
  keywords,
  keywordRadius,
  contentSizeMultiplier = 1.5,
  collisionStrength = 0.8,
  contentSpreadFactor = 1.5,
}: UseContentSimulationOptions): ContentSimulation {
  const simulationRef = useRef<d3.Simulation<ContentSimNode, undefined> | null>(null);

  // Calculate content collision radius (with 1.2x fudge factor for rounded squares)
  const contentRadius = useMemo(() => {
    return BASE_DOT_RADIUS * DOT_SCALE_FACTOR * contentSizeMultiplier * 1.2;
  }, [contentSizeMultiplier]);

  // Precompute content counts per parent for dynamic tether distance
  const contentCountsByParent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of contentNodes) {
      counts.set(node.parentId, (counts.get(node.parentId) ?? 0) + 1);
    }
    return counts;
  }, [contentNodes]);

  // Create simulation (recreate only on structural changes, not size changes)
  useEffect(() => {
    const simulation = d3.forceSimulation<ContentSimNode>()
      .alphaDecay(0.02) // Slower cooling than default (0.0228)
      .velocityDecay(0.3) // Higher damping for stability
      .force("collide", d3.forceCollide<ContentSimNode>()
        .radius(contentRadius)
        .strength(collisionStrength)
        .iterations(2) // More iterations = better collision resolution
      )
      .force("tether", tetherToParent(
        keywords,
        contentCountsByParent,
        keywordRadius,
        contentRadius,
        0.1, // springStrength
        2.5, // baseDistanceMultiplier
        contentSpreadFactor
      ))
      .stop(); // Don't auto-tick, we'll tick manually in useFrame

    simulationRef.current = simulation;

    return () => {
      simulation.stop();
    };
  }, [keywords, keywordRadius, contentCountsByParent, collisionStrength, contentSpreadFactor]);

  // Update nodes when content nodes change
  useEffect(() => {
    if (!simulationRef.current) return;

    simulationRef.current.nodes(contentNodes);

    // Gentle restart if we have content nodes
    if (contentNodes.length > 0) {
      simulationRef.current.alpha(0.3).restart();
    }
  }, [contentNodes]);

  // Update forces when content size changes (e.g., during zoom)
  useEffect(() => {
    if (!simulationRef.current) return;

    // Update collision force radius
    const collideForce = simulationRef.current.force("collide") as d3.ForceCollide<ContentSimNode>;
    if (collideForce) {
      collideForce.radius(contentRadius);
    }

    // Recreate tether force with new content radius (affects max distance)
    simulationRef.current.force("tether", tetherToParent(
      keywords,
      contentCountsByParent,
      keywordRadius,
      contentRadius,
      0.1, // springStrength
      2.5, // baseDistanceMultiplier
      contentSpreadFactor
    ));

    // Reignite simulation with moderate heat to let nodes adjust
    simulationRef.current.alpha(0.3).restart();
  }, [contentRadius, keywords, contentCountsByParent, keywordRadius, contentSpreadFactor]);

  return useMemo(() => ({
    tick: () => simulationRef.current?.tick(),
    alpha: () => simulationRef.current?.alpha() ?? 0,
    restart: () => simulationRef.current?.restart(),
  }), []);
}
