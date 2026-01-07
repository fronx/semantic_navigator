/**
 * Three.js renderer for the Topics visualization using 3d-force-graph.
 * Provides WebGL-based rendering as an alternative to the D3/SVG renderer.
 *
 * NOTE: This module must be dynamically imported to avoid SSR issues
 * since 3d-force-graph requires browser APIs (window, WebGL).
 */

import * as THREE from "three";
import { forceCollide } from "d3-force";
import { communityColorScale } from "@/lib/hull-renderer";
import { computeEdgeCurveDirections, type SimNode, type SimLink, type ImmediateParams } from "@/lib/map-renderer";
import { computeArcPoints } from "@/lib/edge-curves";

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
  /** Update visual parameters without relayout (reads from immediateParams ref) */
  updateVisuals: () => void;
  /** Update cluster assignments on nodes (triggers color refresh) */
  updateClusters: (nodeToCluster: Map<string, number>) => void;
  /** Apply highlight styling to nodes */
  applyHighlight: (highlightedIds: Set<string> | null, baseDim: number) => void;
  /** Get nodes for external access */
  getNodes: () => SimNode[];
  /** Get current zoom/camera info */
  getTransform: () => { k: number; x: number; y: number };
  /** Convert screen coordinates to world coordinates */
  screenToWorld: (screen: { x: number; y: number }) => { x: number; y: number };
  /** Fit view to show all nodes with optional padding */
  fitToNodes: (padding?: number) => void;
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
// Constants
// ============================================================================

/** Base radius for keyword dots (before dotScale is applied) */
const BASE_DOT_RADIUS = 4;

/** Scale factor applied to dots for better visibility */
const DOT_SCALE_FACTOR = 2.5;

/** Extra padding added to collision radius beyond the visual dot size */
const COLLISION_PADDING = 1;

/** Number of segments for circle geometry (higher = smoother circles) */
const CIRCLE_SEGMENTS = 64;

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
  return BASE_DOT_RADIUS * dotScale;
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

  // Pre-computed curve directions (same logic as D3 renderer)
  let curveDirections = computeEdgeCurveDirections(
    currentNodes,
    currentLinks,
    immediateParams.current.curveMethod
  );
  let currentCurveMethod = immediateParams.current.curveMethod;
  let currentCurveType = immediateParams.current.curveType;

  // Arc segments for custom arc rendering (more = smoother, but more geometry)
  const ARC_SEGMENTS = 16;

  // Configure graph for 2D display (top-down view)
  graph
    .numDimensions(2) // 2D layout
    .nodeId("id")
    .nodeLabel((node: object) => (node as SimNode).label)
    // Use custom node objects with MeshBasicMaterial for vibrant, flat colors (no lighting)
    .nodeThreeObject((node: object) => {
      const n = node as SimNode;
      const radius = getNodeRadius(n, immediateParams.current.dotScale) * DOT_SCALE_FACTOR;
      const geometry = new THREE.CircleGeometry(radius, CIRCLE_SEGMENTS);
      const color = new THREE.Color(getNodeColor(n));

      // Calculate opacity based on highlight state
      let opacity = 1;
      if (currentHighlight === null) {
        opacity = 1 - currentBaseDim;
      } else if (currentHighlight.size > 0) {
        opacity = currentHighlight.has(n.id) ? 1 : 0.15;
      }

      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: opacity < 1,
        opacity,
      });

      return new THREE.Mesh(geometry, material);
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
    .enableNavigationControls(false); // We handle pan/zoom for zoom-to-cursor

  // Configure curve rendering based on curveType
  function configureCurveRendering() {
    if (currentCurveType === "bezier") {
      // Use built-in bezier curves via linkCurvature
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (graph as any)
        .linkThreeObject(undefined) // Clear any custom object
        .linkPositionUpdate(undefined) // Clear custom position update
        .linkCurvature((link: object) => {
          const l = link as SimLink;
          const direction = curveDirections.get(l) ?? 1;
          return immediateParams.current.edgeCurve * direction;
        });
    } else {
      // Use custom circular arc rendering
      graph
        .linkCurvature(0) // Disable built-in curves
        .linkThreeObject((link: object) => {
          // Create a line with enough vertices for the arc
          const geometry = new THREE.BufferGeometry();
          const positions = new Float32Array((ARC_SEGMENTS + 1) * 3);
          geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

          const material = new THREE.LineBasicMaterial({
            color: 0x888888,
            transparent: true,
            opacity: immediateParams.current.edgeOpacity * 0.4,
          });

          return new THREE.Line(geometry, material);
        })
        .linkPositionUpdate((line: object, { start, end }: { start: { x: number; y: number; z?: number }; end: { x: number; y: number; z?: number } }, link: object) => {
          const l = link as SimLink;
          const direction = curveDirections.get(l) ?? 1;
          const curveIntensity = immediateParams.current.edgeCurve;

          // Compute arc points using shared utility
          const arcPoints = computeArcPoints(
            { x: start.x, y: start.y },
            { x: end.x, y: end.y },
            curveIntensity,
            direction,
            ARC_SEGMENTS
          );

          // Update line geometry
          const threeObj = line as THREE.Line;
          const positions = threeObj.geometry.attributes.position as THREE.BufferAttribute;

          for (let i = 0; i < arcPoints.length; i++) {
            positions.setXYZ(i, arcPoints[i].x, arcPoints[i].y, 0);
          }
          // Fill remaining vertices with last point (in case we have fewer points)
          const lastPoint = arcPoints[arcPoints.length - 1];
          for (let i = arcPoints.length; i <= ARC_SEGMENTS; i++) {
            positions.setXYZ(i, lastPoint.x, lastPoint.y, 0);
          }

          positions.needsUpdate = true;
          threeObj.geometry.computeBoundingSphere();

          return true; // Indicates we've updated the position
        });
    }
  }

  // Apply initial curve configuration
  configureCurveRendering();

  // Add collision force to prevent overlapping dots
  // Radius derived from visual dot size constants
  const collisionRadius = BASE_DOT_RADIUS * DOT_SCALE_FACTOR + COLLISION_PADDING;
  graph.d3Force("collision", forceCollide(collisionRadius));

  // Set initial data
  graph
    // Animate the force-directed layout (like D3 renderer)
    .warmupTicks(0) // Don't pre-compute - show from the start
    .cooldownTicks(300) // Let simulation run for ~300 ticks
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
  // Start zoomed out enough to see a large graph, then fit will adjust
  setTimeout(() => {
    const camera = graph.camera();
    if (camera) {
      // Start at z=1500 (zoomed out) - fit will adjust once layout settles
      camera.position.set(0, 0, 1500);
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

  // Track if we've done initial fit
  let hasFittedInitially = false;

  // Fit to nodes helper (defined here so onEngineStop can use it)
  function fitToNodesInternal(padding = 0.2) {
    const camera = graph.camera();
    if (!camera || currentNodes.length === 0) return;

    // Get node positions from 3d-force-graph (they have x, y after simulation)
    const graphData = graph.graphData();
    const nodes = graphData.nodes as Array<{ x?: number; y?: number }>;
    if (nodes.length === 0) return;

    // Compute bounding box
    const xs = nodes.map(n => n.x ?? 0);
    const ys = nodes.map(n => n.y ?? 0);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const graphWidth = (maxX - minX) || 1;
    const graphHeight = (maxY - minY) || 1;
    const graphCenterX = (minX + maxX) / 2;
    const graphCenterY = (minY + maxY) / 2;

    // Calculate camera Z to fit the graph with padding
    const rect = container.getBoundingClientRect();
    const fov = (camera as THREE.PerspectiveCamera).fov * Math.PI / 180;
    const aspect = rect.width / rect.height;

    // Calculate Z needed to fit graph (accounting for padding)
    const paddedWidth = graphWidth * (1 + padding);
    const paddedHeight = graphHeight * (1 + padding);

    // Z needed to see the full height
    const zForHeight = paddedHeight / (2 * Math.tan(fov / 2));
    // Z needed to see the full width
    const zForWidth = paddedWidth / (2 * Math.tan(fov / 2) * aspect);

    // Use the larger Z (more zoomed out) to fit both dimensions
    const newZ = Math.max(zForHeight, zForWidth, 50); // Min zoom of 50

    // Smoothly animate camera to new position
    const startX = camera.position.x;
    const startY = camera.position.y;
    const startZ = camera.position.z;
    const duration = 500; // ms
    const startTime = performance.now();

    function animateCamera() {
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      // Ease out cubic for smooth deceleration
      const eased = 1 - Math.pow(1 - t, 3);

      camera.position.x = startX + (graphCenterX - startX) * eased;
      camera.position.y = startY + (graphCenterY - startY) * eased;
      camera.position.z = startZ + (newZ - startZ) * eased;

      if (t < 1) {
        requestAnimationFrame(animateCamera);
      }
    }
    animateCamera();

    // Notify zoom change
    if (callbacks.onZoomEnd) {
      const k = 500 / newZ;
      callbacks.onZoomEnd({ k, x: graphCenterX, y: graphCenterY });
    }
  }

  // Early fit after ~1.5 seconds so user sees the graph quickly
  const earlyFitTimeout = setTimeout(() => {
    if (!hasFittedInitially) {
      hasFittedInitially = true;
      fitToNodesInternal(0.1);
    }
  }, 1500);

  // Final fit when simulation fully settles (only once)
  graph.onEngineStop(() => {
    if (!hasFittedInitially) {
      hasFittedInitially = true;
      fitToNodesInternal(0.1);
    }

    if (callbacks.onZoomEnd) {
      const camera = graph.camera();
      const k = camera ? 500 / camera.position.z : 1;
      callbacks.onZoomEnd({ k, x: camera.position.x, y: camera.position.y });
    }
  });

  // Store cleanup function
  const cleanup = () => {
    if (earlyFitTimeout) clearTimeout(earlyFitTimeout);
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
      // Recompute curve directions (same logic as D3 renderer)
      curveDirections = computeEdgeCurveDirections(
        currentNodes,
        currentLinks,
        immediateParams.current.curveMethod
      );
      currentCurveMethod = immediateParams.current.curveMethod;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graph.graphData({ nodes: currentNodes as any, links: currentLinks as any });
    },

    updateVisuals() {
      // Recompute curve directions if method changed
      if (immediateParams.current.curveMethod !== currentCurveMethod) {
        curveDirections = computeEdgeCurveDirections(
          currentNodes,
          currentLinks,
          immediateParams.current.curveMethod
        );
        currentCurveMethod = immediateParams.current.curveMethod;
      }

      // Reconfigure curve rendering if type changed
      if (immediateParams.current.curveType !== currentCurveType) {
        currentCurveType = immediateParams.current.curveType;
        configureCurveRendering();
        // Need to refresh graph data to apply new link objects
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        graph.graphData({ nodes: currentNodes as any, links: currentLinks as any });
      }

      // Force re-render of links (curvature) and link opacity
      if (currentCurveType === "bezier") {
        graph.linkCurvature(graph.linkCurvature());
      }
      graph.linkOpacity(immediateParams.current.edgeOpacity * 0.4);
    },

    updateClusters(nodeToCluster: Map<string, number>) {
      // Update communityId on each node
      for (const node of currentNodes) {
        // Node IDs are like "kw:keyword", nodeToCluster keys are like "kw-123"
        // We need to find the matching entry
        const clusterId = nodeToCluster.get(node.id);
        node.communityId = clusterId;
      }
      // Force re-render of custom node objects
      graph.nodeThreeObject(graph.nodeThreeObject());
    },

    applyHighlight(highlightedIds: Set<string> | null, baseDim: number) {
      currentHighlight = highlightedIds;
      currentBaseDim = baseDim;
      // Force re-render of custom node objects
      graph.nodeThreeObject(graph.nodeThreeObject());
    },

    getNodes() {
      return currentNodes;
    },

    getTransform() {
      const camera = graph.camera();
      if (!camera) return { k: 1, x: 0, y: 0 };

      const rect = container.getBoundingClientRect();
      const fov = (camera as THREE.PerspectiveCamera).fov * Math.PI / 180;
      const visibleHeight = 2 * camera.position.z * Math.tan(fov / 2);
      // k = pixels per world unit (for proper radius conversion)
      const k = rect.height / visibleHeight;

      return { k, x: 0, y: 0 };
    },

    screenToWorld(screen: { x: number; y: number }) {
      const camera = graph.camera();
      if (!camera) return { x: 0, y: 0 };

      const rect = container.getBoundingClientRect();
      const fov = (camera as THREE.PerspectiveCamera).fov * Math.PI / 180;

      // Calculate visible area at z=0
      const visibleHeight = 2 * camera.position.z * Math.tan(fov / 2);
      const visibleWidth = visibleHeight * (rect.width / rect.height);

      // Convert screen to normalized device coordinates (-1 to +1)
      const ndcX = (screen.x / rect.width) * 2 - 1;
      const ndcY = -((screen.y / rect.height) * 2 - 1); // Flip Y (screen Y down, world Y up)

      // Convert NDC to world coordinates
      return {
        x: camera.position.x + ndcX * (visibleWidth / 2),
        y: camera.position.y + ndcY * (visibleHeight / 2),
      };
    },

    fitToNodes(padding = 0.2) {
      fitToNodesInternal(padding);
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
