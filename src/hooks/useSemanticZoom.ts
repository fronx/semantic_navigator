/**
 * React hook for managing semantic zoom state.
 *
 * Coordinates between zoom gestures, semantic filtering, and position persistence.
 * See docs/architecture/adr/008-semantic-zoom.md for design decisions.
 */

import { useState, useCallback, useRef, useMemo } from "react";
import type { SimNode, SimLink } from "@/lib/map-renderer";
import {
  computeFocalNodes,
  zoomToThreshold,
  zoomToEdgeOpacity,
  computeVisibleSetMulti,
  extendVisibleToConnected,
  getViewportBounds,
  type SemanticZoomConfig,
  type SemanticZoomMetrics,
  type Point,
  DEFAULT_CONFIG,
} from "@/lib/semantic-zoom";

// ============================================================================
// Types
// ============================================================================

export interface UseSemanticZoomOptions {
  /** All nodes in the graph */
  nodes: SimNode[];
  /** All edges in the graph */
  links: SimLink[];
  /** Whether semantic zoom is enabled */
  enabled: boolean;
  /** Configuration for zoom-to-threshold mapping */
  config?: Partial<SemanticZoomConfig>;
  /** Callback for performance metrics (debugging) */
  onMetrics?: (metrics: SemanticZoomMetrics) => void;
}

export interface UseSemanticZoomResult {
  /** Current set of visible node IDs */
  visibleIds: Set<string>;

  /** Current semantic centroid (null if not computed yet) */
  centroid: Float32Array | null;

  /** Current similarity threshold (0 = all visible) */
  threshold: number;

  /** Current edge opacity based on zoom level */
  edgeOpacity: number;

  /** Handle zoom end event - compute new filtering */
  onZoomEnd: (
    transform: { k: number; x: number; y: number },
    viewport: { width: number; height: number }
  ) => void;

  /** Store current positions for all visible nodes */
  storePositions: (nodes: SimNode[]) => void;

  /** Get stored position for a node (if it was visible before) */
  getStoredPosition: (nodeId: string) => Point | undefined;

  /** Get visible nodes (filtered view of all nodes) */
  getVisibleNodes: () => SimNode[];

  /** Get visible links (filtered view of all links) */
  getVisibleLinks: () => SimLink[];

  /** Reset semantic zoom state */
  reset: () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useSemanticZoom(
  options: UseSemanticZoomOptions
): UseSemanticZoomResult {
  const { nodes, links, enabled, config: configOverrides, onMetrics } = options;

  // Keep refs to latest values so callbacks don't have stale closures
  const nodesRef = useRef(nodes);
  const linksRef = useRef(links);
  nodesRef.current = nodes;
  linksRef.current = links;

  // Merge config with defaults
  const config = useMemo(
    () => ({ ...DEFAULT_CONFIG, ...configOverrides }),
    [configOverrides]
  );

  // State
  const [visibleIds, setVisibleIds] = useState<Set<string>>(() => {
    // Initially all nodes are visible
    return new Set(nodes.map((n) => n.id));
  });
  const [centroid, setCentroid] = useState<Float32Array | null>(null);
  const [threshold, setThreshold] = useState(0);
  const [edgeOpacity, setEdgeOpacity] = useState(0.3);

  // Refs for position persistence (don't need to trigger re-renders)
  const storedPositionsRef = useRef(new Map<string, Point>());
  const lastZoomScaleRef = useRef(1);

  // Store positions for nodes
  const storePositions = useCallback((nodesToStore: SimNode[]) => {
    for (const node of nodesToStore) {
      if (node.x !== undefined && node.y !== undefined) {
        storedPositionsRef.current.set(node.id, { x: node.x, y: node.y });
      }
    }
  }, []);

  // Get stored position
  const getStoredPosition = useCallback((nodeId: string): Point | undefined => {
    return storedPositionsRef.current.get(nodeId);
  }, []);

  // Handle zoom end - main entry point
  const onZoomEnd = useCallback(
    (
      transform: { k: number; x: number; y: number },
      viewport: { width: number; height: number }
    ) => {
      // Read from refs to get latest values (avoid stale closure)
      const currentNodes = nodesRef.current;
      const currentLinks = linksRef.current;

      if (!enabled) {
        // When disabled, show all nodes
        setVisibleIds(new Set(currentNodes.map((n) => n.id)));
        setThreshold(0);
        setEdgeOpacity(0.3);
        return;
      }

      const zoomScale = transform.k;
      lastZoomScaleRef.current = zoomScale;

      // Compute new threshold and edge opacity
      const newThreshold = zoomToThreshold(zoomScale, config);
      const newEdgeOpacity = zoomToEdgeOpacity(zoomScale);

      console.log("[SemanticZoom] onZoomEnd:", { zoomScale, newThreshold, nodeCount: currentNodes.length });

      setThreshold(newThreshold);
      setEdgeOpacity(newEdgeOpacity);

      // If threshold is 0, all nodes visible - skip centroid computation
      if (newThreshold <= 0) {
        setVisibleIds(new Set(currentNodes.map((n) => n.id)));
        setCentroid(null);
        return;
      }

      // Compute viewport bounds in graph coordinates
      const bounds = getViewportBounds(transform, viewport);

      // Screen center in graph coordinates
      const screenCenter: Point = {
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
      };

      // Focal radius: 20% of viewport diagonal in graph coordinates
      const viewportWidth = bounds.maxX - bounds.minX;
      const viewportHeight = bounds.maxY - bounds.minY;
      const focalRadius = Math.sqrt(viewportWidth ** 2 + viewportHeight ** 2) * 0.2;

      // Find focal nodes near screen center (multi-centroid approach)
      const focalEmbeddings = computeFocalNodes(currentNodes, bounds, screenCenter, focalRadius);

      if (!focalEmbeddings) {
        // No nodes with embeddings in viewport - keep previous state
        const nodesWithEmbeddings = currentNodes.filter(n => n.embedding);
        const nodesWithPositions = currentNodes.filter(n => n.x !== undefined && n.y !== undefined);
        console.log("[SemanticZoom] No focal nodes found:", {
          totalNodes: currentNodes.length,
          withEmbeddings: nodesWithEmbeddings.length,
          withPositions: nodesWithPositions.length,
          bounds,
          sampleNode: currentNodes[0] ? { id: currentNodes[0].id, x: currentNodes[0].x, y: currentNodes[0].y, hasEmbedding: !!currentNodes[0].embedding } : null,
        });
        return;
      }

      // Compute visible set using multi-centroid: visible if similar to ANY focal node
      let newVisible = computeVisibleSetMulti(currentNodes, focalEmbeddings, newThreshold);

      // Extend to include ALL connected neighbors of visible nodes
      // This ensures if a keyword is visible, its connected articles/chunks are too
      const edgesForExtend = currentLinks.map((l) => ({
        source: typeof l.source === "string" ? l.source : l.source.id,
        target: typeof l.target === "string" ? l.target : l.target.id,
      }));
      newVisible = extendVisibleToConnected(newVisible, currentNodes, edgesForExtend);

      // Ensure at least one node is visible
      if (newVisible.size === 0 && currentNodes.length > 0) {
        newVisible.add(currentNodes[0].id);
      }

      // Report metrics if callback provided
      if (onMetrics) {
        onMetrics({
          centroidComputeMs: 0,
          filterComputeMs: 0,
          totalMs: 0,
          visibleBefore: currentNodes.length,
          visibleAfter: newVisible.size,
        });
      }

      // Store positions of nodes that are becoming invisible
      const currentVisible = visibleIds;
      const nowInvisible = [...currentVisible].filter(
        (id) => !newVisible.has(id)
      );
      const nodesToStore = currentNodes.filter((n) => nowInvisible.includes(n.id));
      storePositions(nodesToStore);

      console.log("[SemanticZoom] Filtering:", currentNodes.length, "nodes ->", newVisible.size, "visible, focalNodes:", focalEmbeddings.length, "threshold:", newThreshold.toFixed(2), "zoom:", zoomScale.toFixed(2));
      setVisibleIds(newVisible);
    },
    [enabled, config, onMetrics, visibleIds, storePositions]
  );

  // Get visible nodes (derived, not stored)
  const getVisibleNodes = useCallback((): SimNode[] => {
    if (!enabled) return nodes;
    return nodes.filter((n) => visibleIds.has(n.id));
  }, [enabled, nodes, visibleIds]);

  // Get visible links (derived, not stored)
  const getVisibleLinks = useCallback((): SimLink[] => {
    if (!enabled) return links;
    return links.filter((l) => {
      const sourceId = typeof l.source === "string" ? l.source : l.source.id;
      const targetId = typeof l.target === "string" ? l.target : l.target.id;
      return visibleIds.has(sourceId) && visibleIds.has(targetId);
    });
  }, [enabled, links, visibleIds]);

  // Reset state
  const reset = useCallback(() => {
    setVisibleIds(new Set(nodes.map((n) => n.id)));
    setCentroid(null);
    setThreshold(0);
    setEdgeOpacity(0.3);
    storedPositionsRef.current.clear();
  }, [nodes]);

  // Update visible IDs when nodes change or semantic zoom is toggled
  // When enabled is toggled on, start with all nodes visible until a zoom event filters them
  useMemo(() => {
    if (nodes.length > 0) {
      setVisibleIds(new Set(nodes.map((n) => n.id)));
    }
  }, [nodes, enabled]);

  return {
    visibleIds,
    centroid,
    threshold,
    edgeOpacity,
    onZoomEnd,
    storePositions,
    getStoredPosition,
    getVisibleNodes,
    getVisibleLinks,
    reset,
  };
}
