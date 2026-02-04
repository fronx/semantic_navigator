/**
 * Node renderer for the Three.js graph visualization.
 * Handles mesh creation, caching, colors, and highlighting.
 */

import * as THREE from "three";
import { communityColorScale, groupNodesByCommunity } from "@/lib/hull-renderer";
import { dimColor } from "@/lib/colors";
import { getBackgroundColor } from "@/lib/theme";
import type { SimNode, ImmediateParams } from "@/lib/map-renderer";
import {
  pcaProject,
  coordinatesToHSL,
  computeClusterColors,
  nodeColorFromCluster,
  type PCATransform,
  type ClusterColorInfo,
} from "@/lib/semantic-colors";

// ============================================================================
// Constants
// ============================================================================

/** Base radius for keyword dots (before dotScale is applied) */
export const BASE_DOT_RADIUS = 4;

/** Scale factor applied to dots for better visibility */
export const DOT_SCALE_FACTOR = 2.5;

/** Number of segments for circle geometry (higher = smoother circles) */
const CIRCLE_SEGMENTS = 64;

/** Project node color - distinct purple/violet */
const PROJECT_COLOR = "#8b5cf6";

/** Outline color for all nodes */
const OUTLINE_COLOR = "#ffffff";

/**
 * Render layer ordering for Three.js objects.
 * Items render in array order (later = on top).
 */
const RENDER_LAYERS = ["edges", "nodes"] as const;
type RenderLayer = (typeof RENDER_LAYERS)[number];
const LAYER_SPACING = 10000;

export const KEYWORD_LAYER = 2;
export const CHUNK_LAYER = 3;
export const PANEL_LAYER = 4;

export function getRenderOrder(layer: RenderLayer, offset = 0): number {
  return RENDER_LAYERS.indexOf(layer) * LAYER_SPACING + offset;
}

// ============================================================================
// Color helpers
// ============================================================================

export function getNodeColor(
  node: SimNode,
  pcaTransform?: PCATransform,
  clusterColors?: Map<number, ClusterColorInfo>,
  colorMixRatio: number = 0,
  getParentNode?: (nodeId: string) => SimNode | undefined
): string {
  // Projects have a distinct purple color
  if (node.type === "project") {
    return PROJECT_COLOR;
  }

  // Chunks inherit parent keyword color (no dimming)
  if (node.type === "chunk" && getParentNode) {
    const chunkNode = node as SimNode & { parentId?: string };
    if (chunkNode.parentId) {
      const parent = getParentNode(chunkNode.parentId);
      if (parent) {
        // Recursively get parent's color (without passing getParentNode to avoid infinite loops)
        return getNodeColor(parent, pcaTransform, clusterColors, colorMixRatio);
      }
    }
  }

  // Use embedding-based colors if available (PCA projection or cluster-based)
  if (pcaTransform && node.embedding && node.embedding.length > 0) {
    // Try cluster-based color if communityId exists
    if (node.communityId !== undefined && clusterColors) {
      const clusterInfo = clusterColors.get(node.communityId);
      if (clusterInfo) {
        return nodeColorFromCluster(node.embedding, clusterInfo, pcaTransform, colorMixRatio);
      }
    }
    // Fallback: PCA-based semantic color from embedding
    const [x, y] = pcaProject(node.embedding, pcaTransform);
    return coordinatesToHSL(x, y);
  }

  // Fall back to community-based coloring
  if (node.communityId !== undefined) {
    return communityColorScale(String(node.communityId));
  }
  return "#9ca3af"; // grey-400 for unclustered
}

export function getNodeRadius(node: SimNode, dotScale: number, scale: number = 1.0): number {
  // Projects are larger than keywords
  if (node.type === "project") {
    return 7 * dotScale * scale; // Larger base radius for projects
  }
  // Chunks are slightly smaller than keywords
  const baseRadius = node.type === "chunk" ? BASE_DOT_RADIUS * 0.8 : BASE_DOT_RADIUS;
  return baseRadius * dotScale * scale;
}

// ============================================================================
// Node Renderer
// ============================================================================

export interface NodeRendererOptions {
  immediateParams: { current: ImmediateParams };
  pcaTransform?: PCATransform;
  /** Get current cluster colors (computed externally and may change) */
  getClusterColors: () => Map<number, ClusterColorInfo>;
  /** Get node by ID (used for chunk parent lookup) */
  getNodeById?: (nodeId: string) => SimNode | undefined;
}

export interface ScaleValues {
  keywordScale: number;
  chunkScale: number;
}

export interface NodeRenderer {
  /** Create a Three.js mesh for a node (called by graph.nodeThreeObject) */
  createNodeMesh(node: SimNode): THREE.Group;
  /** Get the computed radius for a node (for external use) */
  getRadius(node: SimNode): number;
  /** Update highlight state for all cached nodes */
  updateHighlight(highlightedIds: Set<string> | null, baseDim: number): void;
  /** Refresh all node colors from current state */
  refreshColors(nodes: SimNode[]): void;
  /** Update cluster assignments and recompute colors */
  updateClusters(nodes: SimNode[], nodeToCluster: Map<string, number>): Map<number, ClusterColorInfo>;
  /** Update node scales based on camera zoom (for keyword/chunk transition) */
  updateNodeScales(scales: ScaleValues): void;
  /** Dispose all cached meshes and materials */
  dispose(): void;
}

interface NodeMeshGroup {
  group: THREE.Group;
  fill: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  outline: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  node: SimNode; // Store node reference for type checking and updates
}

export function createNodeRenderer(options: NodeRendererOptions): NodeRenderer {
  const { immediateParams, pcaTransform, getClusterColors, getNodeById } = options;

  // Cache for node meshes to avoid recreating on every update
  const nodeCache = new Map<string, NodeMeshGroup>();

  // Cache for original node colors (for dimming via color mixing)
  const nodeColorCache = new Map<string, string>();

  // Current highlight state
  let currentHighlight: Set<string> | null = null;
  let currentBaseDim = 0.3;

  function getNodeDimAmount(nodeId: string): number {
    if (currentHighlight === null) {
      return currentBaseDim;
    } else if (currentHighlight.size > 0) {
      return currentHighlight.has(nodeId) ? 0 : currentBaseDim;
    }
    return 0;
  }

  function updateNodeMeshColors(
    cached: NodeMeshGroup,
    originalFillColor: string,
    dimAmount: number,
    backgroundColor: string
  ): void {
    const dimmedFillColor = dimAmount > 0 ? dimColor(originalFillColor, dimAmount, backgroundColor) : originalFillColor;
    cached.fill.material.color.set(dimmedFillColor);

    const dimmedOutlineColor = dimAmount > 0 ? dimColor(OUTLINE_COLOR, dimAmount, backgroundColor) : OUTLINE_COLOR;
    cached.outline.material.color.set(dimmedOutlineColor);
  }

  function createNodeMesh(node: SimNode): THREE.Group {
    const clusterColors = getClusterColors();

    // Check cache first
    const cached = nodeCache.get(node.id);
    if (cached) {
      // Update existing mesh properties with color-based dimming
      const originalFillColor = getNodeColor(node, pcaTransform, clusterColors, immediateParams.current.colorMixRatio, getNodeById);
      nodeColorCache.set(node.id, originalFillColor);
      updateNodeMeshColors(cached, originalFillColor, getNodeDimAmount(node.id), getBackgroundColor());
      return cached.group;
    }

    // Create new group with outline and fill
    const radius = getNodeRadius(node, immediateParams.current.dotScale) * DOT_SCALE_FACTOR;
    const strokeWidth = (node.type === "project" ? 3 : 1.5) * DOT_SCALE_FACTOR * 0.3;

    // Store original fill color and compute dimmed colors
    const originalFillColor = getNodeColor(node, pcaTransform, clusterColors, immediateParams.current.colorMixRatio, getNodeById);
    nodeColorCache.set(node.id, originalFillColor);

    const dimAmount = getNodeDimAmount(node.id);
    const backgroundColor = getBackgroundColor();
    const dimmedFillColor = dimAmount > 0 ? dimColor(originalFillColor, dimAmount, backgroundColor) : originalFillColor;
    const dimmedOutlineColor = dimAmount > 0 ? dimColor(OUTLINE_COLOR, dimAmount, backgroundColor) : OUTLINE_COLOR;

    // Create outline ring (white stroke) - positioned behind the fill
    const outlineGeometry = new THREE.RingGeometry(radius, radius + strokeWidth, CIRCLE_SEGMENTS);
    const outlineMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(dimmedOutlineColor),
      transparent: true,
      depthTest: false,
    });
    const outlineMesh = new THREE.Mesh(outlineGeometry, outlineMaterial);

    // Create fill circle
    const fillGeometry = new THREE.CircleGeometry(radius, CIRCLE_SEGMENTS);
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(dimmedFillColor),
      transparent: true,
      depthTest: false,
    });
    const fillMesh = new THREE.Mesh(fillGeometry, fillMaterial);

    // Group both meshes
    const group = new THREE.Group();
    group.add(outlineMesh);
    group.add(fillMesh);
    const isChunk = node.type === "chunk";
    group.renderOrder = getRenderOrder("nodes", isChunk ? LAYER_SPACING / 2 : 0);

    // Set Z position for chunk nodes (behind keyword layer)
    const chunkNode = node as SimNode & { z?: number };
    if (isChunk && chunkNode.z !== undefined) {
      group.position.z = chunkNode.z;
    }

    nodeCache.set(node.id, { group, fill: fillMesh, outline: outlineMesh, node });
    return group;
  }

  function getRadius(node: SimNode): number {
    return getNodeRadius(node, immediateParams.current.dotScale) * DOT_SCALE_FACTOR;
  }

  function updateHighlight(highlightedIds: Set<string> | null, baseDim: number): void {
    currentHighlight = highlightedIds;
    currentBaseDim = baseDim;

    const backgroundColor = getBackgroundColor();

    for (const [nodeId, cached] of nodeCache) {
      const originalFillColor = nodeColorCache.get(nodeId);
      if (!originalFillColor) continue;
      updateNodeMeshColors(cached, originalFillColor, getNodeDimAmount(nodeId), backgroundColor);
    }
  }

  function refreshColors(nodes: SimNode[]): void {
    const backgroundColor = getBackgroundColor();
    const clusterColors = getClusterColors();

    for (const node of nodes) {
      const cached = nodeCache.get(node.id);
      if (!cached) continue;

      const originalColor = getNodeColor(node, pcaTransform, clusterColors, immediateParams.current.colorMixRatio, getNodeById);
      nodeColorCache.set(node.id, originalColor);
      updateNodeMeshColors(cached, originalColor, getNodeDimAmount(node.id), backgroundColor);
    }
  }

  function updateClusters(nodes: SimNode[], nodeToCluster: Map<string, number>): Map<number, ClusterColorInfo> {
    // Update communityId on each node
    for (const node of nodes) {
      const clusterId = nodeToCluster.get(node.id);
      node.communityId = clusterId;
    }

    // Recompute and return cluster colors
    return computeClusterColors(groupNodesByCommunity(nodes), pcaTransform);
  }

  function updateNodeScales(scales: ScaleValues): void {
    // Visibility threshold: nodes smaller than 1% are invisible, so skip rendering
    const VISIBILITY_THRESHOLD = 0.01;

    let keywordCount = 0, chunkCount = 0;
    let keywordVisible = 0, chunkVisible = 0;

    for (const cached of nodeCache.values()) {
      const { node, group } = cached;

      // Apply scale based on node type
      if (node.type === "keyword") {
        keywordCount++;
        group.scale.setScalar(scales.keywordScale);
        // Cull keywords when too small (optimization)
        group.visible = scales.keywordScale >= VISIBILITY_THRESHOLD;
        if (group.visible) keywordVisible++;
      } else if (node.type === "chunk") {
        chunkCount++;
        group.scale.setScalar(scales.chunkScale);
        // Cull chunks when too small (saves ~0.5-1ms per frame when zoomed out)
        group.visible = scales.chunkScale >= VISIBILITY_THRESHOLD;
        if (group.visible) chunkVisible++;
      }
      // Projects and articles don't scale (they're always visible)
    }

    // Debug: log visibility state occasionally
    if (Math.random() < 0.1) {
      console.log('[Node Visibility]',
        'Keywords:', keywordVisible, '/', keywordCount,
        'Chunks:', chunkVisible, '/', chunkCount,
        'Scales:', 'kw=' + scales.keywordScale.toFixed(3), 'ch=' + scales.chunkScale.toFixed(3));
    }
  }

  function dispose(): void {
    for (const { fill, outline } of nodeCache.values()) {
      fill.geometry.dispose();
      fill.material.dispose();
      outline.geometry.dispose();
      outline.material.dispose();
    }
    nodeCache.clear();
    nodeColorCache.clear();
  }

  return {
    createNodeMesh,
    getRadius,
    updateHighlight,
    refreshColors,
    updateClusters,
    updateNodeScales,
    dispose,
  };
}
