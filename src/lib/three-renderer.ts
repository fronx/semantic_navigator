/**
 * Three.js renderer for the Topics visualization using 3d-force-graph.
 * Provides WebGL-based rendering as an alternative to the D3/SVG renderer.
 *
 * NOTE: This module must be dynamically imported to avoid SSR issues
 * since 3d-force-graph requires browser APIs (window, WebGL).
 */

import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { forceCollide } from "d3-force";
import { communityColorScale, groupNodesByCommunity } from "@/lib/hull-renderer";
import { blendColors, dimColor, colors } from "@/lib/colors";
import { computeEdgeCurveDirections, type SimNode, type SimLink, type ImmediateParams } from "@/lib/map-renderer";
import {
  pcaProject,
  coordinatesToHSL,
  computeClusterColors,
  nodeColorFromCluster,
  type PCATransform,
  type ClusterColorInfo,
} from "@/lib/semantic-colors";
import {
  createConvergenceState,
  processSimulationTick,
  DEFAULT_CONVERGENCE_CONFIG,
} from "@/lib/simulation-convergence";
import {
  createAutoFitState,
  markUserInteraction,
  shouldFitDuringSimulation,
  shouldFitAfterCooling,
  markInitialFitDone,
} from "@/lib/auto-fit";
import { createLabelOverlayManager, computeNodeDegrees } from "@/lib/three-label-overlays";

// ============================================================================
// Types
// ============================================================================

export interface ThreeRendererCallbacks {
  onKeywordClick?: (keyword: string) => void;
  /** Called when a project node is clicked */
  onProjectClick?: (projectId: string) => void;
  /** Called when a project node is dragged to a new position */
  onProjectDrag?: (projectId: string, position: { x: number; y: number }) => void;
  onZoomEnd?: (transform: { k: number; x: number; y: number }) => void;
  /** Called when a project node interaction starts (click or drag) - used to suppress click-to-filter */
  onProjectInteractionStart?: () => void;
}

export interface ThreeRenderer {
  /** Check if currently hovering over a project node (uses 3d-force-graph's internal hit detection) */
  isHoveringProject: () => boolean;
  /** Update the graph with new data */
  updateData: (nodes: SimNode[], links: SimLink[]) => void;
  /** Update visual parameters without relayout (reads from immediateParams ref) */
  updateVisuals: () => void;
  /** Update cluster assignments on nodes (triggers color refresh) */
  updateClusters: (nodeToCluster: Map<string, number>) => void;
  /** Update cluster labels (recomputes from current node positions and properties) */
  updateClusterLabels: () => void;
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
  /** PCA transform for stable semantic colors (optional, falls back to communityColorScale) */
  pcaTransform?: PCATransform;
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

// Project node color - distinct purple/violet (same as D3 renderer)
const PROJECT_COLOR = "#8b5cf6";


function getNodeColor(
  node: SimNode,
  pcaTransform?: PCATransform,
  clusterColors?: Map<number, ClusterColorInfo>,
  colorMixRatio: number = 0
): string {
  // Projects have a distinct purple color
  if (node.type === "project") {
    return PROJECT_COLOR;
  }

  // Use cluster-based color if available (same logic as D3 renderer)
  if (pcaTransform && node.embedding && node.embedding.length > 0 && node.communityId !== undefined && clusterColors) {
    const clusterInfo = clusterColors.get(node.communityId);
    if (clusterInfo) {
      return nodeColorFromCluster(node.embedding, clusterInfo, pcaTransform, colorMixRatio);
    }
    // Fallback: use node's own embedding if not in cluster color map
    const [x, y] = pcaProject(node.embedding, pcaTransform);
    return coordinatesToHSL(x, y);
  }

  // Fall back to community-based coloring
  if (node.communityId !== undefined) {
    return communityColorScale(String(node.communityId));
  }
  return "#9ca3af"; // grey-400 for unclustered
}

function getNodeRadius(node: SimNode, dotScale: number): number {
  // Projects are larger than keywords
  if (node.type === "project") {
    return 7 * dotScale; // Larger base radius for projects
  }
  return BASE_DOT_RADIUS * dotScale;
}

/**
 * Get edge color by blending the colors of its source and target nodes.
 */
function getEdgeColor(
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
// Renderer Factory
// ============================================================================

export async function createThreeRenderer(options: ThreeRendererOptions): Promise<ThreeRenderer> {
  const { container, nodes: initialNodes, links: initialLinks, immediateParams, callbacks, pcaTransform } = options;

  // Dynamic import to avoid SSR issues (3d-force-graph requires browser APIs)
  const ForceGraph3D = (await import("3d-force-graph")).default;

  // Create the graph instance with orbit controls (supports disabling rotation)
  const graph = new ForceGraph3D(container, { controlType: "orbit" });

  // Track the canvas element this renderer creates (for cleanup without affecting other renderers)
  const ownCanvas = container.querySelector("canvas");

  // Ensure container is positioning context for overlays
  container.style.position = "relative";

  // Track current data
  let currentNodes = initialNodes;
  let currentLinks = initialLinks;
  let currentHighlight: Set<string> | null = null;
  let currentBaseDim = 0.3;

  // Cluster colors computed from node embeddings (same approach as D3 renderer)
  let clusterColors = computeClusterColors(groupNodesByCommunity(currentNodes), pcaTransform);
  // Track colorMixRatio to detect changes
  let currentColorMixRatio = immediateParams.current.colorMixRatio;

  // Node map for quick lookups (used for edge coloring)
  let nodeMap = new Map<string, SimNode>(currentNodes.map(n => [n.id, n]));

  // Fix project nodes in place (exclude from force simulation)
  // Setting fx/fy anchors the node at that position
  for (const node of currentNodes) {
    if (node.type === "project") {
      node.fx = node.x;
      node.fy = node.y;
    }
  }

  // Cache for node meshes to avoid recreating on every update
  const nodeCache = new Map<string, THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>>();

  // Cache for link objects (when using arc rendering with fat lines)
  const linkCache = new Map<string, Line2>();

  // Cache for original edge colors (for dimming via color mixing instead of opacity)
  const edgeColorCache = new Map<string, string>();

  // Helper to get link cache key
  const getLinkKey = (link: SimLink): string => {
    const sourceId = typeof link.source === "string" ? link.source : link.source.id;
    const targetId = typeof link.target === "string" ? link.target : link.target.id;
    return `${sourceId}->${targetId}`;
  };

  // Pre-computed curve directions (same logic as D3 renderer)
  let curveDirections = computeEdgeCurveDirections(
    currentNodes,
    currentLinks,
    immediateParams.current.curveMethod
  );
  let currentCurveMethod = immediateParams.current.curveMethod;
  let currentCurveType = immediateParams.current.curveType;

  // Compute node degrees (number of connections) for label visibility
  let nodeDegrees = computeNodeDegrees(currentNodes.map(n => n.id), currentLinks);

  // Arc segments for custom arc rendering (more = smoother, but more geometry)
  const ARC_SEGMENTS = 20;

  // Z offset to keep edges behind nodes (prevents z-fighting flicker)
  const EDGE_Z_OFFSET = -1;

  // Configure graph for 2D display (top-down view)
  graph
    .numDimensions(2) // 2D layout
    .nodeId("id")
    .nodeLabel((node: object) => (node as SimNode).label)
    // Use custom node objects with MeshBasicMaterial for vibrant, flat colors (no lighting)
    // IMPORTANT: We cache meshes to avoid memory leaks from recreating geometries/materials
    .nodeThreeObject((node: object) => {
      const n = node as SimNode;

      // Check cache first
      const cached = nodeCache.get(n.id);
      if (cached) {
        // Update existing mesh properties
        const material = cached.material;
        material.color.set(getNodeColor(n, pcaTransform, clusterColors, immediateParams.current.colorMixRatio));

        // Update opacity based on highlight state
        let opacity = 1;
        if (currentHighlight === null) {
          opacity = 1 - currentBaseDim;
        } else if (currentHighlight.size > 0) {
          opacity = currentHighlight.has(n.id) ? 1 : 0.15;
        }
        material.opacity = opacity;
        material.transparent = opacity < 1;
        material.needsUpdate = true;

        return cached;
      }

      // Create new mesh and cache it
      const radius = getNodeRadius(n, immediateParams.current.dotScale) * DOT_SCALE_FACTOR;
      const geometry = new THREE.CircleGeometry(radius, CIRCLE_SEGMENTS);
      const color = new THREE.Color(getNodeColor(n, pcaTransform, clusterColors, immediateParams.current.colorMixRatio));

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

      const mesh = new THREE.Mesh(geometry, material);
      nodeCache.set(n.id, mesh);
      return mesh;
    })
    .nodeVal((node: object) => getNodeRadius(node as SimNode, immediateParams.current.dotScale))
    .linkSource("source")
    .linkTarget("target")
    .linkColor((link: object) => getEdgeColor(link as SimLink, nodeMap, pcaTransform, clusterColors, immediateParams.current.colorMixRatio))
    .linkOpacity(immediateParams.current.edgeOpacity * 0.4)
    .linkWidth(1.5)
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
      // Use custom circular arc rendering with fat lines (Line2)
      const rect = container.getBoundingClientRect();

      graph
        .linkCurvature(0) // Disable built-in curves
        .linkThreeObject((link: object) => {
          const l = link as SimLink;
          const key = getLinkKey(l);

          const edgeColor = getEdgeColor(l, nodeMap, pcaTransform, clusterColors, immediateParams.current.colorMixRatio);

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
          // LineGeometry uses InstancedInterleavedBuffer internally - we'll update
          // the instanceStart/instanceEnd attributes directly in linkPositionUpdate
          // to avoid buffer recreation that setPositions() causes
          const geometry = new LineGeometry();
          const initialPositions = new Float32Array((ARC_SEGMENTS + 1) * 3);
          geometry.setPositions(initialPositions); // Called once to set up buffers

          const material = new LineMaterial({
            color: new THREE.Color(edgeColor).getHex(),
            linewidth: 2, // Width in world units
            transparent: true,
            opacity: immediateParams.current.edgeOpacity * 0.4,
            resolution: new THREE.Vector2(rect.width, rect.height),
            worldUnits: true, // Use world units so lines scale with zoom
            alphaToCoverage: true, // Reduces transparency artifacts at joints
          });

          const line = new Line2(geometry, material);
          line.computeLineDistances();
          // Disable frustum culling - the bounding box isn't updated when we
          // modify the buffer directly, causing lines to disappear when zoomed in
          line.frustumCulled = false;
          linkCache.set(key, line);
          edgeColorCache.set(key, edgeColor); // Store original color for dimming
          return line;
        })
        .linkPositionUpdate((line: object, { start, end }: { start: { x: number; y: number; z?: number }; end: { x: number; y: number; z?: number } }, link: object) => {
          const l = link as SimLink;
          const direction = curveDirections.get(l) ?? 1;
          const curveIntensity = immediateParams.current.edgeCurve;

          const line2 = line as Line2;
          const geometry = line2.geometry as LineGeometry;

          // LineGeometry converts N points into N-1 line segments
          // Each segment is stored as 6 floats: [start_x, start_y, start_z, end_x, end_y, end_z]
          // So for ARC_SEGMENTS+1 points, we have ARC_SEGMENTS segments = ARC_SEGMENTS * 6 floats
          const instanceStart = geometry.attributes.instanceStart;
          if (!instanceStart) return false;

          // Get the underlying interleaved buffer array
          const data = (instanceStart as THREE.InterleavedBufferAttribute).data;
          const array = data.array as Float32Array;

          const { x: x1, y: y1 } = start;
          const { x: x2, y: y2 } = end;

          const dx = x2 - x1;
          const dy = y2 - y1;
          const chordLength = Math.sqrt(dx * dx + dy * dy);

          // Compute arc points and write as line segments into the interleaved buffer
          // Buffer layout per segment: [start.x, start.y, start.z, end.x, end.y, end.z]
          if (curveIntensity === 0 || chordLength === 0 || Math.abs(chordLength * curveIntensity) < 0.1) {
            // Straight line - linear interpolation
            for (let i = 0; i < ARC_SEGMENTS; i++) {
              const t0 = i / ARC_SEGMENTS;
              const t1 = (i + 1) / ARC_SEGMENTS;
              const idx = i * 6;
              // Segment start point
              array[idx] = x1 + t0 * dx;
              array[idx + 1] = y1 + t0 * dy;
              array[idx + 2] = EDGE_Z_OFFSET;
              // Segment end point
              array[idx + 3] = x1 + t1 * dx;
              array[idx + 4] = y1 + t1 * dy;
              array[idx + 5] = EDGE_Z_OFFSET;
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
              // Segment start point
              array[idx] = cx + radius * Math.cos(angle0);
              array[idx + 1] = cy + radius * Math.sin(angle0);
              array[idx + 2] = EDGE_Z_OFFSET;
              // Segment end point
              array[idx + 3] = cx + radius * Math.cos(angle1);
              array[idx + 4] = cy + radius * Math.sin(angle1);
              array[idx + 5] = EDGE_Z_OFFSET;
            }
          }

          // Mark buffer as needing GPU upload (no buffer recreation)
          data.needsUpdate = true;
          line2.computeLineDistances();

          return true; // Indicates we've updated the position
        });
    }
  }

  // Apply initial curve configuration
  configureCurveRendering();

  // Convergence state (shared logic with D3 renderer)
  const convergenceState = createConvergenceState();

  // Auto-fit state (shared logic with D3 renderer)
  const autoFitState = createAutoFitState();

  // Add collision force - initially null, added when cooling starts (like D3 renderer)
  // This lets nodes spread out first, then avoid overlap during refinement
  const collisionRadius = BASE_DOT_RADIUS * DOT_SCALE_FACTOR + COLLISION_PADDING;

  // Configure simulation to match D3 renderer behavior
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphAny = graph as any;

  // Use very slow alpha decay initially to keep simulation running longer
  // D3 renderer uses alphaTarget(0.3) which we can't set directly, so we use
  // a very slow decay and periodically reheat until convergence is detected
  graphAny
    .d3AlphaDecay(0.002)     // Very slow decay to keep simulation running
    .d3VelocityDecay(0.5)    // Same as D3 renderer
    .warmupTicks(0)          // Don't pre-compute - show from the start
    .cooldownTicks(Infinity) // Let convergence logic decide when to stop
    .onEngineTick(() => {
      // Get nodes with velocity data
      const graphData = graph.graphData();
      const nodes = graphData.nodes as Array<{ vx?: number; vy?: number }>;

      // Process tick with shared convergence logic
      const { coolingJustStarted } = processSimulationTick(
        nodes,
        convergenceState,
        DEFAULT_CONVERGENCE_CONFIG
      );

      // Keep simulation hot while not cooling (reheat periodically)
      if (!convergenceState.coolingDown && convergenceState.tickCount % 50 === 0) {
        graphAny.d3ReheatSimulation();
      }

      // Periodically fit as graph grows during simulation
      if (shouldFitDuringSimulation(autoFitState, convergenceState)) {
        setTimeout(() => fitToNodesInternal(0.25), 0);
      }

      if (coolingJustStarted) {
        // Add collision force for refinement phase
        graph.d3Force("collision", forceCollide(collisionRadius));
        // Speed up decay for cooling phase
        graphAny.d3AlphaDecay(0.02);
      }

      // Fit when cooling starts (matches D3 renderer timing)
      if (shouldFitAfterCooling(autoFitState, convergenceState)) {
        markInitialFitDone(autoFitState);
        // Defer fit to avoid calling during tick
        setTimeout(() => fitToNodesInternal(0.25), 0);
      }

      // Update cluster labels on each tick (positions change during simulation)
      updateClusterLabelsInternal();
      updateKeywordLabelsInternal();
    });

  // Set initial data
  graph
    // Cast to any to bridge D3's SimulationNodeDatum (fx: number | null)
    // with 3d-force-graph's NodeObject (fx?: number | undefined)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .graphData({ nodes: currentNodes as any, links: currentLinks as any });

  // Click handler
  graph.onNodeClick((node: object) => {
    const n = node as SimNode;
    if (n.type === "keyword" && callbacks.onKeywordClick) {
      callbacks.onKeywordClick(n.label);
    } else if (n.type === "project") {
      callbacks.onProjectInteractionStart?.();
      callbacks.onProjectClick?.(n.id);
    }
  });

  // Track when dragging a project node starts (to suppress pan and click-to-filter)
  graph.onNodeDrag((node: object) => {
    const n = node as SimNode;
    if (n.type === "project") {
      isDraggingProjectNode = true;
      callbacks.onProjectInteractionStart?.();
    }
  });

  // Drag end handler - persist project positions
  graph.onNodeDragEnd((node: object) => {
    const n = node as SimNode;
    if (n.type === "project") {
      isDraggingProjectNode = false;
      projectWasDragged = true; // Suppress the click event that follows
      if (callbacks.onProjectDrag && n.x !== undefined && n.y !== undefined) {
        // Keep project fixed at new position
        n.fx = n.x;
        n.fy = n.y;
        // Persist to database
        callbacks.onProjectDrag(n.id, { x: n.x, y: n.y });
      }
    }
  });

  // Track hovered node (for suppressing neighborhood highlighting when over project)
  let hoveredNode: SimNode | null = null;
  graph.onNodeHover((node: object | null) => {
    hoveredNode = node as SimNode | null;
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
  // Track drag vs click - if mouse moves more than threshold, it's a drag
  let startMouseX = 0;
  let startMouseY = 0;
  let wasDrag = false;
  const DRAG_THRESHOLD = 5; // pixels

  // Track if we're dragging a project node (to suppress pan and click-to-filter)
  let isDraggingProjectNode = false;
  // Track if a project drag just ended (to suppress click that fires after drag)
  let projectWasDragged = false;

  const handleMouseDown = (event: MouseEvent) => {
    // Only pan on left click
    if (event.button !== 0) return;
    // Don't pan if already dragging a project node
    if (isDraggingProjectNode) return;

    // If hovering over a project node, let 3d-force-graph handle it
    // (this uses 3d-force-graph's own hit detection, which is more reliable)
    if (hoveredNode?.type === "project") {
      return;
    }

    isPanning = true;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
    startMouseX = event.clientX;
    startMouseY = event.clientY;
    wasDrag = false;
    container.style.cursor = "grabbing";
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (!isPanning) return;

    // Check if movement exceeds drag threshold
    const dx = Math.abs(event.clientX - startMouseX);
    const dy = Math.abs(event.clientY - startMouseY);
    if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
      wasDrag = true;
    }

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

    // Update labels during pan
    updateClusterLabelsInternal();
    updateKeywordLabelsInternal();
  };

  const handleMouseUp = () => {
    if (isPanning) {
      isPanning = false;
      container.style.cursor = "grab";
      markUserInteraction(autoFitState); // User has panned, stop auto-fitting

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

  // Suppress click events that were actually drags (canvas pans or project node drags)
  const handleClick = (event: MouseEvent) => {
    if (wasDrag || projectWasDragged) {
      event.stopPropagation();
    }
    // Reset for next interaction - prevents stale state from affecting
    // subsequent clicks (e.g., project node click after canvas pan)
    wasDrag = false;
    projectWasDragged = false;
  };

  container.addEventListener("mousedown", handleMouseDown);
  container.addEventListener("mousemove", handleMouseMove);
  container.addEventListener("mouseup", handleMouseUp);
  container.addEventListener("mouseleave", handleMouseUp);
  container.addEventListener("click", handleClick, true); // capture phase

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
    // Allow zooming out far enough to see large graphs at 50% screen height
    const newZ = Math.max(50, Math.min(20000, oldZ + event.deltaY * zoomSensitivity));

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
    markUserInteraction(autoFitState); // User has zoomed, stop auto-fitting

    // Update labels during zoom
    updateClusterLabelsInternal();
    updateKeywordLabelsInternal();

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
    if (!autoFitState.hasFittedInitially) {
      markInitialFitDone(autoFitState);
      fitToNodesInternal(0.25);
    }
  }, 1500);

  // Final fit when simulation fully settles (only once)
  graph.onEngineStop(() => {
    if (!autoFitState.hasFittedInitially) {
      markInitialFitDone(autoFitState);
      fitToNodesInternal(0.25);
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
    container.removeEventListener("click", handleClick, true);
  };

  // Helper to convert world coordinates to screen coordinates
  function worldToScreen(world: { x: number; y: number }): { x: number; y: number } | null {
    const camera = graph.camera();
    if (!camera) return null;

    const rect = container.getBoundingClientRect();
    const fov = (camera as THREE.PerspectiveCamera).fov * Math.PI / 180;

    // Calculate visible area at z=0
    const visibleHeight = 2 * camera.position.z * Math.tan(fov / 2);
    const visibleWidth = visibleHeight * (rect.width / rect.height);

    // Convert world to NDC
    const ndcX = (world.x - camera.position.x) / (visibleWidth / 2);
    const ndcY = (world.y - camera.position.y) / (visibleHeight / 2);

    // Convert NDC to screen coordinates
    return {
      x: ((ndcX + 1) / 2) * rect.width,
      y: ((1 - ndcY) / 2) * rect.height, // Flip Y (screen Y down, world Y up)
    };
  }

  // Label overlay manager (handles cluster and keyword labels)
  const labelManager = createLabelOverlayManager({
    container,
    worldToScreen,
    getCameraZ: () => graph.camera()?.position.z ?? 1000,
    getNodeRadius: (node) => getNodeRadius(node, immediateParams.current.dotScale) * DOT_SCALE_FACTOR,
    getClusterColors: () => clusterColors,
  });

  // Wrapper functions for tick/zoom updates
  function updateClusterLabelsInternal() {
    labelManager.updateClusterLabels(currentNodes);
  }

  function updateKeywordLabelsInternal() {
    // Get graph data with positions (3d-force-graph updates node positions in place)
    const graphData = graph.graphData();
    const graphNodes = graphData.nodes as SimNode[];
    labelManager.updateKeywordLabels(graphNodes, nodeDegrees);
  }

  return {
    isHoveringProject() {
      return hoveredNode?.type === "project";
    },

    updateData(nodes: SimNode[], links: SimLink[]) {
      // Dispose old cached objects before replacing data
      for (const mesh of nodeCache.values()) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      nodeCache.clear();

      for (const line of linkCache.values()) {
        line.geometry.dispose();
        line.material.dispose();
      }
      linkCache.clear();
      edgeColorCache.clear();

      currentNodes = nodes;
      currentLinks = links;
      // Rebuild node map for edge coloring
      nodeMap = new Map<string, SimNode>(currentNodes.map(n => [n.id, n]));
      // Recompute curve directions (same logic as D3 renderer)
      curveDirections = computeEdgeCurveDirections(
        currentNodes,
        currentLinks,
        immediateParams.current.curveMethod
      );
      currentCurveMethod = immediateParams.current.curveMethod;
      // Recompute node degrees for label visibility
      nodeDegrees = computeNodeDegrees(currentNodes.map(n => n.id), currentLinks);
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
        // Dispose old link objects before switching
        for (const line of linkCache.values()) {
          line.geometry.dispose();
          line.material.dispose();
        }
        linkCache.clear();
        edgeColorCache.clear();

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

      // Update node colors if colorMixRatio changed
      if (immediateParams.current.colorMixRatio !== currentColorMixRatio) {
        currentColorMixRatio = immediateParams.current.colorMixRatio;

        // Update all cached mesh colors
        for (const node of currentNodes) {
          const mesh = nodeCache.get(node.id);
          if (mesh) {
            mesh.material.color.set(getNodeColor(node, pcaTransform, clusterColors, currentColorMixRatio));
            mesh.material.needsUpdate = true;
          }
        }
      }
    },

    updateClusters(nodeToCluster: Map<string, number>) {
      // Update communityId on each node
      for (const node of currentNodes) {
        const clusterId = nodeToCluster.get(node.id);
        node.communityId = clusterId;
      }

      // Recompute cluster colors with new assignments
      clusterColors = computeClusterColors(groupNodesByCommunity(currentNodes), pcaTransform);

      // Update cached mesh colors in-place
      for (const node of currentNodes) {
        const mesh = nodeCache.get(node.id);
        if (mesh) {
          mesh.material.color.set(getNodeColor(node, pcaTransform, clusterColors, immediateParams.current.colorMixRatio));
          mesh.material.needsUpdate = true;
        }
      }
    },

    updateClusterLabels() {
      updateClusterLabelsInternal();
      updateKeywordLabelsInternal();
    },

    applyHighlight(highlightedIds: Set<string> | null, baseDim: number) {
      currentHighlight = highlightedIds;
      currentBaseDim = baseDim;

      // Detect current theme for background color
      const isDarkMode = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const backgroundColor = isDarkMode ? colors.background.dark : colors.background.light;

      // Compute dim amount: 0 = full color, 1 = fully dimmed (background)
      const getDimAmount = (isHighlighted: boolean): number => {
        if (highlightedIds === null) {
          // Nothing nearby - dim everything
          return baseDim;
        } else if (highlightedIds.size > 0) {
          // Highlight selected, dim others
          return isHighlighted ? 0 : baseDim;
        }
        // highlightedIds is empty Set = hover ended, restore full color
        return 0;
      };

      // Update node materials (still use opacity for nodes - they don't have joint artifacts)
      for (const [nodeId, mesh] of nodeCache) {
        const material = mesh.material;
        const dimAmount = getDimAmount(highlightedIds?.has(nodeId) ?? false);
        material.opacity = 1 - dimAmount;
        material.transparent = dimAmount > 0;
        material.needsUpdate = true;
      }

      // Update edge materials - use color mixing instead of opacity to avoid joint artifacts
      // Edge is highlighted only if both endpoints are highlighted
      for (const [linkKey, linkObj] of linkCache) {
        const originalColor = edgeColorCache.get(linkKey);
        if (!originalColor) continue;

        // Parse linkKey to get source and target IDs
        const [sourceId, targetId] = linkKey.split("->");
        const bothHighlighted = (highlightedIds?.has(sourceId) ?? false) && (highlightedIds?.has(targetId) ?? false);
        const dimAmount = getDimAmount(bothHighlighted);

        const mat = linkObj.material as LineMaterial;
        // Mix original color with background based on dim amount
        const dimmedColor = dimAmount > 0 ? dimColor(originalColor, dimAmount, backgroundColor) : originalColor;
        mat.color.set(dimmedColor);
        mat.needsUpdate = true;
      }
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

      // Dispose all cached node geometries and materials
      for (const mesh of nodeCache.values()) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      nodeCache.clear();

      // Dispose all cached link geometries and materials
      for (const line of linkCache.values()) {
        line.geometry.dispose();
        line.material.dispose();
      }
      linkCache.clear();
      edgeColorCache.clear();

      // Clean up label overlays
      labelManager.destroy();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (graph as any)._destructor?.();
      // Only remove our own canvas, not other renderers' canvases
      if (ownCanvas && ownCanvas.parentNode === container) {
        container.removeChild(ownCanvas);
      }
    },
  };
}
