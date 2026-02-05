/**
 * Renderer-agnostic HTML label overlay management.
 * Handles DOM-based labels positioned over WebGL canvases.
 * Used by both Three.js and R3F renderers.
 */

import type { SimNode } from "@/lib/map-renderer";
import type { ChunkSimNode } from "@/lib/chunk-layout";
import { computeClusterLabels } from "@/lib/cluster-labels";
import { communityColorScale } from "@/lib/hull-renderer";
import { clusterColorToCSS, type ClusterColorInfo } from "@/lib/semantic-colors";
import { CAMERA_FOV_DEGREES } from "@/lib/three/zoom-to-cursor";
import { calculateScales } from "@/lib/chunk-scale";
import { DEFAULT_ZOOM_PHASE_CONFIG } from "@/lib/zoom-phase-config";

// ============================================================================
// Types
// ============================================================================

export interface LabelOverlayManager {
  /** Update cluster labels based on current node positions */
  updateClusterLabels: (nodes: SimNode[]) => void;
  /** Update keyword labels based on zoom and node degree */
  updateKeywordLabels: (nodes: SimNode[], nodeDegrees: Map<string, number>) => void;
  /** Update chunk text labels based on current node positions */
  updateChunkLabels: (nodes: SimNode[], parentColors: Map<string, string>) => void;
  /** Update label opacity for cross-fading between keyword and chunk labels */
  updateLabelOpacity: (scales: { keywordLabelOpacity: number; chunkLabelOpacity: number }) => void;
  /** Sync the chunk preview overlay with current camera transform */
  syncChunkPreview: () => void;
  /** Track hovered chunk nodes for preview display */
  setHoveredChunk: (node: SimNode | null) => void;
  /** Toggle pinned (expanded) chunk preview */
  togglePinnedChunk: (node: SimNode) => void;
  /** Clean up all DOM elements */
  destroy: () => void;
}

export interface ChunkScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
}

export interface LabelOverlayOptions {
  container: HTMLElement;
  /** Function to convert world coordinates to screen coordinates */
  worldToScreen: (world: { x: number; y: number }) => { x: number; y: number } | null;
  /** Function to convert 3D world coordinates to screen coordinates (with perspective) */
  worldToScreen3D: (world: { x: number; y: number; z: number }) => { x: number; y: number } | null;
  /** Function to get current camera Z position (for zoom-based visibility) */
  getCameraZ: () => number;
  /** Function to get node radius in world units */
  getNodeRadius: (node: SimNode) => number;
  /** Function to get current cluster colors (for label coloring) */
  getClusterColors: () => Map<number, ClusterColorInfo>;
  /** Function to read current keyword label range thresholds */
  getKeywordLabelRange: () => { start: number; full: number };
  /** Function to get chunk screen rects (calculated by ChunkNodes, shared via ref) */
  getChunkScreenRects?: () => Map<string, ChunkScreenRect>;
}

// ============================================================================
// Factory
// ============================================================================

export function createLabelOverlayManager(options: LabelOverlayOptions): LabelOverlayManager {
  const {
    container,
    worldToScreen,
    worldToScreen3D,
    getCameraZ,
    getNodeRadius,
    getClusterColors,
    getKeywordLabelRange,
    getChunkScreenRects,
  } = options;

  // Create overlay for cluster labels
  const clusterOverlay = document.createElement("div");
  clusterOverlay.className = "graph-label-overlay";
  container.appendChild(clusterOverlay);

  // Create overlay for keyword labels (z-index above cluster labels)
  const keywordOverlay = document.createElement("div");
  keywordOverlay.className = "graph-label-overlay";
  keywordOverlay.style.zIndex = "1";
  container.appendChild(keywordOverlay);

  // Create overlay for chunk labels (z-index above keyword labels)
  const chunkOverlay = document.createElement("div");
  chunkOverlay.className = "graph-label-overlay";
  chunkOverlay.style.zIndex = "2";
  container.appendChild(chunkOverlay);

  const chunkPreview = document.createElement("div");
  chunkPreview.className = "chunk-preview";
  chunkPreview.style.zIndex = "3";
  chunkPreview.style.display = "none";
  container.appendChild(chunkPreview);

  // Caches for DOM elements
  const clusterLabelCache = new Map<number, HTMLDivElement>();
  const keywordLabelCache = new Map<string, HTMLDivElement>();
  const chunkLabelCache = new Map<string, HTMLDivElement>();

  // Hover/pin state for chunk previews
  let hoveredChunk: SimNode | null = null;
  let pinnedChunk: SimNode | null = null;

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
    const keywordRange = getKeywordLabelRange();
    const keywordStart = Math.max(keywordRange.start, keywordRange.full);
    const keywordFull = Math.min(keywordRange.start, keywordRange.full);

    // Calculate the maximum degree for normalization
    let maxDegree = 1;
    for (const degree of nodeDegrees.values()) {
      if (degree > maxDegree) maxDegree = degree;
    }

    // Determine the degree threshold based on zoom level
    let degreeThreshold: number;
    if (cameraZ >= keywordStart) {
      // Too zoomed out - no labels
      degreeThreshold = Infinity;
    } else if (cameraZ <= keywordFull) {
      // Fully zoomed in - show all
      degreeThreshold = 0;
    } else {
      // Interpolate: higher zoom (lower z) = lower threshold
      const t = (cameraZ - keywordFull) / (keywordStart - keywordFull);
      degreeThreshold = t * maxDegree;
    }

    // Font size scales with zoom: smaller when zoomed out
    // Base size matches .keyword-label in globals.css
    // Adjusted for 10deg FOV (3x higher baseline due to increased camera distance)
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
      // Convert world radius to screen pixels (using camera FOV)
      const fovRadians = CAMERA_FOV_DEGREES * Math.PI / 180;
      const pixelsPerUnit = rect.height / (2 * cameraZ * Math.tan(fovRadians / 2));
      const screenRadius = worldRadius * pixelsPerUnit;

      // Update label content and position
      labelEl.style.display = "block";
      labelEl.style.left = `${screenPos.x + screenRadius + 4}px`;
      labelEl.style.top = `${screenPos.y}px`;
      labelEl.style.fontSize = `${baseFontSize * zoomScale}px`;

      // Fade in based on how far above threshold
      const fadeRange = Math.max(1, maxDegree * 0.2);
      const fadeT = Math.min(1, (degree - degreeThreshold) / fadeRange);
      const baseOpacity = 0.5 + 0.5 * fadeT;

      // Store base opacity as data attribute for later scaling
      labelEl.dataset.baseOpacity = String(baseOpacity);
      labelEl.style.opacity = String(baseOpacity);

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

  function updateChunkLabels(nodes: SimNode[], parentColors: Map<string, string>) {
    const rect = container.getBoundingClientRect();

    // Get screen rects calculated by ChunkNodes (data sharing, not duplication)
    // If not available (legacy renderer), return early
    if (!getChunkScreenRects) return;
    const screenRects = getChunkScreenRects();

    // Minimum screen size threshold
    const minScreenSize = 50;

    // Track which nodes we've processed (for cleanup)
    const seenNodes = new Set<string>();

    for (const node of nodes) {
      // Only show labels for chunk nodes
      if (node.type !== "chunk") continue;

      // Get screen rect from ChunkNodes (single source of truth)
      const screenRect = screenRects.get(node.id);
      if (!screenRect) {
        // Chunk not rendered or off-screen
        const existing = chunkLabelCache.get(node.id);
        if (existing) existing.style.display = "none";
        continue;
      }

      // Skip if off-screen (with padding)
      if (screenRect.x < -50 || screenRect.x > rect.width + 50 ||
        screenRect.y < -50 || screenRect.y > rect.height + 50) {
        const existing = chunkLabelCache.get(node.id);
        if (existing) existing.style.display = "none";
        continue;
      }

      // Skip if chunk is too small on screen
      if (screenRect.width < minScreenSize) {
        const existing = chunkLabelCache.get(node.id);
        if (existing) existing.style.display = "none";
        continue;
      }

      seenNodes.add(node.id);

      // Get or create label element
      let labelEl = chunkLabelCache.get(node.id);
      if (!labelEl) {
        labelEl = document.createElement("div");
        labelEl.className = "chunk-content-label";
        chunkOverlay.appendChild(labelEl);
        chunkLabelCache.set(node.id, labelEl);
      }

      // Calculate font size based on chunk screen size
      // Smaller base font size for better fit within bounds
      const baseFontSize = 6;
      const baseChunkSize = 100;
      const fontSize = (screenRect.width / baseChunkSize) * baseFontSize;

      // Position text box to fit exactly inside square bounds
      const paddingHorizontal = 12; // 6px left + 6px right from .chunk-content-label
      const paddingVertical = 8;    // 4px top + 4px bottom

      // Calculate square edges
      const squareLeft = screenRect.x - (screenRect.width / 2);
      const squareTop = screenRect.y - (screenRect.height / 2);

      // Update label content and position (inside square, top-left aligned with padding)
      labelEl.style.display = "block";
      labelEl.style.left = `${squareLeft + (paddingHorizontal / 2)}px`;
      labelEl.style.top = `${squareTop + (paddingVertical / 2)}px`;
      labelEl.style.width = `${screenRect.width - paddingHorizontal}px`;
      labelEl.style.height = `${screenRect.height - paddingVertical}px`;
      labelEl.style.fontSize = `${fontSize}px`;
      labelEl.style.maxWidth = `${screenRect.width - paddingHorizontal}px`;
      labelEl.style.maxHeight = `${screenRect.height - paddingVertical}px`;
      labelEl.style.overflow = "hidden"; // Clip overflow text
      labelEl.style.transform = "none"; // Disable any CSS centering transforms

      // Force text wrapping for long lines
      labelEl.style.whiteSpace = "normal";
      labelEl.style.wordWrap = "break-word";
      labelEl.style.overflowWrap = "break-word";

      // Display full content
      const targetContent = (node as ChunkSimNode).content || node.label;

      if (labelEl.textContent !== targetContent) {
        labelEl.textContent = targetContent;
      }
    }

    // Hide labels for nodes that are no longer visible
    for (const [nodeId, labelEl] of chunkLabelCache) {
      if (!seenNodes.has(nodeId)) {
        labelEl.style.display = "none";
      }
    }
  }

  function updateLabelOpacity(scales: { keywordLabelOpacity: number; chunkLabelOpacity: number }) {
    // Optimization: Only update if opacity changed significantly (CSS transition handles smoothing)
    // This reduces layout thrashing from 5-20ms to <2ms per frame
    for (const labelEl of keywordLabelCache.values()) {
      if (labelEl.style.display !== "none") {
        const baseOpacity = parseFloat(labelEl.dataset.baseOpacity || "1");
        const newOpacity = baseOpacity * scales.keywordLabelOpacity;
        const currentOpacity = parseFloat(labelEl.style.opacity || "1");

        // Only update if change is significant (>5%)
        if (Math.abs(newOpacity - currentOpacity) > 0.05) {
          labelEl.style.opacity = String(newOpacity);
        }
      }
    }

    // Same optimization for chunk labels
    for (const labelEl of chunkLabelCache.values()) {
      if (labelEl.style.display !== "none") {
        const newOpacity = scales.chunkLabelOpacity;
        const currentOpacity = parseFloat(labelEl.style.opacity || "0");

        if (Math.abs(newOpacity - currentOpacity) > 0.05) {
          labelEl.style.opacity = String(newOpacity);
        }
      }
    }
  }

  function isChunkNode(node: SimNode | null): node is SimNode & { type: "chunk" } {
    return !!node && node.type === "chunk";
  }

  function getChunkPreviewText(node: SimNode): string {
    const chunkContent = (node as SimNode & { content?: string | null }).content;
    return chunkContent?.trim() || node.label || "";
  }

  function hideChunkPreview(): void {
    chunkPreview.style.display = "none";
    chunkPreview.classList.remove("is-visible");
    chunkPreview.classList.remove("is-expanded");
  }

  function updateChunkPreview(): void {
    const target = hoveredChunk ?? pinnedChunk;
    if (!isChunkNode(target)) {
      hideChunkPreview();
      return;
    }
    if (typeof target.x !== "number" || typeof target.y !== "number") {
      hideChunkPreview();
      return;
    }

    const text = getChunkPreviewText(target);
    if (!text) {
      hideChunkPreview();
      return;
    }

    const screenPos = worldToScreen({ x: target.x, y: target.y });
    if (!screenPos) {
      hideChunkPreview();
      return;
    }

    const rect = container.getBoundingClientRect();
    const cameraZ = getCameraZ();
    const fovRadians = CAMERA_FOV_DEGREES * Math.PI / 180;
    const pixelsPerUnit = rect.height / (2 * cameraZ * Math.tan(fovRadians / 2));
    const screenRadius = getNodeRadius(target) * pixelsPerUnit;
    const anchorY = screenPos.y - screenRadius - 12;
    const zoomScale = Math.min(1.15, 1500 / cameraZ);
    const pinned = !!pinnedChunk && pinnedChunk.id === target.id;

    chunkPreview.style.display = "block";
    chunkPreview.classList.add("is-visible");
    chunkPreview.classList.toggle("is-expanded", pinned);
    chunkPreview.dataset.chunkId = target.id;
    chunkPreview.style.left = `${screenPos.x}px`;
    chunkPreview.style.top = `${anchorY}px`;
    chunkPreview.style.fontSize = `${14 * zoomScale}px`;
    chunkPreview.style.maxWidth = `${(pinned ? 420 : 320) * zoomScale}px`;
    if (chunkPreview.textContent !== text) {
      chunkPreview.textContent = text;
    }
  }

  function setHoveredChunk(node: SimNode | null): void {
    hoveredChunk = isChunkNode(node) ? node : null;
    updateChunkPreview();
  }

  function togglePinnedChunk(node: SimNode): void {
    if (!isChunkNode(node)) return;
    if (pinnedChunk && pinnedChunk.id === node.id) {
      pinnedChunk = null;
    } else {
      pinnedChunk = node;
    }
    updateChunkPreview();
  }

  function syncChunkPreview(): void {
    if (chunkPreview.style.display !== "none") {
      updateChunkPreview();
    }
  }

  function destroy() {
    hoveredChunk = null;
    pinnedChunk = null;
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

    // Remove chunk labels
    for (const labelEl of chunkLabelCache.values()) {
      labelEl.remove();
    }
    chunkLabelCache.clear();
    if (chunkOverlay.parentNode === container) {
      container.removeChild(chunkOverlay);
    }
    chunkPreview.remove();
  }

  return {
    updateClusterLabels,
    updateKeywordLabels,
    updateChunkLabels,
    updateLabelOpacity,
    syncChunkPreview,
    setHoveredChunk,
    togglePinnedChunk,
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
