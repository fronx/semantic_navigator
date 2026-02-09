/**
 * Scene coordinator for R3F Topics renderer.
 * Orchestrates all child components (camera, simulation, nodes, edges, labels).
 */

import { useState, useMemo, useEffect, useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { CameraController } from "./CameraController";
import { ForceSimulation } from "./ForceSimulation";
import { UnifiedSimulation } from "./UnifiedSimulation";
import { KeywordNodes } from "./KeywordNodes";
import { ContentNodes } from "./ContentNodes";
import { ContentTextLabels3D } from "./ContentTextLabels3D";
import { TransmissionPanel } from "./TransmissionPanel";
import { KeywordEdges } from "./KeywordEdges";
import { ContentEdges } from "./ContentEdges";
import { MarkdownTextBillboard } from "./MarkdownTextBillboard";
import { useEdgeCurveDirections } from "@/hooks/useEdgeCurveDirections";
import { useContentSimulation } from "@/hooks/useContentSimulation";
import { createContentNodes, type ContentSimNode } from "@/lib/content-layout";
import { computeNodeDegrees } from "@/lib/graph-degrees";
import { groupNodesByCommunity } from "@/lib/hull-renderer";
import { computeClusterColors, type ClusterColorInfo } from "@/lib/semantic-colors";
import { calculateBoundingBox, calculateCameraZForBounds } from "@/lib/dynamic-zoom-bounds";
import { CAMERA_Z_MAX } from "@/lib/content-zoom-config";
import { BASE_DOT_RADIUS, DOT_SCALE_FACTOR, getGlobalContrastParams } from "@/lib/three/node-renderer";
import type { KeywordNode, SimilarityEdge, ProjectNode } from "@/lib/graph-queries";
import type { PCATransform } from "@/lib/semantic-colors";
import type { SimNode, SimLink } from "@/lib/map-renderer";
import type { ZoomPhaseConfig } from "@/lib/zoom-phase-config";
import type { LabelRefs } from "./R3FLabelContext";
import type { ContentNode } from "@/lib/content-loader";
import type { KeywordTierMap } from "@/lib/topics-filter";
import type { FocusState } from "@/lib/focus-mode";
import { ClusterLabels3D } from "./ClusterLabels3D";
import { KeywordLabels3D } from "./KeywordLabels3D";
import { computeLabelFade } from "@/lib/label-fade-coordinator";

/**
 * Group nodes by cluster ID from nodeToCluster map.
 * Helper for computing cluster colors based on Leiden clustering.
 */
function groupNodesByMap(nodes: SimNode[], nodeToCluster: Map<string, number>): Map<number, SimNode[]> {
  const map = new Map<number, SimNode[]>();
  for (const node of nodes) {
    const clusterId = nodeToCluster.get(node.id);
    if (clusterId === undefined) continue;

    if (!map.has(clusterId)) {
      map.set(clusterId, []);
    }
    map.get(clusterId)!.push(node);
  }
  return map;
}

const ENABLE_MARKDOWN_TEST = false;
const FORCE_SAMPLE_MARKDOWN = true;

export interface R3FTopicsSceneProps {
  nodes: KeywordNode[];
  /** Total keyword count before filtering — used for stable instancedMesh allocation */
  totalKeywordCount: number;
  edges: SimilarityEdge[];
  projectNodes: ProjectNode[];
  contentsByKeyword?: Map<string, ContentNode[]>;
  colorMixRatio: number;
  colorDesaturation: number;
  pcaTransform: PCATransform | null;
  blurEnabled?: boolean;
  /** Show k-NN connectivity edges (usually hidden, only affect force simulation) */
  showKNNEdges?: boolean;
  panelDistanceRatio: number;
  panelThickness: number;
  zoomPhaseConfig: ZoomPhaseConfig;
  /** Z-depth offset for content nodes (negative = behind keywords) */
  contentZDepth?: number;
  /** Scale factor for converting panel thickness to content text depth offset */
  contentTextDepthScale?: number;
  /** Size multiplier for keyword nodes (default 1.0) */
  keywordSizeMultiplier?: number;
  /** Size multiplier for content nodes (default 1.5) */
  contentSizeMultiplier?: number;
  /** Text contrast for adjusting content node background brightness: 0 = low contrast, 1 = high contrast */
  contentTextContrast?: number;
  /** Spring force strength for content node tethering (0.01-1.0, default 0.1) */
  contentSpringStrength?: number;
  /** Charge force strength for node repulsion (negative = repel, default -200) */
  chargeStrength?: number;
  /** Use unified simulation (keywords + content in single simulation) instead of separate simulations */
  unifiedSimulation?: boolean;
  /** Transmission panel roughness */
  panelRoughness?: number;
  /** Transmission panel transparency */
  panelTransmission?: number;
  /** Transmission panel anisotropic blur strength */
  panelAnisotropicBlur?: number;
  keywordTiers?: KeywordTierMap | null;
  /** Focus state for click-to-focus interaction */
  focusState?: FocusState | null;
  /** Shared ref for focus-animated positions (written by KeywordNodes, read by edges + labels) */
  focusPositionsRef?: React.MutableRefObject<Map<string, { x: number; y: number }>>;
  /** Search opacity map (node id -> opacity) for semantic search highlighting */
  searchOpacities?: Map<string, number>;
  /** Current camera Z position for zoom-dependent effects */
  cameraZ?: number;
  /** Runtime cluster IDs map (for label rendering) */
  nodeToCluster?: Map<string, number>;
  onProjectClick?: (projectId: string) => void;
  onProjectDrag?: (projectId: string, position: { x: number; y: number }) => void;
  onZoomChange?: (zoomScale: number) => void;
  /** Handler for keyword node click */
  onKeywordClick?: (keywordId: string) => void;
  /** Handler for keyword hover (shared with overlay + hover controller) */
  onKeywordHover?: (keywordId: string | null) => void;
  /** Handler for cluster label click */
  onClusterLabelClick?: (clusterId: number) => void;
  /** Refs for label rendering (bridging to DOM overlay) */
  labelRefs: LabelRefs;
  /** Cursor position for 3D text proximity filtering */
  cursorPosition: { x: number; y: number } | null;
  /** Ref for flyTo animation (populated by CameraController) */
  flyToRef?: React.MutableRefObject<((x: number, y: number) => void) | null>;
}

export function R3FTopicsScene({
  nodes,
  totalKeywordCount,
  edges,
  projectNodes,
  contentsByKeyword,
  colorMixRatio,
  colorDesaturation,
  pcaTransform,
  blurEnabled = true,
  showKNNEdges = false,
  panelDistanceRatio,
  panelThickness,
  zoomPhaseConfig,
  contentZDepth = -150,
  contentTextDepthScale = -15.0,
  keywordSizeMultiplier = 1.0,
  contentSizeMultiplier = 1.5,
  contentTextContrast = 0.7,
  contentSpringStrength = 0.1,
  chargeStrength = -200,
  unifiedSimulation = false,
  panelRoughness,
  panelTransmission,
  panelAnisotropicBlur,
  keywordTiers,
  focusState,
  focusPositionsRef,
  searchOpacities,
  cameraZ,
  nodeToCluster,
  onProjectClick,
  onProjectDrag,
  onZoomChange,
  onKeywordClick,
  onKeywordHover,
  onClusterLabelClick,
  labelRefs,
  cursorPosition,
  flyToRef,
}: R3FTopicsSceneProps) {
  // Level 1: Simulation nodes
  // - Unified mode: all nodes (keywords + content) from UnifiedSimulation
  // - Separate mode: keywords from ForceSimulation, content added separately
  const [keywordNodes, setKeywordNodes] = useState<SimNode[]>([]);
  const [unifiedNodes, setUnifiedNodes] = useState<(SimNode | ContentSimNode)[]>([]);
  const [clusterColors, setClusterColors] = useState<Map<number, ClusterColorInfo>>(new Map());

  // Unified simulation tick method (manual frame-sync to prevent jitter)
  const unifiedSimTickRef = useRef<(() => void) | null>(null);

  // Visible keyword label IDs (written by KeywordLabels3D, read by ContentNodes)
  const visibleLabelIdsRef = useRef<Set<string>>(new Set());
  const visibleContentIdsRef = useRef<Set<string>>(new Set());
  const primaryKeywordIdsRef = useRef<Set<string>>(new Set());
  const contentDrivenKeywordIdsRef = useRef<Set<string>>(new Set());


  // Calculate stable max content node count (available immediately from contentsByKeyword)
  const contentNodeCount = useMemo(() => {
    if (!contentsByKeyword || contentsByKeyword.size === 0) return 0;

    let count = 0;
    for (const chunks of contentsByKeyword.values()) {
      count += chunks.length;
    }
    return count;
  }, [contentsByKeyword]);

  // Level 2: Create content nodes from content data
  const contentNodes = useMemo(() => {
    if (!contentsByKeyword || contentsByKeyword.size === 0 || keywordNodes.length === 0) {
      return [];
    }

    const { contentNodes: nodes } = createContentNodes(keywordNodes, contentsByKeyword);
    return nodes;
  }, [keywordNodes, contentsByKeyword]);

  const prototypeMarkdown = useMemo(() => {
    if (FORCE_SAMPLE_MARKDOWN) {
      return null;
    }
    if (!contentsByKeyword || contentsByKeyword.size === 0) {
      return null;
    }

    for (const chunks of contentsByKeyword.values()) {
      const chunk = chunks.find((item) => item.content && item.content.trim().length > 0);
      if (chunk) {
        return chunk.content;
      }
    }

    return null;
  }, [contentsByKeyword]);

  // Build keyword map for content simulation
  const keywordMap = useMemo(() => {
    return new Map<string, SimNode>(keywordNodes.map(n => [n.id, n]));
  }, [keywordNodes]);

  // Level 2: Content simulation (only in separate mode)
  const keywordRadius = BASE_DOT_RADIUS * DOT_SCALE_FACTOR;
  const contentSimulation = useContentSimulation({
    contentNodes: unifiedSimulation ? [] : contentNodes, // Disable in unified mode
    keywords: keywordMap,
    keywordRadius,
    contentSizeMultiplier,
    springStrength: contentSpringStrength,
  });

  // Tick simulations every frame (manual frame-sync prevents jitter)
  // Also update cursor world position from screen coords + current camera (stays accurate during panning)
  useFrame(() => {
    // Update camera state ref (read by R3FTopicsCanvas for cursor world-position)
    labelRefs.cameraStateRef.current = {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
    };

    if (unifiedSimulation) {
      // Manual tick for unified simulation (frame-synced)
      unifiedSimTickRef.current?.();
    } else {
      // Manual tick for separate content simulation
      contentSimulation.tick();
    }

    if (!cursorPosition) {
      // Fallback to camera center when mouse isn't hovering
      labelRefs.cursorWorldPosRef.current = {
        x: camera.position.x,
        y: camera.position.y,
      };
      return;
    }
    const fov = (camera as import("three").PerspectiveCamera).fov * Math.PI / 180;
    const visibleHeight = 2 * camera.position.z * Math.tan(fov / 2);
    const visibleWidth = visibleHeight * (size.width / size.height);
    const ndcX = (cursorPosition.x / size.width) * 2 - 1;
    const ndcY = -((cursorPosition.y / size.height) * 2 - 1);
    labelRefs.cursorWorldPosRef.current = {
      x: camera.position.x + ndcX * (visibleWidth / 2),
      y: camera.position.y + ndcY * (visibleHeight / 2),
    };
  });

  // Combine keyword and content nodes for rendering
  const simNodes = useMemo(() => {
    if (unifiedSimulation) {
      return unifiedNodes; // Already combined by UnifiedSimulation
    }
    return [...keywordNodes, ...contentNodes]; // Separate simulations
  }, [unifiedSimulation, unifiedNodes, keywordNodes, contentNodes]);

  // Extract keyword and content nodes for rendering (works for both modes)
  const renderKeywordNodes = useMemo(() => {
    return simNodes.filter(n => n.type === "keyword") as SimNode[];
  }, [simNodes]);

  const renderContentNodes = useMemo(() => {
    return simNodes.filter(n => n.type !== "keyword") as ContentSimNode[];
  }, [simNodes]);

  // Update labelRefs when simNodes change (for label rendering)
  useEffect(() => {
    labelRefs.simNodesRef.current = simNodes;

    if (simNodes.length === 0) {
      labelRefs.nodeDegreesRef.current = new Map();
      const empty = new Map<number, ClusterColorInfo>();
      labelRefs.clusterColorsRef.current = empty;
      setClusterColors(empty);
      return;
    }

    const degrees = computeNodeDegrees(
      simNodes.map(n => n.id),
      edges as SimLink[]
    );
    labelRefs.nodeDegreesRef.current = degrees;

    const runtimeClusterMap = nodeToCluster ?? labelRefs.nodeToClusterRef.current;
    const grouped = runtimeClusterMap && runtimeClusterMap.size > 0
      ? groupNodesByMap(simNodes, runtimeClusterMap)
      : groupNodesByCommunity(simNodes);
    const colors = computeClusterColors(grouped, pcaTransform ?? undefined);
    labelRefs.clusterColorsRef.current = colors;
    setClusterColors(new Map(colors));
    // labelRefs excluded: it's a memoized bag of stable useRef values
  }, [simNodes, edges, pcaTransform, nodeToCluster]);

  // Build adjacency map for edge pulling (node ID -> neighbors)
  const adjacencyMap = useMemo(() => {
    const map = new Map<string, Array<{ id: string; similarity: number }>>();
    for (const edge of edges) {
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target;
      const similarity = (edge as any).similarity ?? 1.0;

      if (!map.has(sourceId)) map.set(sourceId, []);
      if (!map.has(targetId)) map.set(targetId, []);

      map.get(sourceId)!.push({ id: targetId, similarity });
      map.get(targetId)!.push({ id: sourceId, similarity });
    }
    return map;
  }, [edges]);

  // Compute curve directions ONLY for similarity edges
  const curveDirections = useEdgeCurveDirections(simNodes, edges as SimLink[]);

  const { size, camera } = useThree();

  // Cross-fade between cluster labels and keyword labels based on zoom
  const labelFadeT = computeLabelFade(cameraZ ?? camera.position.z, zoomPhaseConfig.keywordLabels);

  // Calculate dynamic max zoom distance based on visible node positions
  const maxDistance = useMemo(() => {
    if (simNodes.length === 0) {
      return CAMERA_Z_MAX; // Fallback to default
    }

    const bounds = calculateBoundingBox(simNodes);
    if (!bounds) {
      return CAMERA_Z_MAX; // No valid positions yet
    }

    // Calculate required camera Z with 50% margin (1.5x multiplier)
    return calculateCameraZForBounds(bounds, size, 1.5);
  }, [simNodes, size]);

  return (
    <>
      <CameraController onZoomChange={onZoomChange} maxDistance={maxDistance} flyToRef={flyToRef} />

      {/* Simulation: unified or separate */}
      {unifiedSimulation ? (
        <UnifiedSimulation
          keywordNodes={nodes}
          contentsByKeyword={contentsByKeyword}
          edges={edges}
          chargeStrength={chargeStrength}
          springStrength={contentSpringStrength}
          contentSizeMultiplier={contentSizeMultiplier}
          onSimulationReady={setUnifiedNodes}
          onTickReady={(tick) => { unifiedSimTickRef.current = tick; }}
          cameraZ={cameraZ}
        />
      ) : (
        <ForceSimulation
          nodes={nodes}
          edges={edges}
          chargeStrength={chargeStrength}
          onSimulationReady={setKeywordNodes}
          cameraZ={cameraZ}
        />
      )}

      {/* Content layer (furthest back, z < 0) */}
      {renderContentNodes.length > 0 && (
        <ContentNodes
          nodeCount={contentNodeCount}
          contentNodes={renderContentNodes}
          simNodes={simNodes}
          colorMixRatio={colorMixRatio}
          colorDesaturation={colorDesaturation}
          pcaTransform={pcaTransform}
          zoomRange={zoomPhaseConfig.chunkCrossfade}
          contentZDepth={contentZDepth}
          panelThickness={panelThickness}
          contentTextDepthScale={contentTextDepthScale}
          contentSizeMultiplier={contentSizeMultiplier}
          contentTextContrast={contentTextContrast}
          contentScreenRectsRef={labelRefs.contentScreenRectsRef}
          searchOpacities={searchOpacities}
          pulledContentPositionsRef={labelRefs.pulledContentPositionsRef}
          focusPositionsRef={focusPositionsRef}
          visibleContentIdsRef={visibleContentIdsRef}
          primaryKeywordIdsRef={primaryKeywordIdsRef}
          contentDrivenKeywordIdsRef={contentDrivenKeywordIdsRef}
        />
      )}

      {renderContentNodes.length > 0 && (
        <ContentTextLabels3D
          nodes={renderContentNodes}
          visibleContentIdsRef={visibleContentIdsRef}
          pulledContentPositionsRef={labelRefs.pulledContentPositionsRef}
          searchOpacities={searchOpacities}
          zoomRange={zoomPhaseConfig.chunkCrossfade}
          contentZDepth={contentZDepth}
          panelThickness={panelThickness}
          contentTextDepthScale={contentTextDepthScale}
          contentSizeMultiplier={contentSizeMultiplier}
          contentScreenRectsRef={labelRefs.contentScreenRectsRef}
        />
      )}

      {/* Frosted glass panel (between content nodes and keywords) */}
      <TransmissionPanel
        enabled={blurEnabled && renderContentNodes.length > 0}
        distanceRatio={panelDistanceRatio}
        thickness={panelThickness}
        roughness={panelRoughness}
        transmission={panelTransmission}
        anisotropicBlur={panelAnisotropicBlur}
      />

      {/* Content containment edges (keyword → content node) */}
      {/* Only shown in unified mode to visualize multi-parent relationships */}
      {unifiedSimulation && renderKeywordNodes.length > 0 && renderContentNodes.length > 0 && (
        <ContentEdges
          simNodes={renderKeywordNodes}
          contentNodes={renderContentNodes}
          contentZDepth={contentZDepth}
          curveIntensity={0.25}
          curveDirections={curveDirections}
          colorMixRatio={colorMixRatio}
          colorDesaturation={colorDesaturation}
          pcaTransform={pcaTransform ?? undefined}
          searchOpacities={searchOpacities}
          hoveredKeywordIdRef={labelRefs.hoveredKeywordIdRef}
          pulledPositionsRef={labelRefs.pulledPositionsRef}
          pulledContentPositionsRef={labelRefs.pulledContentPositionsRef}
          focusPositionsRef={focusPositionsRef}
          keywordTiers={keywordTiers}
          zoomRange={zoomPhaseConfig.chunkCrossfade}
          primaryKeywordIdsRef={primaryKeywordIdsRef}
        />
      )}

      {/* Keyword similarity edges - constant opacity */}
      {renderKeywordNodes.length > 0 && edges.length > 0 && (
        <KeywordEdges
          simNodes={renderKeywordNodes}
          edges={edges as SimLink[]}
          curveIntensity={0.25}
          curveDirections={curveDirections}
          colorMixRatio={colorMixRatio}
          colorDesaturation={colorDesaturation}
          pcaTransform={pcaTransform ?? undefined}
          showKNNEdges={showKNNEdges}
          searchOpacities={searchOpacities}
          hoveredKeywordIdRef={labelRefs.hoveredKeywordIdRef}
          pulledPositionsRef={labelRefs.pulledPositionsRef}
          focusPositionsRef={focusPositionsRef}
          keywordTiers={keywordTiers}
        />
      )}

      {/* Keyword layer */}
      {renderKeywordNodes.length > 0 && (
        <KeywordNodes
          nodeCount={totalKeywordCount}
          simNodes={renderKeywordNodes}
          colorMixRatio={colorMixRatio}
          colorDesaturation={colorDesaturation}
          pcaTransform={pcaTransform}
          clusterColors={clusterColors}
          zoomRange={zoomPhaseConfig.chunkCrossfade}
          keywordSizeMultiplier={keywordSizeMultiplier}
          keywordTiers={keywordTiers}
          focusState={focusState}
          focusPositionsRef={focusPositionsRef}
          searchOpacities={searchOpacities}
          onKeywordClick={onKeywordClick}
          onKeywordHover={onKeywordHover}
          hoveredKeywordIdRef={labelRefs.hoveredKeywordIdRef}
          adjacencyMap={adjacencyMap}
          pulledPositionsRef={labelRefs.pulledPositionsRef}
          flyToRef={flyToRef}
          contentDrivenKeywordIdsRef={contentDrivenKeywordIdsRef}
        />
      )}

      {renderKeywordNodes.length > 0 && (
        <ClusterLabels3D
          nodes={renderKeywordNodes}
          clusterColors={clusterColors}
          nodeToCluster={nodeToCluster}
          searchOpacities={searchOpacities}
          onClusterLabelClick={onClusterLabelClick}
          labelZ={0}
          colorDesaturation={colorDesaturation}
          globalContrast={getGlobalContrastParams().amount}
          labelFadeT={labelFadeT}
          focusState={focusState}
        />
      )}

      {renderKeywordNodes.length > 0 && (
        <KeywordLabels3D
          nodes={renderKeywordNodes}
          clusterColors={clusterColors}
          pcaTransform={pcaTransform}
          colorMixRatio={colorMixRatio}
          colorDesaturation={colorDesaturation}
          searchOpacities={searchOpacities}
          keywordTiers={keywordTiers}
          pulledPositionsRef={labelRefs.pulledPositionsRef}
          focusPositionsRef={focusPositionsRef}
          hoveredKeywordIdRef={labelRefs.hoveredKeywordIdRef}
          cursorWorldPosRef={labelRefs.cursorWorldPosRef}
          labelFadeT={labelFadeT}
          zoomRange={zoomPhaseConfig.chunkCrossfade}
          visibleLabelIdsRef={visibleLabelIdsRef}
          flyToRef={flyToRef}
          onKeywordHover={onKeywordHover}
          onKeywordClick={onKeywordClick}
        />
      )}

      {ENABLE_MARKDOWN_TEST && (
        <MarkdownTextBillboard markdown={prototypeMarkdown} />
      )}
    </>
  );
}
