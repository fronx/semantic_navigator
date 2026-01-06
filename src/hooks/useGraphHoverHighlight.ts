/**
 * Hook for spatial-semantic hover highlighting on graph visualizations.
 *
 * When hovering over the graph, highlights nodes that are semantically
 * similar to the nodes under the cursor, dimming the rest.
 */

import { useEffect, useRef } from "react";
import * as d3 from "d3";
import {
  spatialSemanticFilter,
  buildAdjacencyMap,
  buildEmbeddingMap,
  type SpatialNode,
} from "@/lib/spatial-semantic";
import type { SimLink } from "@/lib/map-renderer";

// ============================================================================
// Configuration
// ============================================================================

export interface HoverHighlightConfig {
  /** Semantic similarity threshold for filtering (0-1) */
  similarityThreshold: number;
  /** Dim amount when nothing nearby (0-1, where 1 = fully dimmed) */
  baseDim: number;
  /** Spatial search radius as fraction of screen height */
  screenRadiusFraction?: number;
}

export const DEFAULT_HOVER_CONFIG: HoverHighlightConfig = {
  similarityThreshold: 0.7,
  baseDim: 0.7,
  screenRadiusFraction: 0.15,
};

// ============================================================================
// Types
// ============================================================================

interface NodeSelection {
  select(selector: string): {
    attr(name: string, value: number | ((d: { id: string }) => number)): void;
  };
}

interface LinkSelection {
  attr(name: string, value: ((d: SimLink) => number)): void;
}

interface RendererLike {
  nodeSelection: NodeSelection;
  linkSelection: LinkSelection;
  getTransform(): { k: number; x: number; y: number };
}

export interface UseGraphHoverHighlightOptions<T extends SpatialNode & { embedding?: number[] }> {
  /** SVG element ref */
  svgRef: React.RefObject<SVGSVGElement | null>;
  /** Renderer with node/link selections */
  renderer: RendererLike | null;
  /** All graph nodes */
  nodes: T[];
  /** All graph edges (for adjacency lookup) */
  edges: Array<{ source: string; target: string }>;
  /** Hover highlight configuration */
  config: HoverHighlightConfig;
  /** Function to compute base edge opacity (before highlighting) */
  computeEdgeOpacity: (d: SimLink) => number;
  /** Optional ID transform for embedding lookup (node -> embedding key) */
  nodeIdTransform?: (node: T) => string;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Adds hover highlighting behavior to a graph visualization.
 *
 * Usage:
 * ```tsx
 * useGraphHoverHighlight({
 *   svgRef,
 *   renderer,
 *   nodes,
 *   edges: mapEdges,
 *   config: { similarityThreshold: hoverRadius, baseDim },
 *   computeEdgeOpacity,
 *   nodeIdTransform: (n) => `kw:${n.label}`,
 * });
 * ```
 */
export function useGraphHoverHighlight<T extends SpatialNode & { embedding?: number[] }>(
  options: UseGraphHoverHighlightOptions<T>
): void {
  const {
    svgRef,
    renderer,
    nodes,
    edges,
    config,
    computeEdgeOpacity,
    nodeIdTransform,
  } = options;

  // Use refs to avoid stale closures in event handlers
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    if (!svgRef.current || !renderer) return;

    const svg = svgRef.current;
    const height = svg.clientHeight;
    const screenRadiusFraction = config.screenRadiusFraction ?? DEFAULT_HOVER_CONFIG.screenRadiusFraction!;

    // Capture renderer in local const for TypeScript narrowing
    const r = renderer;

    // Build lookups
    const adjacency = buildAdjacencyMap(edges);
    const embeddings = buildEmbeddingMap(nodes, nodeIdTransform);

    function applyHighlight(highlightedIds: Set<string> | null) {
      const { baseDim } = configRef.current;

      if (highlightedIds === null) {
        // Dim everything slightly (nothing nearby)
        const dim = 1 - baseDim;
        r.nodeSelection.select("circle").attr("opacity", dim);
        r.linkSelection.attr("stroke-opacity", (d) => computeEdgeOpacity(d) * dim);
      } else if (highlightedIds.size === 0) {
        // Restore full opacity (hover ended)
        r.nodeSelection.select("circle").attr("opacity", 1);
        r.linkSelection.attr("stroke-opacity", computeEdgeOpacity);
      } else {
        // Highlight selected, dim others
        r.nodeSelection.select("circle").attr("opacity", (d) =>
          highlightedIds.has(d.id) ? 1 : 0.15
        );
        r.linkSelection.attr("stroke-opacity", (d) => {
          const sourceId = typeof d.source === "string" ? d.source : d.source.id;
          const targetId = typeof d.target === "string" ? d.target : d.target.id;
          const bothHighlighted = highlightedIds.has(sourceId) && highlightedIds.has(targetId);
          return bothHighlighted ? computeEdgeOpacity(d) : 0.05;
        });
      }
    }

    const selection = d3.select(svg);

    selection
      .on("mousemove.hover", (event: MouseEvent) => {
        const [screenX, screenY] = d3.pointer(event, svg);
        const { similarityThreshold } = configRef.current;

        const result = spatialSemanticFilter({
          nodes,
          screenCenter: { x: screenX, y: screenY },
          screenRadius: height * screenRadiusFraction,
          transform: r.getTransform(),
          similarityThreshold,
          embeddings,
          adjacency,
        });

        if (result.spatialIds.size === 0) {
          applyHighlight(null);
        } else {
          applyHighlight(result.highlightedIds);
        }
      })
      .on("mouseleave.hover", () => {
        applyHighlight(new Set());
      });

    return () => {
      selection.on("mousemove.hover", null).on("mouseleave.hover", null);
    };
  }, [svgRef, renderer, nodes, edges, computeEdgeOpacity, nodeIdTransform, config.screenRadiusFraction]);
}
