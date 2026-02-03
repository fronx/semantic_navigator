/**
 * Three.js renderer for the Topics visualization using 3d-force-graph.
 * Provides WebGL-based rendering as an alternative to the D3/SVG renderer.
 *
 * This module composes several building blocks:
 * - CameraController: viewport, coordinate conversion, fit-to-nodes
 * - InputHandler: pan, zoom, click/drag detection
 * - NodeRenderer: mesh creation, caching, colors, highlighting
 * - EdgeRenderer: curve rendering (bezier/arc), link objects
 * - LabelOverlayManager: HTML labels positioned over WebGL canvas
 *
 * NOTE: This module must be dynamically imported to avoid SSR issues
 * since 3d-force-graph requires browser APIs (window, WebGL).
 */

import * as THREE from "three";
import { forceCollide } from "d3-force";
import { groupNodesByCommunity } from "@/lib/hull-renderer";
import { computeEdgeCurveDirections, type SimNode, type SimLink, type ImmediateParams } from "@/lib/map-renderer";
import { computeClusterColors, type PCATransform, type ClusterColorInfo } from "@/lib/semantic-colors";
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
import { calculateScales, type ScaleValues } from "@/lib/chunk-scale";
import {
  DEFAULT_ZOOM_PHASE_CONFIG,
  cloneZoomPhaseConfig,
  type ZoomPhaseConfig,
  normalizeZoom,
} from "@/lib/zoom-phase-config";

// Building blocks
import { createCameraController, CAMERA_FOV_DEGREES } from "./camera-controller";
import { createInputHandler } from "./input-handler";
import { createNodeRenderer, getNodeRadius, BASE_DOT_RADIUS, DOT_SCALE_FACTOR } from "./node-renderer";
import { createEdgeRenderer } from "./edge-renderer";
import { createLabelOverlayManager, computeNodeDegrees } from "./label-overlays";
import { createHullRenderer } from "./hull-renderer";
import { createBlurComposer } from "./blur-composer";

// ============================================================================
// Types
// ============================================================================

export interface ThreeRendererCallbacks {
  onKeywordClick?: (keyword: string) => void;
  onProjectClick?: (projectId: string) => void;
  onProjectDrag?: (projectId: string, position: { x: number; y: number }) => void;
  onZoom?: () => void;
  onZoomEnd?: (transform: { k: number; x: number; y: number }) => void;
  onProjectInteractionStart?: () => void;
}

export interface ThreeRenderer {
  isHoveringProject: () => boolean;
  updateData: (nodes: SimNode[], links: SimLink[]) => void;
  updateVisuals: () => void;
  updateClusters: (nodeToCluster: Map<string, number>) => void;
  updateClusterLabels: () => void;
  applyHighlight: (highlightedIds: Set<string> | null, baseDim: number) => void;
  updateScales: (cameraZ: number) => void;
  updateZoomPhases: (config: ZoomPhaseConfig) => void;
  getNodes: () => SimNode[];
  getTransform: () => { k: number; x: number; y: number };
  screenToWorld: (screen: { x: number; y: number }) => { x: number; y: number };
  fitToNodes: (padding?: number) => void;
  destroy: () => void;
}

export interface ThreeRendererOptions {
  container: HTMLElement;
  nodes: SimNode[];
  links: SimLink[];
  immediateParams: { current: ImmediateParams };
  callbacks: ThreeRendererCallbacks;
  pcaTransform?: PCATransform;
  zoomPhaseConfig?: ZoomPhaseConfig;
}

// ============================================================================
// Constants
// ============================================================================

/** Extra padding added to collision radius beyond the visual dot size */
const COLLISION_PADDING = 1;

// ============================================================================
// Renderer Factory
// ============================================================================

export async function createThreeRenderer(options: ThreeRendererOptions): Promise<ThreeRenderer> {
  const {
    container,
    nodes: initialNodes,
    links: initialLinks,
    immediateParams,
    callbacks,
    pcaTransform,
    zoomPhaseConfig: initialZoomPhaseConfig,
  } = options;

  // ---------------------------------------------------------------------------
  // Initialize 3d-force-graph
  // ---------------------------------------------------------------------------

  const ForceGraph3D = (await import("3d-force-graph")).default;
  const graph = new ForceGraph3D(container, { controlType: "orbit" });

  // Track the canvas this renderer creates (for cleanup)
  const ownCanvas = container.querySelector("canvas");
  container.style.position = "relative";

  // Track destruction state
  let destroyed = false;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let currentNodes = initialNodes;
  let currentLinks = initialLinks;
  let nodeMap = new Map<string, SimNode>(currentNodes.map(n => [n.id, n]));
  let clusterColors = computeClusterColors(groupNodesByCommunity(currentNodes), pcaTransform);
  let currentColorMixRatio = immediateParams.current.colorMixRatio;
  let zoomPhaseConfig = cloneZoomPhaseConfig(initialZoomPhaseConfig ?? DEFAULT_ZOOM_PHASE_CONFIG);

  // Curve directions for edge rendering
  let curveDirections = computeEdgeCurveDirections(currentNodes, currentLinks, immediateParams.current.curveMethod);
  let currentCurveMethod = immediateParams.current.curveMethod;
  let currentCurveType = immediateParams.current.curveType;

  // Node degrees for label visibility
  let nodeDegrees = computeNodeDegrees(currentNodes.map(n => n.id), currentLinks);

  // Convergence and auto-fit state (shared logic with D3 renderer)
  const convergenceState = createConvergenceState();
  const autoFitState = createAutoFitState();

  // Fix project nodes in place
  for (const node of currentNodes) {
    if (node.type === "project") {
      node.fx = node.x;
      node.fy = node.y;
    }
  }

  // Track hovered node
  let hoveredNode: SimNode | null = null;

  // ---------------------------------------------------------------------------
  // Building Blocks
  // ---------------------------------------------------------------------------

  const cameraController = createCameraController({
    getCamera: () => graph.camera(),
    container,
    onZoomEnd: callbacks.onZoomEnd,
  });

  const nodeRenderer = createNodeRenderer({
    immediateParams,
    pcaTransform,
    getClusterColors: () => clusterColors,
  });

  const edgeRenderer = createEdgeRenderer({
    container,
    immediateParams,
    pcaTransform,
    getNodeMap: () => nodeMap,
    getClusterColors: () => clusterColors,
    getCurveDirection: (link) => curveDirections.get(link) ?? 1,
  });

  const inputHandler = createInputHandler({
    container,
    cameraController,
    autoFitState,
    getHoveredNode: () => hoveredNode,
    onZoom: callbacks.onZoom,
    onLabelsUpdate: updateAllLabels,
  });

  const labelManager = createLabelOverlayManager({
    container,
    worldToScreen: (world) => cameraController.worldToScreen(world),
    getCameraZ: () => cameraController.getCameraZ(),
    getNodeRadius: (node) => getNodeRadius(node, immediateParams.current.dotScale) * DOT_SCALE_FACTOR,
    getClusterColors: () => clusterColors,
    getKeywordLabelRange: () => zoomPhaseConfig.keywordLabels,
  });

  const hullRenderer = createHullRenderer({
    scene: graph.scene(),
    container,
    immediateParams,
    visualScale: 1.0,
    pcaTransform,
  });

  // Initialize hull communities
  hullRenderer.updateCommunities(groupNodesByCommunity(currentNodes));

  // ---------------------------------------------------------------------------
  // Label Update Helpers
  // ---------------------------------------------------------------------------

  function updateAllLabels(): void {
    const graphData = graph.graphData();
    const graphNodes = graphData.nodes as SimNode[];
    labelManager.updateClusterLabels(graphNodes);
    labelManager.updateKeywordLabels(graphNodes, nodeDegrees);
  }

  // ---------------------------------------------------------------------------
  // Configure Graph
  // ---------------------------------------------------------------------------

  graph
    .numDimensions(2)
    .nodeId("id")
    .nodeLabel((node: object) => (node as SimNode).label)
    .nodeThreeObject((node: object) => nodeRenderer.createNodeMesh(node as SimNode))
    .nodeVal((node: object) => getNodeRadius(node as SimNode, immediateParams.current.dotScale))
    .linkSource("source")
    .linkTarget("target")
    .linkColor((link: object) => edgeRenderer.getColor(link as SimLink))
    .linkOpacity(immediateParams.current.edgeOpacity * 0.4)
    .linkWidth(1.5)
    .backgroundColor("#ffffff00")
    .showNavInfo(false)
    .enableNodeDrag(true)
    .enableNavigationControls(false);

  // Configure curve rendering based on type
  function configureCurveRendering() {
    if (currentCurveType === "bezier") {
      // Use built-in bezier curves
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (graph as any)
        .linkThreeObject(undefined)
        .linkPositionUpdate(undefined)
        .linkCurvature((link: object) => {
          const l = link as SimLink;
          const direction = curveDirections.get(l) ?? 1;
          return immediateParams.current.edgeCurve * direction;
        });
    } else {
      // Use custom arc rendering with fat lines
      graph
        .linkCurvature(0)
        .linkThreeObject((link: object) => edgeRenderer.createLinkObject(link as SimLink))
        .linkPositionUpdate((line: object, coords: { start: { x: number; y: number }; end: { x: number; y: number } }, link: object) =>
          edgeRenderer.updateLinkPosition(line as THREE.Object3D as import("three/examples/jsm/lines/Line2.js").Line2, coords, link as SimLink)
        );
    }
  }

  configureCurveRendering();

  // ---------------------------------------------------------------------------
  // Simulation Configuration
  // ---------------------------------------------------------------------------

  const collisionRadius = BASE_DOT_RADIUS * DOT_SCALE_FACTOR + COLLISION_PADDING;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphAny = graph as any;

  // Track last camera Z for optimization (only update scales when camera moves)
  let lastCameraZ = -1;
  const CAMERA_Z_THRESHOLD_RATIO = 0.01; // Only update if camera moved more than 1%
  let hasChunks = false; // Cache whether we have chunks in the scene

  function applyScaleValues(scales: ScaleValues): void {
    if (hasChunks) {
      nodeRenderer.updateNodeScales({ keywordScale: scales.keywordScale, chunkScale: scales.chunkScale });
      edgeRenderer.updateEdgeOpacity(scales.chunkEdgeOpacity);
      labelManager.updateLabelOpacity({
        keywordLabelOpacity: scales.keywordLabelOpacity,
        chunkLabelOpacity: scales.chunkLabelOpacity,
      });
    } else {
      nodeRenderer.updateNodeScales({ keywordScale: 1.0, chunkScale: 0.0 });
      edgeRenderer.updateEdgeOpacity(0);
      labelManager.updateLabelOpacity({
        keywordLabelOpacity: 1.0,
        chunkLabelOpacity: 0.0,
      });
    }
  }

  graphAny
    .d3AlphaDecay(0.002)
    .d3VelocityDecay(0.5)
    .warmupTicks(0)
    .cooldownTicks(Infinity)
    .onEngineTick(() => {
      const graphData = graph.graphData();
      const nodes = graphData.nodes as SimNode[];

      // Cache chunk detection on first run
      if (lastCameraZ === -1) {
        hasChunks = nodes.some(n => n.type === "chunk");
      }

      const { coolingJustStarted } = processSimulationTick(nodes, convergenceState, DEFAULT_CONVERGENCE_CONFIG);

      // Keep simulation hot while not cooling
      if (!convergenceState.coolingDown && convergenceState.tickCount % 50 === 0) {
        graphAny.d3ReheatSimulation();
      }

      // Periodically fit as graph grows
      if (shouldFitDuringSimulation(autoFitState, convergenceState)) {
        setTimeout(() => { if (!destroyed) fitToNodesInternal(0.25); }, 0);
      }

      if (coolingJustStarted) {
        graph.d3Force("collision", forceCollide(collisionRadius));
        graphAny.d3AlphaDecay(0.02);
      }

      if (shouldFitAfterCooling(autoFitState, convergenceState)) {
        markInitialFitDone(autoFitState);
        setTimeout(() => { if (!destroyed) fitToNodesInternal(0.25); }, 0);
      }

      // Update scales based on camera zoom (for keyword/chunk transition)
      // OPTIMIZATION: Only update if camera has moved significantly
      const cameraZ = cameraController.getCameraZ();
      const threshold = Math.abs(cameraZ) * CAMERA_Z_THRESHOLD_RATIO;
      const cameraMoved = Math.abs(cameraZ - lastCameraZ) > threshold;

      // ALWAYS update on first tick to ensure correct initial state
      const isFirstTick = lastCameraZ === -1;

      if (cameraMoved || isFirstTick) {
        lastCameraZ = cameraZ;

        const perfStart = performance.now();
        const scales = calculateScales(cameraZ, zoomPhaseConfig.chunkCrossfade);

        // Debug logging for first few ticks
        if (convergenceState.tickCount < 5 || isFirstTick) {
          console.log('[Scale Init]', 'tick:', convergenceState.tickCount, 'cameraZ:', cameraZ.toFixed(0),
            'hasChunks:', hasChunks, 'keywordScale:', scales.keywordScale.toFixed(3),
            'chunkScale:', scales.chunkScale.toFixed(3));
        }

        // Only apply scaling if we have chunk nodes in the scene (cached)
        if (hasChunks) {
          const t1 = performance.now();
          nodeRenderer.updateNodeScales({ keywordScale: scales.keywordScale, chunkScale: scales.chunkScale });
          const t2 = performance.now();
          edgeRenderer.updateEdgeOpacity(scales.chunkEdgeOpacity);
          const t3 = performance.now();
          labelManager.updateLabelOpacity({
            keywordLabelOpacity: scales.keywordLabelOpacity,
            chunkLabelOpacity: scales.chunkLabelOpacity,
          });
          const t4 = performance.now();

          // Log performance occasionally
          if (Math.random() < 0.05) {
            console.log('[Chunk Perf]',
              'Total:', (t4 - perfStart).toFixed(2), 'ms',
              'Nodes:', (t2 - t1).toFixed(2), 'ms',
              'Edges:', (t3 - t2).toFixed(2), 'ms',
              'Labels:', (t4 - t3).toFixed(2), 'ms',
              'Node count:', nodes.length);
          }
        } else {
          // No chunks - keep keywords at full scale
          nodeRenderer.updateNodeScales({ keywordScale: 1.0, chunkScale: 0.0 });
          labelManager.updateLabelOpacity({
            keywordLabelOpacity: 1.0,
            chunkLabelOpacity: 0.0,
          });
        }
      }

      hullRenderer.update();
      updateAllLabels();
    });

  // Set initial data (this starts the simulation and creates the camera)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  graph.graphData({ nodes: currentNodes as any, links: currentLinks as any });

  // ---------------------------------------------------------------------------
  // Camera Setup (IMMEDIATELY after graph initialization)
  // ---------------------------------------------------------------------------

  // Set initial camera position synchronously to avoid transient incorrect scales
  const camera = graph.camera() as THREE.PerspectiveCamera;
  if (camera) {
    camera.fov = CAMERA_FOV_DEGREES;
    camera.updateProjectionMatrix();
    camera.position.set(0, 0, 10500);
    camera.lookAt(0, 0, 0);
    console.log('[Camera Init] Set position to Z=10500');
  } else {
    console.warn('[Camera Init] Camera not available after graphData()');
  }

  // ---------------------------------------------------------------------------
  // Blur Composer Setup (post-processing for frosted glass edges)
  // ---------------------------------------------------------------------------

  const renderer = graph.renderer();
  const scene = graph.scene();

  // Capture original render function before interception
  const originalRender = renderer.render.bind(renderer);

  // Create blur composer for frosted glass edge effect
  const blurComposer = createBlurComposer({
    renderer,
    scene,
    camera,
    container,
    getBlurRadius: () => {
      const cameraZ = cameraController.getCameraZ();
      const blurRange = zoomPhaseConfig.blur;
      const fadeOut = normalizeZoom(cameraZ, blurRange);
      const strength = 1 - fadeOut;
      if (strength <= 0.001) return 0;
      return strength * zoomPhaseConfig.blur.maxRadius;
    },
    edgeRenderer,
    originalRender,
  });

  // Intercept renderer.render to inject blur post-processing
  renderer.render = () => {
    blurComposer.updateCameras();
    blurComposer.render();
  };

  // Handle window resizes
  let resizeObserverRef: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserverRef = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      blurComposer.updateSize(rect.width, rect.height);
    });
    resizeObserverRef.observe(container);
  }

  // ---------------------------------------------------------------------------
  // Event Handlers
  // ---------------------------------------------------------------------------

  graph.onNodeClick((node: object) => {
    const n = node as SimNode;
    if (n.type === "keyword" && callbacks.onKeywordClick) {
      callbacks.onKeywordClick(n.label);
    } else if (n.type === "project") {
      callbacks.onProjectInteractionStart?.();
      callbacks.onProjectClick?.(n.id);
    }
  });

  graph.onNodeDrag((node: object) => {
    const n = node as SimNode;
    if (n.type === "project") {
      inputHandler.setDraggingProject(true);
      callbacks.onProjectInteractionStart?.();
    }
  });

  graph.onNodeDragEnd((node: object) => {
    const n = node as SimNode;
    if (n.type === "project") {
      inputHandler.setDraggingProject(false);
      inputHandler.markProjectDragged();
      if (callbacks.onProjectDrag && n.x !== undefined && n.y !== undefined) {
        n.fx = n.x;
        n.fy = n.y;
        callbacks.onProjectDrag(n.id, { x: n.x, y: n.y });
      }
    }
  });

  graph.onNodeHover((node: object | null) => {
    hoveredNode = node as SimNode | null;
  });


  // ---------------------------------------------------------------------------
  // Fit-to-Nodes
  // ---------------------------------------------------------------------------

  function fitToNodesInternal(padding = 0.2) {
    const graphData = graph.graphData();
    const nodes = graphData.nodes as Array<{ x?: number; y?: number }>;
    cameraController.fitToNodes(nodes, padding);
  }

  // Early fit after ~1.5 seconds
  const earlyFitTimeout = setTimeout(() => {
    if (!autoFitState.hasFittedInitially) {
      markInitialFitDone(autoFitState);
      fitToNodesInternal(0.25);
    }
  }, 1500);

  // Final fit when simulation settles
  graph.onEngineStop(() => {
    if (!autoFitState.hasFittedInitially) {
      markInitialFitDone(autoFitState);
      fitToNodesInternal(0.25);
    }
    cameraController.notifyZoomChange();
  });

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    isHoveringProject() {
      return hoveredNode?.type === "project";
    },

    updateData(nodes: SimNode[], links: SimLink[]) {
      nodeRenderer.dispose();
      edgeRenderer.dispose();

      currentNodes = nodes;
      hasChunks = currentNodes.some(n => n.type === "chunk");
      currentLinks = links;
      nodeMap = new Map<string, SimNode>(currentNodes.map(n => [n.id, n]));

      curveDirections = computeEdgeCurveDirections(currentNodes, currentLinks, immediateParams.current.curveMethod);
      currentCurveMethod = immediateParams.current.curveMethod;
      nodeDegrees = computeNodeDegrees(currentNodes.map(n => n.id), currentLinks);

      // Update hull communities with new node set
      hullRenderer.updateCommunities(groupNodesByCommunity(currentNodes));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graph.graphData({ nodes: currentNodes as any, links: currentLinks as any });
    },

    updateVisuals() {
      // Recompute curve directions if method changed
      if (immediateParams.current.curveMethod !== currentCurveMethod) {
        curveDirections = computeEdgeCurveDirections(currentNodes, currentLinks, immediateParams.current.curveMethod);
        currentCurveMethod = immediateParams.current.curveMethod;
      }

      // Reconfigure curve rendering if type changed
      if (immediateParams.current.curveType !== currentCurveType) {
        edgeRenderer.dispose();
        currentCurveType = immediateParams.current.curveType;
        configureCurveRendering();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        graph.graphData({ nodes: currentNodes as any, links: currentLinks as any });
      }

      // Force re-render of links
      if (currentCurveType === "bezier") {
        graph.linkCurvature(graph.linkCurvature());
      }
      graph.linkOpacity(immediateParams.current.edgeOpacity * 0.4);

      // Update colors if colorMixRatio changed
      if (immediateParams.current.colorMixRatio !== currentColorMixRatio) {
        currentColorMixRatio = immediateParams.current.colorMixRatio;
        nodeRenderer.refreshColors(currentNodes);
        edgeRenderer.refreshColors();
      }

      // Update hull visuals (opacity may have changed)
      hullRenderer.update();
    },

    updateClusters(nodeToCluster: Map<string, number>) {
      clusterColors = nodeRenderer.updateClusters(currentNodes, nodeToCluster);
      nodeRenderer.refreshColors(currentNodes);
      edgeRenderer.refreshColors();
      hullRenderer.updateCommunities(groupNodesByCommunity(currentNodes));
    },

    updateClusterLabels() {
      updateAllLabels();
    },

    applyHighlight(highlightedIds: Set<string> | null, baseDim: number) {
      nodeRenderer.updateHighlight(highlightedIds, baseDim);
      edgeRenderer.updateHighlight(highlightedIds, baseDim);
    },

    updateZoomPhases(config: ZoomPhaseConfig) {
      zoomPhaseConfig = cloneZoomPhaseConfig(config);
      lastCameraZ = -1;
      const cameraZ = cameraController.getCameraZ();
      const scales = calculateScales(cameraZ, zoomPhaseConfig.chunkCrossfade);
      applyScaleValues(scales);
    },

    updateScales(cameraZ: number) {
      const scales = calculateScales(cameraZ, zoomPhaseConfig.chunkCrossfade);
      applyScaleValues(scales);
    },

    getNodes() {
      return currentNodes;
    },

    getTransform() {
      return cameraController.getTransform();
    },

    screenToWorld(screen: { x: number; y: number }) {
      return cameraController.screenToWorld(screen);
    },

    fitToNodes(padding = 0.2) {
      fitToNodesInternal(padding);
    },

    destroy() {
      destroyed = true;
      cameraController.cancelAnimation();
      if (earlyFitTimeout) clearTimeout(earlyFitTimeout);

      // Cleanup blur composer and resize observer
      if (resizeObserverRef) {
        resizeObserverRef.disconnect();
        resizeObserverRef = null;
      }
      blurComposer.dispose();

      inputHandler.destroy();
      nodeRenderer.dispose();
      edgeRenderer.dispose();
      hullRenderer.dispose();
      labelManager.destroy();

      // Dispose WebGL resources
      try {
        const renderer = graph.renderer();
        if (renderer) {
          renderer.dispose();
          renderer.forceContextLoss();
        }

        const scene = graph.scene();
        if (scene) {
          scene.traverse((object: THREE.Object3D) => {
            if ((object as THREE.Mesh).geometry) {
              (object as THREE.Mesh).geometry.dispose();
            }
            const mesh = object as THREE.Mesh;
            if (mesh.material) {
              if (Array.isArray(mesh.material)) {
                mesh.material.forEach((mat) => mat.dispose());
              } else {
                mesh.material.dispose();
              }
            }
          });
          scene.clear();
        }
      } catch (e) {
        console.warn("Error during WebGL cleanup:", e);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (graph as any)._destructor?.();

      if (ownCanvas && ownCanvas.parentNode === container) {
        container.removeChild(ownCanvas);
      }
    },
  };
}
