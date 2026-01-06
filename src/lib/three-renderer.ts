/**
 * Three.js renderer for the Topics visualization using 3d-force-graph.
 * Provides WebGL-based rendering as an alternative to the D3/SVG renderer.
 *
 * NOTE: This module must be dynamically imported to avoid SSR issues
 * since 3d-force-graph requires browser APIs (window, WebGL).
 */

import * as d3 from "d3";
import * as THREE from "three";
import { communityColorScale } from "@/lib/hull-renderer";
import type { SimNode, SimLink, ImmediateParams } from "@/lib/map-renderer";

// ============================================================================
// Types
// ============================================================================

export interface ThreeRendererCallbacks {
  onKeywordClick?: (keyword: string) => void;
  onZoomEnd?: (transform: { k: number; x: number; y: number }) => void;
}

export interface ThreeRenderer {
  /** Update the graph with new data */
  updateData: (nodes: SimNode[], links: SimLink[]) => void;
  /** Update cluster assignments on nodes (triggers color refresh) */
  updateClusters: (nodeToCluster: Map<string, number>) => void;
  /** Apply highlight styling to nodes */
  applyHighlight: (highlightedIds: Set<string> | null, baseDim: number) => void;
  /** Get nodes for external access */
  getNodes: () => SimNode[];
  /** Get current zoom/camera info */
  getTransform: () => { k: number; x: number; y: number };
  /** Clean up */
  destroy: () => void;
}

interface ThreeRendererOptions {
  container: HTMLElement;
  nodes: SimNode[];
  links: SimLink[];
  immediateParams: { current: ImmediateParams };
  callbacks: ThreeRendererCallbacks;
}

// ============================================================================
// Helpers
// ============================================================================

function getNodeColor(node: SimNode): string {
  if (node.communityId !== undefined) {
    return communityColorScale(String(node.communityId));
  }
  return "#9ca3af"; // grey-400 for unclustered
}

function getNodeRadius(_node: SimNode, dotScale: number): number {
  // Keywords only for now
  return 4 * dotScale;
}

// ============================================================================
// Renderer Factory
// ============================================================================

export async function createThreeRenderer(options: ThreeRendererOptions): Promise<ThreeRenderer> {
  const { container, nodes: initialNodes, links: initialLinks, immediateParams, callbacks } = options;

  // Dynamic import to avoid SSR issues (3d-force-graph requires browser APIs)
  const ForceGraph3D = (await import("3d-force-graph")).default;

  // Create the graph instance with orbit controls (supports disabling rotation)
  const graph = new ForceGraph3D(container, { controlType: "orbit" });

  // Track current data
  let currentNodes = initialNodes;
  let currentLinks = initialLinks;
  let currentHighlight: Set<string> | null = null;
  let currentBaseDim = 0.3;

  // Configure graph for 2D display (top-down view)
  graph
    .numDimensions(2) // 2D layout
    .nodeId("id")
    .nodeLabel((node: object) => (node as SimNode).label)
    .nodeColor((node: object) => {
      const n = node as SimNode;
      if (currentHighlight === null) {
        // Dim everything
        return d3.color(getNodeColor(n))!.copy({ opacity: 1 - currentBaseDim }).formatRgb();
      }
      if (currentHighlight.size === 0) {
        // Full opacity
        return getNodeColor(n);
      }
      // Highlight selected
      const opacity = currentHighlight.has(n.id) ? 1 : 0.15;
      return d3.color(getNodeColor(n))!.copy({ opacity }).formatRgb();
    })
    .nodeVal((node: object) => getNodeRadius(node as SimNode, immediateParams.current.dotScale))
    .linkSource("source")
    .linkTarget("target")
    .linkColor(() => "#888")
    .linkOpacity(immediateParams.current.edgeOpacity * 0.4)
    .linkWidth(1)
    .backgroundColor("#ffffff00") // Transparent
    .showNavInfo(false)
    .enableNodeDrag(true)
    .enableNavigationControls(false) // We handle pan/zoom for zoom-to-cursor
    // Performance: pre-compute layout then freeze simulation
    .warmupTicks(100) // Run 100 ticks before rendering
    .cooldownTicks(0) // Don't run simulation after initial render
    // Cast to any to bridge D3's SimulationNodeDatum (fx: number | null)
    // with 3d-force-graph's NodeObject (fx?: number | undefined)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .graphData({ nodes: currentNodes as any, links: currentLinks as any });

  // Click handler
  graph.onNodeClick((node: object) => {
    const n = node as SimNode;
    if (n.type === "keyword" && callbacks.onKeywordClick) {
      callbacks.onKeywordClick(n.label);
    }
  });

  // Camera setup for 2D view (top-down)
  // Wait a tick for the graph to initialize
  setTimeout(() => {
    const camera = graph.camera();
    if (camera) {
      camera.position.set(0, 0, 500);
      camera.lookAt(0, 0, 0);
    }
  }, 100);

  // Custom 2D pan handling (no rotation)
  let isPanning = false;
  let lastMouseX = 0;
  let lastMouseY = 0;

  const handleMouseDown = (event: MouseEvent) => {
    // Only pan on left click, and not if dragging a node
    if (event.button !== 0) return;
    isPanning = true;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
    container.style.cursor = "grabbing";
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (!isPanning) return;

    const camera = graph.camera();
    if (!camera) return;

    const deltaX = event.clientX - lastMouseX;
    const deltaY = event.clientY - lastMouseY;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;

    // Convert screen delta to world delta based on camera distance
    const fov = (camera as THREE.PerspectiveCamera).fov * Math.PI / 180;
    const rect = container.getBoundingClientRect();
    const visibleHeight = 2 * camera.position.z * Math.tan(fov / 2);
    const pixelsPerUnit = rect.height / visibleHeight;

    // Move camera (invert because dragging "grabs" the canvas)
    camera.position.x -= deltaX / pixelsPerUnit;
    camera.position.y += deltaY / pixelsPerUnit; // Y is inverted in screen coords
  };

  const handleMouseUp = () => {
    if (isPanning) {
      isPanning = false;
      container.style.cursor = "grab";

      // Notify zoom/pan change
      if (callbacks.onZoomEnd) {
        const camera = graph.camera();
        if (camera) {
          const k = 500 / camera.position.z;
          callbacks.onZoomEnd({ k, x: camera.position.x, y: camera.position.y });
        }
      }
    }
  };

  container.addEventListener("mousedown", handleMouseDown);
  container.addEventListener("mousemove", handleMouseMove);
  container.addEventListener("mouseup", handleMouseUp);
  container.addEventListener("mouseleave", handleMouseUp);

  // Custom zoom-to-cursor handling
  // No custom easing - let the OS/browser handle trackpad momentum
  let zoomEndTimeout: ReturnType<typeof setTimeout> | null = null;

  const handleWheel = (event: WheelEvent) => {
    event.preventDefault();

    const camera = graph.camera();
    if (!camera) return;

    const rect = container.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Convert mouse position to normalized device coordinates (-1 to +1)
    const ndcX = (mouseX / rect.width) * 2 - 1;
    const ndcY = -(mouseY / rect.height) * 2 + 1;

    // Get current camera position
    const oldZ = camera.position.z;
    const zoomSensitivity = camera.position.z * 0.003;
    const newZ = Math.max(50, Math.min(2000, oldZ + event.deltaY * zoomSensitivity));

    if (Math.abs(newZ - oldZ) < 0.01) return;

    // Calculate the graph position under the mouse before zoom
    const fov = (camera as THREE.PerspectiveCamera).fov * Math.PI / 180;
    const oldHeight = 2 * oldZ * Math.tan(fov / 2);
    const oldWidth = oldHeight * (rect.width / rect.height);

    const graphX = camera.position.x + ndcX * (oldWidth / 2);
    const graphY = camera.position.y + ndcY * (oldHeight / 2);

    // Calculate new visible area
    const newHeight = 2 * newZ * Math.tan(fov / 2);
    const newWidth = newHeight * (rect.width / rect.height);

    // Adjust camera position so the point under cursor stays fixed
    camera.position.x = graphX - ndcX * (newWidth / 2);
    camera.position.y = graphY - ndcY * (newHeight / 2);
    camera.position.z = newZ;

    // Debounce callback to avoid React re-renders during zoom
    if (zoomEndTimeout) clearTimeout(zoomEndTimeout);
    zoomEndTimeout = setTimeout(() => {
      if (callbacks.onZoomEnd) {
        const k = 500 / camera.position.z;
        callbacks.onZoomEnd({ k, x: camera.position.x, y: camera.position.y });
      }
    }, 150);
  };

  container.addEventListener("wheel", handleWheel, { passive: false });

  // Zoom end callback for drag operations
  graph.onEngineStop(() => {
    if (callbacks.onZoomEnd) {
      const camera = graph.camera();
      const k = camera ? 500 / camera.position.z : 1;
      callbacks.onZoomEnd({ k, x: camera.position.x, y: camera.position.y });
    }
  });

  // Store cleanup function
  const cleanup = () => {
    if (zoomEndTimeout) clearTimeout(zoomEndTimeout);
    container.removeEventListener("wheel", handleWheel);
    container.removeEventListener("mousedown", handleMouseDown);
    container.removeEventListener("mousemove", handleMouseMove);
    container.removeEventListener("mouseup", handleMouseUp);
    container.removeEventListener("mouseleave", handleMouseUp);
  };

  return {
    updateData(nodes: SimNode[], links: SimLink[]) {
      currentNodes = nodes;
      currentLinks = links;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graph.graphData({ nodes: currentNodes as any, links: currentLinks as any });
    },

    updateClusters(nodeToCluster: Map<string, number>) {
      // Update communityId on each node
      for (const node of currentNodes) {
        // Node IDs are like "kw:keyword", nodeToCluster keys are like "kw-123"
        // We need to find the matching entry
        const clusterId = nodeToCluster.get(node.id);
        node.communityId = clusterId;
      }
      // Force re-render of node colors
      graph.nodeColor(graph.nodeColor());
    },

    applyHighlight(highlightedIds: Set<string> | null, baseDim: number) {
      currentHighlight = highlightedIds;
      currentBaseDim = baseDim;
      // Force re-render of node colors
      graph.nodeColor(graph.nodeColor());
    },

    getNodes() {
      return currentNodes;
    },

    getTransform() {
      const camera = graph.camera();
      const k = camera ? 500 / camera.position.z : 1;
      return { k, x: 0, y: 0 };
    },

    destroy() {
      cleanup();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (graph as any)._destructor?.();
      // Clear container
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
    },
  };
}
