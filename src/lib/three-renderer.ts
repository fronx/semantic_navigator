/**
 * Three.js/WebGL renderer for the map visualization.
 * Uses 3d-force-graph for rendering, implements same interface as map-renderer.
 */

import ForceGraph3DFactory from "3d-force-graph";
import type { SimNode, SimLink, HighlightConfig, ImmediateParams } from "./map-renderer";
import type { RendererCallbacks } from "./map-renderer";
import { communityColorScale } from "./hull-renderer";

// 3d-force-graph types are incomplete, define what we need
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ForceGraph3DInstance = any;

// ============================================================================
// Types
// ============================================================================

interface GraphNode {
  id: string;
  type: "article" | "keyword" | "chunk";
  label: string;
  communityId?: number;
  x?: number;
  y?: number;
  z?: number;
  fx?: number;
  fy?: number;
  fz?: number;
  // For highlight state
  __highlighted?: boolean;
  __opacity?: number;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  similarity?: number;
  // For highlight state
  __highlighted?: boolean;
}

export interface ThreeRenderer {
  /** Update node/link positions (call on each tick) - no-op for 3d-force-graph */
  tick: () => void;
  /** Update all visual attributes without relayout */
  updateVisuals: () => void;
  /** Update nodes and links dynamically */
  updateData: (newNodes: SimNode[], newLinks: SimLink[]) => void;
  /** Recompute cluster colors from current node properties */
  refreshClusters: () => void;
  /** Fit view to show all nodes */
  fitToNodes: (padding?: number, animate?: boolean) => void;
  /** Apply highlight/dim effect to nodes and links */
  applyHighlight: (config: HighlightConfig) => void;
  /** Get current camera transform (mapped to 2D-like k/x/y) */
  getTransform: () => { k: number; x: number; y: number };
  /** Get viewport dimensions */
  getViewport: () => { width: number; height: number };
  /** Get the underlying nodes */
  getNodes: () => SimNode[];
  /** Clean up resources */
  destroy: () => void;
}

interface ThreeRendererOptions {
  container: HTMLElement;
  nodes: SimNode[];
  links: SimLink[];
  immediateParams: { current: ImmediateParams };
  callbacks: RendererCallbacks;
}

// ============================================================================
// Implementation
// ============================================================================

export function createThreeRenderer(options: ThreeRendererOptions): ThreeRenderer {
  const { container, nodes: initialNodes, links: initialLinks, immediateParams, callbacks } = options;

  const width = container.clientWidth;
  const height = container.clientHeight;

  // Convert nodes/links to 3d-force-graph format
  let graphNodes: GraphNode[] = initialNodes.map((n) => ({
    id: n.id,
    type: n.type,
    label: n.label,
    communityId: n.communityId,
    x: n.x,
    y: n.y,
    z: 0, // Start in 2D plane
  }));

  let graphLinks: GraphLink[] = initialLinks.map((l) => ({
    source: typeof l.source === "string" ? l.source : l.source.id,
    target: typeof l.target === "string" ? l.target : l.target.id,
    similarity: l.similarity,
  }));

  // Create 3d-force-graph instance
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graph: ForceGraph3DInstance = (ForceGraph3DFactory as any)()(container)
    .width(width)
    .height(height)
    .backgroundColor("#ffffff00") // Transparent
    .showNavInfo(false)
    // Start in 2D mode for feature parity
    .numDimensions(2)
    // Node rendering
    .nodeVal((node: GraphNode) => {
      return node.type === "keyword" ? 4 : 10;
    })
    .nodeColor((node: GraphNode) => {
      if (node.communityId !== undefined) {
        return communityColorScale(String(node.communityId));
      }
      return node.type === "keyword" ? "#22c55e" : "#3b82f6";
    })
    .nodeOpacity(1)
    .nodeLabel((node: GraphNode) => node.label)
    // Link rendering
    .linkWidth(1.5)
    .linkOpacity(0.6)
    .linkColor(() => "#94a3b8")
    // Interactions
    .onNodeClick((node: GraphNode) => {
      if (node.type === "keyword" && callbacks.onKeywordClick) {
        callbacks.onKeywordClick(node.label);
      }
    })
    .onZoomEnd(() => {
      if (callbacks.onZoomEnd) {
        const camera = graph.camera();
        const distance = camera.position.z;
        // Map 3D camera distance to 2D-like zoom scale
        // Default distance is ~1000, map to k=1
        const k = 1000 / Math.max(distance, 100);
        callbacks.onZoomEnd(
          { k, x: camera.position.x, y: camera.position.y },
          { width, height }
        );
      }
    })
    // Initial data
    .graphData({ nodes: graphNodes, links: graphLinks });

  // Constrain to 2D view (looking down Z axis)
  const camera = graph.camera();
  camera.position.set(0, 0, 1000);
  camera.lookAt(0, 0, 0);

  // Disable rotation, enable only pan and zoom
  const controls = graph.controls();
  if (controls && typeof controls.enableRotate !== "undefined") {
    controls.enableRotate = false;
  }

  // Track current highlight state for reactive rendering
  let highlightState: {
    highlightedIds: Set<string> | null;
    baseDim: number;
    computeLinkOpacity: (similarity: number) => number;
  } = {
    highlightedIds: new Set(), // Empty = show all
    baseDim: 0,
    computeLinkOpacity: () => 0.6,
  };

  // ========================================================================
  // Interface implementation
  // ========================================================================

  function tick() {
    // No-op: 3d-force-graph handles its own animation loop
  }

  function updateVisuals() {
    // Re-render with current visual params
    // Trigger re-render by re-setting nodeRelSize
    graph.nodeRelSize(graph.nodeRelSize());
  }

  function updateData(newNodes: SimNode[], newLinks: SimLink[]) {
    graphNodes = newNodes.map((n) => ({
      id: n.id,
      type: n.type,
      label: n.label,
      communityId: n.communityId,
      x: n.x,
      y: n.y,
      z: 0,
    }));

    graphLinks = newLinks.map((l) => ({
      source: typeof l.source === "string" ? l.source : l.source.id,
      target: typeof l.target === "string" ? l.target : l.target.id,
      similarity: l.similarity,
    }));

    graph.graphData({ nodes: graphNodes, links: graphLinks });
  }

  function refreshClusters() {
    // Force re-render of node colors
    graph.nodeColor(graph.nodeColor());
  }

  function fitToNodes(padding = 0.2, animate = true) {
    const duration = animate ? 300 : 0;
    graph.zoomToFit(duration, padding * Math.min(width, height));
  }

  function applyHighlight(config: HighlightConfig) {
    // Update highlight state
    highlightState = {
      highlightedIds: config.highlightedIds,
      baseDim: config.baseDim,
      computeLinkOpacity: config.computeLinkOpacity,
    };

    // Update node materials directly for performance
    // 3d-force-graph stores node meshes with __threeObj property
    const { highlightedIds, baseDim } = highlightState;

    graphNodes.forEach((node) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const threeObj = (node as any).__threeObj;
      if (!threeObj?.material) return;

      let opacity = 1;
      if (highlightedIds === null) {
        opacity = 1 - baseDim;
      } else if (highlightedIds.size === 0) {
        opacity = 1;
      } else {
        opacity = highlightedIds.has(node.id) ? 1 : 0.15;
      }

      threeObj.material.opacity = opacity;
      threeObj.material.transparent = opacity < 1;
    });

    // Update link materials
    graphLinks.forEach((link) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const threeObj = (link as any).__lineObj;
      if (!threeObj?.material) return;

      const sourceId = typeof link.source === "string" ? link.source : link.source.id;
      const targetId = typeof link.target === "string" ? link.target : link.target.id;
      const baseLinkOpacity = highlightState.computeLinkOpacity(link.similarity ?? 0.5);

      let opacity = baseLinkOpacity;
      if (highlightedIds === null) {
        opacity = baseLinkOpacity * (1 - baseDim);
      } else if (highlightedIds.size === 0) {
        opacity = baseLinkOpacity;
      } else {
        const bothHighlighted = highlightedIds.has(sourceId) && highlightedIds.has(targetId);
        opacity = bothHighlighted ? baseLinkOpacity : 0.05;
      }

      threeObj.material.opacity = opacity;
      threeObj.material.transparent = opacity < 1;
    });
  }

  function getTransform() {
    const camera = graph.camera();
    const distance = camera.position.z;
    const k = 1000 / Math.max(distance, 100);
    return { k, x: camera.position.x, y: camera.position.y };
  }

  function getViewport() {
    return { width, height };
  }

  function getNodes(): SimNode[] {
    // Convert back to SimNode format
    return graphNodes.map((n) => ({
      id: n.id,
      type: n.type,
      label: n.label,
      communityId: n.communityId,
      x: n.x,
      y: n.y,
    })) as SimNode[];
  }

  function destroy() {
    graph._destructor?.();
    container.innerHTML = "";
  }

  return {
    tick,
    updateVisuals,
    updateData,
    refreshClusters,
    fitToNodes,
    applyHighlight,
    getTransform,
    getViewport,
    getNodes,
    destroy,
  };
}
