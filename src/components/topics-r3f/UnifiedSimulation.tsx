/**
 * Unified D3 force simulation for both keywords AND content nodes.
 * Alternative to separate ForceSimulation + useContentSimulation.
 *
 * When enabled:
 * - Keywords and content nodes exist in the same simulation
 * - Content nodes are tethered to their parent keywords via spring forces
 * - All nodes interact via collision and charge forces
 */

import { useEffect, useRef, useMemo } from "react";
import * as d3 from "d3";
import type { KeywordNode, SimilarityEdge } from "@/lib/graph-queries";
import type { SimNode } from "@/lib/map-renderer";
import type { ContentSimNode } from "@/lib/content-layout";
import { createContentNodes } from "@/lib/content-layout";
import type { ContentNode } from "@/lib/content-loader";
import { BASE_DOT_RADIUS, DOT_SCALE_FACTOR } from "@/lib/rendering-utils/node-renderer";
import {
  calculateSimulationAlpha,
  calculateVelocityDecay,
} from "@/lib/simulation-zoom-config";

/**
 * Custom force that tethers content nodes to their parent keywords.
 * Keywords are unaffected by this force.
 */
function tetherToParent(
  keywordMap: Map<string, SimNode | ContentSimNode>,
  contentCountsByParent: Map<string, number>,
  keywordRadius: number,
  contentRadius: number,
  springStrength: number = 0.1,
  baseDistanceMultiplier: number = 2.5,
  contentSpreadFactor: number = 1.5
) {
  function force(alpha: number) {
    const nodes = (force as any).nodes() as (SimNode | ContentSimNode)[];

    for (const node of nodes) {
      // Only apply to content nodes (skip keywords)
      // Content nodes have type "chunk" or "article", keywords have type "keyword"
      if (node.type === "keyword") continue;
      const contentNode = node as ContentSimNode;

      if (!contentNode.parentIds || contentNode.parentIds.length === 0) continue;
      if (contentNode.x === undefined || contentNode.y === undefined) {
        // Initialize at centroid of parents
        let centerX = 0;
        let centerY = 0;
        let validCount = 0;
        for (const parentId of contentNode.parentIds) {
          const parent = keywordMap.get(parentId);
          if (parent && parent.x !== undefined && parent.y !== undefined) {
            centerX += parent.x;
            centerY += parent.y;
            validCount++;
          }
        }
        if (validCount > 0) {
          contentNode.x = centerX / validCount;
          contentNode.y = centerY / validCount;
        }
        continue;
      }

      // Apply spring force from ALL parent keywords
      let totalFx = 0;
      let totalFy = 0;
      let closestDist = Infinity;
      let closestParentId: string | null = null;

      for (const parentId of contentNode.parentIds) {
        const parent = keywordMap.get(parentId);
        if (!parent || parent.x === undefined || parent.y === undefined) continue;

        const dx = parent.x - contentNode.x;
        const dy = parent.y - contentNode.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < closestDist) {
          closestDist = dist;
          closestParentId = parentId;
        }

        if (dist > 0) {
          const forceStrength = springStrength * alpha;
          totalFx += dx * forceStrength;
          totalFy += dy * forceStrength;
        }
      }

      // Apply combined force
      contentNode.vx = (contentNode.vx || 0) + totalFx;
      contentNode.vy = (contentNode.vy || 0) + totalFy;

      // Enforce max distance from closest parent
      if (closestParentId) {
        const contentCount = contentCountsByParent.get(closestParentId) ?? 1;
        const baseDistance = keywordRadius * baseDistanceMultiplier;
        const additionalSpace = Math.log(contentCount) * contentRadius * contentSpreadFactor;
        const maxDistance = baseDistance + additionalSpace;

        if (closestDist > maxDistance) {
          const closestParent = keywordMap.get(closestParentId);
          if (closestParent && closestParent.x !== undefined && closestParent.y !== undefined) {
            const scale = maxDistance / closestDist;
            contentNode.x = closestParent.x + (contentNode.x - closestParent.x) * scale;
            contentNode.y = closestParent.y + (contentNode.y - closestParent.y) * scale;
          }
        }
      }
    }
  }

  (force as any).initialize = function(nodes: (SimNode | ContentSimNode)[]) {
    (force as any).nodes = () => nodes;
  };

  return force;
}

export interface UnifiedSimulationProps {
  keywordNodes: KeywordNode[];
  /** Map of keyword ID to content chunks for that keyword */
  contentsByKeyword?: Map<string, ContentNode[]>;
  edges: SimilarityEdge[];
  /** Charge force strength for node repulsion (negative = repel, default -200) */
  chargeStrength?: number;
  /** Spring strength for tethering content to keywords */
  springStrength?: number;
  /** Content size multiplier for collision radius */
  contentSizeMultiplier?: number;
  /** Callback when simulation nodes are ready */
  onSimulationReady?: (allNodes: (SimNode | ContentSimNode)[]) => void;
  /** Callback to expose tick method for manual frame-synced updates */
  onTickReady?: (tick: () => void) => void;
  /** Current camera Z for zoom-dependent simulation energy */
  cameraZ?: number;
}

const INITIAL_ALPHA = 0.3;
const INITIAL_VELOCITY_DECAY = 0.5;
const SAFETY_TIMEOUT_MS = 20000;

export function UnifiedSimulation({
  keywordNodes,
  contentsByKeyword,
  edges,
  chargeStrength = -200,
  springStrength = 0.1,
  contentSizeMultiplier = 1.5,
  onSimulationReady,
  onTickReady,
  cameraZ,
}: UnifiedSimulationProps) {
  const simulationRef = useRef<d3.Simulation<SimNode | ContentSimNode, undefined> | null>(null);
  const prevCameraZRef = useRef<number | undefined>(undefined);

  // Calculate radii for collision and tethering
  const keywordRadius = BASE_DOT_RADIUS * DOT_SCALE_FACTOR;
  const contentRadius = keywordRadius * contentSizeMultiplier * 1.0;

  // Convert keyword nodes to SimNode format (needed for createContentNodes)
  const keywordSimNodes = useMemo(() => {
    return keywordNodes.map((n) => ({
      id: n.id,
      type: "keyword" as const,
      label: n.label,
      communityId: n.communityId,
      embedding: n.embedding,
      communityMembers: undefined,
      hullLabel: undefined,
      x: Math.random() * 1000 - 500,
      y: Math.random() * 1000 - 500,
    }));
  }, [keywordNodes]);

  // Create content nodes from contentsByKeyword
  const contentNodes = useMemo(() => {
    if (!contentsByKeyword || contentsByKeyword.size === 0 || keywordSimNodes.length === 0) {
      return [];
    }
    const { contentNodes } = createContentNodes(keywordSimNodes, contentsByKeyword);
    return contentNodes;
  }, [keywordSimNodes, contentsByKeyword]);

  // Precompute content counts per parent for dynamic tether distance
  const contentCountsByParent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of contentNodes) {
      for (const parentId of node.parentIds) {
        counts.set(parentId, (counts.get(parentId) ?? 0) + 1);
      }
    }
    return counts;
  }, [contentNodes]);

  // Create / recreate simulation when nodes or edges change
  useEffect(() => {
    prevCameraZRef.current = undefined;

    // Combine keyword and content nodes
    const allNodes: (SimNode | ContentSimNode)[] = [...keywordSimNodes, ...contentNodes];

    // Build keyword map for tether force
    const keywordMap = new Map<string, SimNode | ContentSimNode>();
    for (const node of allNodes) {
      keywordMap.set(node.id, node);
    }

    onSimulationReady?.(allNodes);

    const links = edges.map((e) => ({
      source: e.source,
      target: e.target,
      similarity: e.similarity,
    }));

    const simulation = d3
      .forceSimulation(allNodes)
      // Link force only between keywords (not content)
      .force(
        "link",
        d3
          .forceLink(links)
          .id((d: any) => d.id)
          .distance((d: any) => {
            const sim = d.similarity ?? 0.5;
            return 40 + (1 - sim) * 150;
          })
          .strength((d: any) => {
            const sim = d.similarity ?? 0.5;
            return 0.2 + sim * 0.8;
          })
      )
      // Charge force affects all nodes
      .force("charge", d3.forceManyBody().strength(chargeStrength))
      // Collision force with different radii for keywords vs content
      .force(
        "collide",
        d3.forceCollide<SimNode | ContentSimNode>()
          .radius((d) => d.type === "keyword" ? keywordRadius : contentRadius)
          .strength(0.8)
          .iterations(2)
      )
      // Tether force for content nodes to parent keywords
      .force("tether", tetherToParent(
        keywordMap,
        contentCountsByParent,
        keywordRadius,
        contentRadius,
        springStrength,
        2.0, // baseDistanceMultiplier
        1.0  // contentSpreadFactor
      ))
      .force("center", d3.forceCenter(0, 0))
      .alphaDecay(0.01)
      .velocityDecay(INITIAL_VELOCITY_DECAY)
      .alpha(INITIAL_ALPHA)
      .stop(); // Prevent auto-ticking, manual tick from useFrame instead

    const stopTimeout = setTimeout(() => simulation.stop(), SAFETY_TIMEOUT_MS);
    simulationRef.current = simulation;

    // Expose tick method for frame-synchronized updates
    onTickReady?.(() => {
      simulation.tick();
    });

    return () => {
      clearTimeout(stopTimeout);
      simulation.stop();
      simulationRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keywordSimNodes, contentNodes, edges, chargeStrength, contentSizeMultiplier, contentCountsByParent]);

  // Update forces when spring strength changes (hot restart for immediate feedback)
  useEffect(() => {
    const simulation = simulationRef.current;
    if (!simulation) return;

    // Build keyword map
    const allNodes = simulation.nodes();
    const keywordMap = new Map<string, SimNode | ContentSimNode>();
    for (const node of allNodes) {
      keywordMap.set(node.id, node);
    }

    // Recreate tether force with new spring strength
    simulation.force("tether", tetherToParent(
      keywordMap,
      contentCountsByParent,
      keywordRadius,
      contentRadius,
      springStrength,
      2.5, // baseDistanceMultiplier
      1.5  // contentSpreadFactor
    ));

    // Reignite simulation with high heat for immediate visual feedback
    simulation.alpha(0.8).restart();
  }, [springStrength, contentCountsByParent, keywordRadius, contentRadius]);

  // Adjust simulation energy when zoom changes
  useEffect(() => {
    const simulation = simulationRef.current;
    if (!simulation || cameraZ === undefined) return;

    // Skip first render
    if (prevCameraZRef.current === undefined) {
      prevCameraZRef.current = cameraZ;
      return;
    }

    simulation.velocityDecay(calculateVelocityDecay(cameraZ));

    const targetAlpha = calculateSimulationAlpha(cameraZ);
    if (Math.abs(targetAlpha - simulation.alpha()) > 0.01) {
      simulation.alpha(targetAlpha);
    }

    prevCameraZRef.current = cameraZ;
  }, [cameraZ]);

  return null;
}
