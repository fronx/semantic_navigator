/**
 * Renderer-agnostic interface for graph visualization.
 * Both D3/SVG and Three.js renderers implement this interface.
 */

import type { SimNode, SimLink } from "./map-renderer";

/**
 * Highlight configuration for nodes and links.
 */
export interface HighlightConfig {
  /** Set of node IDs to highlight. null = dim all, empty = restore all */
  highlightedIds: Set<string> | null;
  /** Base dim amount for non-highlighted elements (0-1) */
  baseDim: number;
  /** Optional function to compute link opacity based on similarity */
  computeLinkOpacity?: (similarity: number) => number;
}

/**
 * Visual parameters that can be updated without relayout.
 */
export interface VisualParams {
  dotScale: number;
  edgeOpacity: number;
  hullOpacity: number;
  edgeCurve: number;
  curveMethod: "outward" | "angular" | "hybrid";
}

/**
 * Callbacks for user interactions.
 */
export interface RendererCallbacks {
  onNodeExpand?: (graphNodeId: string, dbNodeId: string) => void;
  onKeywordClick?: (keyword: string) => void;
  onZoomEnd?: (transform: { k: number; x: number; y: number }, viewport: { width: number; height: number }) => void;
}

/**
 * Renderer-agnostic interface for graph visualization.
 * Implementations: D3Renderer (SVG), ThreeRenderer (WebGL)
 */
export interface GraphRenderer {
  /** Update node/link positions (call on each simulation tick) */
  tick: () => void;

  /** Update visual attributes without relayout (reads from params ref) */
  updateVisuals: () => void;

  /** Update nodes and links dynamically */
  updateData: (newNodes: SimNode[], newLinks: SimLink[]) => void;

  /** Recompute cluster colors and communities from current node properties */
  refreshClusters: () => void;

  /** Fit view to show all current nodes with padding */
  fitToNodes: (padding?: number, animate?: boolean) => void;

  /** Apply highlight/dim effect to nodes and links */
  applyHighlight: (config: HighlightConfig) => void;

  /** Get current zoom/camera transform */
  getTransform: () => { k: number; x: number; y: number };

  /** Get viewport dimensions */
  getViewport: () => { width: number; height: number };

  /** Get the underlying nodes (for hover calculations) */
  getNodes: () => SimNode[];

  /** Clean up resources */
  destroy: () => void;
}

/**
 * Options for creating a graph renderer.
 */
export interface GraphRendererOptions {
  /** Container element */
  container: HTMLElement;
  /** Initial nodes */
  nodes: SimNode[];
  /** Initial links */
  links: SimLink[];
  /** Visual parameters ref (mutable) */
  paramsRef: { current: VisualParams };
  /** Whether to fit layout to container */
  fit?: boolean;
  /** Callbacks for user interactions */
  callbacks: RendererCallbacks;
}

/**
 * Factory type for creating renderers.
 */
export type CreateRenderer = (options: GraphRendererOptions) => GraphRenderer;
