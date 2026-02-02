/**
 * HTML label overlay management for Three.js renderer.
 * Handles DOM-based labels positioned over the WebGL canvas.
 */

import type { SimNode } from "./map-renderer";
import { computeClusterLabels } from "./cluster-labels";
import { communityColorScale } from "./hull-renderer";
import { clusterColorToCSS, type ClusterColorInfo } from "./semantic-colors";

// ============================================================================
// Types
// ============================================================================

export interface LabelOverlayManager {
  /** Update cluster labels based on current node positions */
  updateClusterLabels: (nodes: SimNode[]) => void;
  /** Update keyword labels based on zoom and node degree */
  updateKeywordLabels: (nodes: SimNode[], nodeDegrees: Map<string, number>) => void;
  /** Clean up all DOM elements */
  destroy: () => void;
}

export interface LabelOverlayOptions {
  container: HTMLElement;
  /** Function to convert world coordinates to screen coordinates */
  worldToScreen: (world: { x: number; y: number }) => { x: number; y: number } | null;
  /** Function to get current camera Z position (for zoom-based visibility) */
  getCameraZ: () => number;
  /** Function to get node radius in world units */
  getNodeRadius: (node: SimNode) => number;
  /** Function to get current cluster colors (for label coloring) */
  getClusterColors: () => Map<number, ClusterColorInfo>;
}

// ============================================================================
// Constants
// ============================================================================

// Zoom thresholds for keyword label visibility (in camera Z units)
// Adjusted for 10° FOV (3x higher than 30° FOV values due to increased camera distance)
const KEYWORD_ZOOM_START = 5000; // Start showing labels when zooming in past this
const KEYWORD_ZOOM_ALL = 1200;    // Show all labels when zoomed in past this

// ============================================================================
// Factory
// ============================================================================

export function createLabelOverlayManager(options: LabelOverlayOptions): LabelOverlayManager {
  const { container, worldToScreen, getCameraZ, getNodeRadius, getClusterColors } = options;

  // Create overlay for cluster labels
  const clusterOverlay = document.createElement("div");
  clusterOverlay.className = "graph-label-overlay";
  container.appendChild(clusterOverlay);

  // Create overlay for keyword labels (z-index above cluster labels)
  const keywordOverlay = document.createElement("div");
  keywordOverlay.className = "graph-label-overlay";
  keywordOverlay.style.zIndex = "1";
  container.appendChild(keywordOverlay);

  // Caches for DOM elements
  const clusterLabelCache = new Map<number, HTMLDivElement>();
  const keywordLabelCache = new Map<string, HTMLDivElement>();

  function updateClusterLabels(nodes: SimNode[]) {
    const rect = container.getBoundingClientRect();
    const clusterColors = getClusterColors();

    // Compute labels from current node positions
    const labelData = computeClusterLabels({
      nodes,
      getColor: (communityId) => {
        // Use cluster color info if available (same as node colors)
        const info = clusterColors.get(communityId);
        if (info) {
          return clusterColorToCSS(info);
        }
        // Fallback to legacy color scale
        return communityColorScale(String(communityId));
      },
    });

    // Track which communities we've seen (for cleanup)
    const seenCommunities = new Set<number>();

    for (const data of labelData) {
      seenCommunities.add(data.communityId);

      // Convert centroid to screen coordinates
      const screenPos = worldToScreen({ x: data.centroid[0], y: data.centroid[1] });
      if (!screenPos) continue;

      // Skip if off-screen (with some padding)
      if (screenPos.x < -100 || screenPos.x > rect.width + 100 ||
          screenPos.y < -100 || screenPos.y > rect.height + 100) {
        // Hide existing label if off-screen
        const existing = clusterLabelCache.get(data.communityId);
        if (existing) existing.style.display = "none";
        continue;
      }

      // Get or create label element
      let labelEl = clusterLabelCache.get(data.communityId);
      if (!labelEl) {
        labelEl = document.createElement("div");
        labelEl.className = "cluster-label";
        clusterOverlay.appendChild(labelEl);
        clusterLabelCache.set(data.communityId, labelEl);
      }

      // Update label content and position
      labelEl.style.display = "block";
      labelEl.style.left = `${screenPos.x}px`;
      labelEl.style.top = `${screenPos.y}px`;
      labelEl.style.color = data.color;
      labelEl.style.opacity = String(Math.max(0.2, data.visibilityRatio) * 0.7);

      // Split label into words for multi-line display
      if (labelEl.textContent !== data.label) {
        labelEl.textContent = data.label.split(/\s+/).join("\n");
      }
    }

    // Remove labels for communities that no longer exist
    for (const [communityId, labelEl] of clusterLabelCache) {
      if (!seenCommunities.has(communityId)) {
        labelEl.remove();
        clusterLabelCache.delete(communityId);
      }
    }
  }

  function updateKeywordLabels(nodes: SimNode[], nodeDegrees: Map<string, number>) {
    const rect = container.getBoundingClientRect();
    const cameraZ = getCameraZ();

    // Calculate the maximum degree for normalization
    let maxDegree = 1;
    for (const degree of nodeDegrees.values()) {
      if (degree > maxDegree) maxDegree = degree;
    }

    // Determine the degree threshold based on zoom level
    let degreeThreshold: number;
    if (cameraZ >= KEYWORD_ZOOM_START) {
      // Too zoomed out - no labels
      degreeThreshold = Infinity;
    } else if (cameraZ <= KEYWORD_ZOOM_ALL) {
      // Fully zoomed in - show all
      degreeThreshold = 0;
    } else {
      // Interpolate: higher zoom (lower z) = lower threshold
      const t = (cameraZ - KEYWORD_ZOOM_ALL) / (KEYWORD_ZOOM_START - KEYWORD_ZOOM_ALL);
      degreeThreshold = t * maxDegree;
    }

    // Font size scales with zoom: smaller when zoomed out
    // Base size matches .keyword-label in globals.css
    // Adjusted for 10° FOV (3x higher baseline due to increased camera distance)
    const baseFontSize = 28;
    const zoomScale = Math.min(1, 1500 / cameraZ);

    // Track which nodes we've processed (for cleanup)
    const seenNodes = new Set<string>();

    for (const node of nodes) {
      // Only show labels for keyword nodes
      if (node.type !== "keyword") continue;

      const degree = nodeDegrees.get(node.id) ?? 0;

      // Skip if below degree threshold
      if (degree < degreeThreshold) {
        const existing = keywordLabelCache.get(node.id);
        if (existing) existing.style.display = "none";
        continue;
      }

      seenNodes.add(node.id);

      // Convert node position to screen coordinates
      const worldX = node.x ?? 0;
      const worldY = node.y ?? 0;
      const screenPos = worldToScreen({ x: worldX, y: worldY });
      if (!screenPos) continue;

      // Skip if off-screen (with padding)
      if (screenPos.x < -50 || screenPos.x > rect.width + 50 ||
          screenPos.y < -50 || screenPos.y > rect.height + 50) {
        const existing = keywordLabelCache.get(node.id);
        if (existing) existing.style.display = "none";
        continue;
      }

      // Get or create label element
      let labelEl = keywordLabelCache.get(node.id);
      if (!labelEl) {
        labelEl = document.createElement("div");
        labelEl.className = "keyword-label";
        keywordOverlay.appendChild(labelEl);
        keywordLabelCache.set(node.id, labelEl);
      }

      // Calculate offset from node center (to the right of the dot)
      const worldRadius = getNodeRadius(node);
      // Convert world radius to screen pixels (using 10° FOV to match camera)
      const pixelsPerUnit = rect.height / (2 * cameraZ * Math.tan((10 * Math.PI / 180) / 2));
      const screenRadius = worldRadius * pixelsPerUnit;

      // Update label content and position
      labelEl.style.display = "block";
      labelEl.style.left = `${screenPos.x + screenRadius + 4}px`;
      labelEl.style.top = `${screenPos.y}px`;
      labelEl.style.fontSize = `${baseFontSize * zoomScale}px`;

      // Fade in based on how far above threshold
      const fadeRange = Math.max(1, maxDegree * 0.2);
      const fadeT = Math.min(1, (degree - degreeThreshold) / fadeRange);
      labelEl.style.opacity = String(0.5 + 0.5 * fadeT);

      if (labelEl.textContent !== node.label) {
        labelEl.textContent = node.label;
      }
    }

    // Hide labels for nodes that are no longer visible or below threshold
    for (const [nodeId, labelEl] of keywordLabelCache) {
      if (!seenNodes.has(nodeId)) {
        labelEl.style.display = "none";
      }
    }
  }

  function destroy() {
    // Remove cluster labels
    for (const labelEl of clusterLabelCache.values()) {
      labelEl.remove();
    }
    clusterLabelCache.clear();
    if (clusterOverlay.parentNode === container) {
      container.removeChild(clusterOverlay);
    }

    // Remove keyword labels
    for (const labelEl of keywordLabelCache.values()) {
      labelEl.remove();
    }
    keywordLabelCache.clear();
    if (keywordOverlay.parentNode === container) {
      container.removeChild(keywordOverlay);
    }
  }

  return {
    updateClusterLabels,
    updateKeywordLabels,
    destroy,
  };
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Compute node degrees (number of connections) for a graph.
 * Used for determining keyword label visibility.
 */
export function computeNodeDegrees<TLink extends { source: string | { id: string }; target: string | { id: string } }>(
  nodeIds: Iterable<string>,
  links: TLink[]
): Map<string, number> {
  const degrees = new Map<string, number>();

  // Initialize all nodes with degree 0
  for (const id of nodeIds) {
    degrees.set(id, 0);
  }

  // Count connections
  for (const link of links) {
    const sourceId = typeof link.source === "string" ? link.source : link.source.id;
    const targetId = typeof link.target === "string" ? link.target : link.target.id;
    degrees.set(sourceId, (degrees.get(sourceId) ?? 0) + 1);
    degrees.set(targetId, (degrees.get(targetId) ?? 0) + 1);
  }

  return degrees;
}
