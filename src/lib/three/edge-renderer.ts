/**
 * Edge renderer for the Three.js graph visualization.
 * Handles curve rendering (bezier and arc), link caching, and highlighting.
 */

import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { blendColors, dimColor, colors } from "@/lib/colors";
import type { SimNode, SimLink, ImmediateParams } from "@/lib/map-renderer";
import type { PCATransform, ClusterColorInfo } from "@/lib/semantic-colors";
import { getNodeColor, getRenderOrder } from "./node-renderer";

// ============================================================================
// Constants
// ============================================================================

/** Number of segments for arc geometry (more = smoother curves) */
const ARC_SEGMENTS = 20;

// ============================================================================
// Edge color helper
// ============================================================================

export function getEdgeColor(
  link: SimLink,
  nodeMap: Map<string, SimNode>,
  pcaTransform?: PCATransform,
  clusterColors?: Map<number, ClusterColorInfo>,
  colorMixRatio: number = 0
): string {
  const sourceId = typeof link.source === "string" ? link.source : link.source.id;
  const targetId = typeof link.target === "string" ? link.target : link.target.id;

  const sourceNode = nodeMap.get(sourceId);
  const targetNode = nodeMap.get(targetId);

  if (!sourceNode || !targetNode) {
    return "#888888";
  }

  const sourceColor = getNodeColor(sourceNode, pcaTransform, clusterColors, colorMixRatio);
  const targetColor = getNodeColor(targetNode, pcaTransform, clusterColors, colorMixRatio);

  return blendColors(sourceColor, targetColor);
}

// ============================================================================
// Edge Renderer
// ============================================================================

export interface EdgeRendererOptions {
  container: HTMLElement;
  immediateParams: { current: ImmediateParams };
  pcaTransform?: PCATransform;
  /** Get current node map for edge coloring */
  getNodeMap: () => Map<string, SimNode>;
  /** Get current cluster colors */
  getClusterColors: () => Map<number, ClusterColorInfo>;
  /** Get curve direction for a link (-1 or 1) */
  getCurveDirection: (link: SimLink) => number;
}

export interface EdgeRenderer {
  /** Create a Line2 object for a link (called by graph.linkThreeObject for arc mode) */
  createLinkObject(link: SimLink): Line2;
  /** Update link position (called by graph.linkPositionUpdate for arc mode) */
  updateLinkPosition(
    line: Line2,
    coords: { start: { x: number; y: number }; end: { x: number; y: number } },
    link: SimLink
  ): boolean;
  /** Get edge color for a link (used by both arc and bezier modes) */
  getColor(link: SimLink): string;
  /** Update highlight state for all cached edges */
  updateHighlight(highlightedIds: Set<string> | null, baseDim: number): void;
  /** Refresh all edge colors (e.g., when colorMixRatio changes) */
  refreshColors(): void;
  /** Dispose all cached line objects */
  dispose(): void;
}

export function createEdgeRenderer(options: EdgeRendererOptions): EdgeRenderer {
  const {
    container,
    immediateParams,
    pcaTransform,
    getNodeMap,
    getClusterColors,
    getCurveDirection,
  } = options;

  // Cache for link Line2 objects (for arc mode)
  const linkCache = new Map<string, Line2>();

  // Cache for original edge colors (for dimming)
  const edgeColorCache = new Map<string, string>();

  // Current highlight state
  let currentHighlight: Set<string> | null = null;
  let currentBaseDim = 0.3;

  function getBackgroundColor(): string {
    const isDarkMode = window.matchMedia("(prefers-color-scheme: dark)").matches;
    return isDarkMode ? colors.background.dark : colors.background.light;
  }

  function getLinkKey(link: SimLink): string {
    const sourceId = typeof link.source === "string" ? link.source : link.source.id;
    const targetId = typeof link.target === "string" ? link.target : link.target.id;
    return `${sourceId}->${targetId}`;
  }

  function getColor(link: SimLink): string {
    const nodeMap = getNodeMap();
    const clusterColors = getClusterColors();
    return getEdgeColor(link, nodeMap, pcaTransform, clusterColors, immediateParams.current.colorMixRatio);
  }

  function createLinkObject(link: SimLink): Line2 {
    const key = getLinkKey(link);
    const edgeColor = getColor(link);

    // Check cache first
    const cached = linkCache.get(key);
    if (cached) {
      // Update color and opacity in case they changed
      const mat = cached.material as LineMaterial;
      mat.color.set(edgeColor);
      mat.opacity = immediateParams.current.edgeOpacity * 0.4;
      mat.needsUpdate = true;
      return cached;
    }

    // Create fat line geometry with initial positions
    const rect = container.getBoundingClientRect();
    const geometry = new LineGeometry();
    const initialPositions = new Float32Array((ARC_SEGMENTS + 1) * 3);
    geometry.setPositions(initialPositions);

    const material = new LineMaterial({
      color: new THREE.Color(edgeColor).getHex(),
      linewidth: 2,
      transparent: true,
      opacity: immediateParams.current.edgeOpacity * 0.4,
      resolution: new THREE.Vector2(rect.width, rect.height),
      worldUnits: true,
      alphaToCoverage: true,
      depthTest: false,
    });

    const line = new Line2(geometry, material);
    line.computeLineDistances();
    // Assign unique renderOrder to prevent z-fighting
    line.renderOrder = getRenderOrder("edges", linkCache.size);
    // Disable frustum culling - bounding box isn't updated when we modify buffer directly
    line.frustumCulled = false;

    linkCache.set(key, line);
    edgeColorCache.set(key, edgeColor);
    return line;
  }

  function updateLinkPosition(
    line: Line2,
    coords: { start: { x: number; y: number }; end: { x: number; y: number } },
    link: SimLink
  ): boolean {
    const direction = getCurveDirection(link);
    const curveIntensity = immediateParams.current.edgeCurve;

    const geometry = line.geometry as LineGeometry;
    const instanceStart = geometry.attributes.instanceStart;
    if (!instanceStart) return false;

    // Get the underlying interleaved buffer array
    const data = (instanceStart as THREE.InterleavedBufferAttribute).data;
    const array = data.array as Float32Array;

    const { x: x1, y: y1 } = coords.start;
    const { x: x2, y: y2 } = coords.end;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const chordLength = Math.sqrt(dx * dx + dy * dy);

    // Compute arc points and write as line segments into the interleaved buffer
    if (curveIntensity === 0 || chordLength === 0 || Math.abs(chordLength * curveIntensity) < 0.1) {
      // Straight line - linear interpolation
      for (let i = 0; i < ARC_SEGMENTS; i++) {
        const t0 = i / ARC_SEGMENTS;
        const t1 = (i + 1) / ARC_SEGMENTS;
        const idx = i * 6;
        array[idx] = x1 + t0 * dx;
        array[idx + 1] = y1 + t0 * dy;
        array[idx + 2] = 0;
        array[idx + 3] = x1 + t1 * dx;
        array[idx + 4] = y1 + t1 * dy;
        array[idx + 5] = 0;
      }
    } else {
      // Curved arc
      const sagitta = chordLength * curveIntensity * direction;
      const absSagitta = Math.abs(sagitta);
      const radius = (chordLength * chordLength / 4 + absSagitta * absSagitta) / (2 * absSagitta);

      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const perpX = -dy / chordLength;
      const perpY = dx / chordLength;

      const centerOffset = radius - absSagitta;
      const sign = sagitta > 0 ? -1 : 1;
      const cx = mx + sign * centerOffset * perpX;
      const cy = my + sign * centerOffset * perpY;

      const startAngle = Math.atan2(y1 - cy, x1 - cx);
      const endAngle = Math.atan2(y2 - cy, x2 - cx);

      let angleDiff = endAngle - startAngle;
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

      for (let i = 0; i < ARC_SEGMENTS; i++) {
        const t0 = i / ARC_SEGMENTS;
        const t1 = (i + 1) / ARC_SEGMENTS;
        const angle0 = startAngle + t0 * angleDiff;
        const angle1 = startAngle + t1 * angleDiff;
        const idx = i * 6;
        array[idx] = cx + radius * Math.cos(angle0);
        array[idx + 1] = cy + radius * Math.sin(angle0);
        array[idx + 2] = 0;
        array[idx + 3] = cx + radius * Math.cos(angle1);
        array[idx + 4] = cy + radius * Math.sin(angle1);
        array[idx + 5] = 0;
      }
    }

    // Mark buffer as needing GPU upload
    data.needsUpdate = true;
    line.computeLineDistances();

    return true;
  }

  function updateHighlight(highlightedIds: Set<string> | null, baseDim: number): void {
    currentHighlight = highlightedIds;
    currentBaseDim = baseDim;

    const backgroundColor = getBackgroundColor();

    for (const [linkKey, linkObj] of linkCache) {
      const originalColor = edgeColorCache.get(linkKey);
      if (!originalColor) continue;

      // Parse linkKey to get source and target IDs
      const [sourceId, targetId] = linkKey.split("->");
      const bothHighlighted = (highlightedIds?.has(sourceId) ?? false) && (highlightedIds?.has(targetId) ?? false);

      // Edges are "highlighted" only if both endpoints are
      const dimAmount = highlightedIds === null ? currentBaseDim :
                        highlightedIds.size > 0 ? (bothHighlighted ? 0 : currentBaseDim) :
                        0;

      const mat = linkObj.material as LineMaterial;
      const dimmedColor = dimAmount > 0 ? dimColor(originalColor, dimAmount, backgroundColor) : originalColor;
      mat.color.set(dimmedColor);
      mat.needsUpdate = true;
    }
  }

  function refreshColors(): void {
    const nodeMap = getNodeMap();
    const clusterColors = getClusterColors();
    const colorMixRatio = immediateParams.current.colorMixRatio;

    for (const [key, linkObj] of linkCache) {
      // Parse key to reconstruct a minimal link for color calculation
      const [sourceId, targetId] = key.split("->");
      const link = { source: sourceId, target: targetId } as SimLink;

      const newColor = getEdgeColor(link, nodeMap, pcaTransform, clusterColors, colorMixRatio);
      edgeColorCache.set(key, newColor);

      const mat = linkObj.material as LineMaterial;
      mat.color.set(newColor);
      mat.needsUpdate = true;
    }
  }

  function dispose(): void {
    for (const line of linkCache.values()) {
      line.geometry.dispose();
      line.material.dispose();
    }
    linkCache.clear();
    edgeColorCache.clear();
  }

  return {
    createLinkObject,
    updateLinkPosition,
    getColor,
    updateHighlight,
    refreshColors,
    dispose,
  };
}
