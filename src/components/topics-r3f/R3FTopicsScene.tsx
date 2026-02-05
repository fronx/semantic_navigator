/**
 * Scene coordinator for R3F Topics renderer.
 * Orchestrates all child components (camera, simulation, nodes, edges, labels).
 */

import { useState, useMemo, useEffect } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { CameraController } from "./CameraController";
import { ForceSimulation } from "./ForceSimulation";
import { KeywordNodes } from "./KeywordNodes";
import { ChunkNodes } from "./ChunkNodes";
import { TransmissionPanel } from "./TransmissionPanel";
import { KeywordEdges } from "./KeywordEdges";
import { ChunkEdges } from "./ChunkEdges";
import { LabelsUpdater } from "./LabelsUpdater";
import { useEdgeCurveDirections } from "@/hooks/useEdgeCurveDirections";
import { useChunkSimulation } from "@/hooks/useChunkSimulation";
import { createChunkNodes } from "@/lib/chunk-layout";
import { computeNodeDegrees } from "@/lib/label-overlays";
import { groupNodesByCommunity } from "@/lib/hull-renderer";
import { computeClusterColors } from "@/lib/semantic-colors";
import { calculateBoundingBox, calculateCameraZForBounds } from "@/lib/dynamic-zoom-bounds";
import { CAMERA_Z_MAX } from "@/lib/chunk-zoom-config";
import { BASE_DOT_RADIUS, DOT_SCALE_FACTOR } from "@/lib/three/node-renderer";
import type { KeywordNode, SimilarityEdge, ProjectNode } from "@/lib/graph-queries";
import type { PCATransform } from "@/lib/semantic-colors";
import type { SimNode, SimLink } from "@/lib/map-renderer";
import type { ZoomPhaseConfig } from "@/lib/zoom-phase-config";
import type { LabelRefs } from "./R3FLabelContext";
import type { ChunkNode } from "@/lib/chunk-loader";
import type { KeywordTierMap } from "@/lib/topics-filter";

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

export interface R3FTopicsSceneProps {
  nodes: KeywordNode[];
  edges: SimilarityEdge[];
  projectNodes: ProjectNode[];
  chunksByKeyword?: Map<string, ChunkNode[]>;
  colorMixRatio: number;
  colorDesaturation: number;
  pcaTransform: PCATransform | null;
  blurEnabled?: boolean;
  /** Show k-NN connectivity edges (usually hidden, only affect force simulation) */
  showKNNEdges?: boolean;
  panelDistanceRatio: number;
  panelThickness: number;
  zoomPhaseConfig: ZoomPhaseConfig;
  /** Z-depth offset for chunk nodes (negative = behind keywords) */
  chunkZDepth?: number;
  /** Scale factor for converting panel thickness to chunk text depth offset */
  chunkTextDepthScale?: number;
  /** Size multiplier for chunk/article nodes (default 1.5) */
  chunkSizeMultiplier?: number;
  keywordTiers?: KeywordTierMap | null;
  /** Search opacity map (node id -> opacity) for semantic search highlighting */
  searchOpacities?: Map<string, number>;
  onProjectClick?: (projectId: string) => void;
  onProjectDrag?: (projectId: string, position: { x: number; y: number }) => void;
  onZoomChange?: (zoomScale: number) => void;
  /** Refs for label rendering (bridging to DOM overlay) */
  labelRefs: LabelRefs;
  /** Cursor position for 3D text proximity filtering */
  cursorPosition: { x: number; y: number } | null;
}

export function R3FTopicsScene({
  nodes,
  edges,
  projectNodes,
  chunksByKeyword,
  colorMixRatio,
  colorDesaturation,
  pcaTransform,
  blurEnabled = true,
  showKNNEdges = false,
  panelDistanceRatio,
  panelThickness,
  zoomPhaseConfig,
  chunkZDepth = -150,
  chunkTextDepthScale = -15.0,
  chunkSizeMultiplier = 1.5,
  keywordTiers,
  searchOpacities,
  onProjectClick,
  onProjectDrag,
  onZoomChange,
  labelRefs,
  cursorPosition,
}: R3FTopicsSceneProps) {
  // Level 1: Keyword simulation nodes (from ForceSimulation)
  const [keywordNodes, setKeywordNodes] = useState<SimNode[]>([]);

  // Level 2: Create chunk nodes from chunks data
  const chunkNodes = useMemo(() => {
    if (!chunksByKeyword || chunksByKeyword.size === 0 || keywordNodes.length === 0) {
      console.log('[R3FTopicsScene] No chunks - chunksByKeyword size:', chunksByKeyword?.size, 'keywordNodes:', keywordNodes.length);
      return [];
    }

    const { chunkNodes: chunks } = createChunkNodes(keywordNodes, chunksByKeyword);
    console.log('[R3FTopicsScene] Created', chunks.length, 'chunk nodes');

    return chunks;
  }, [keywordNodes, chunksByKeyword]);

  // Build keyword map for chunk simulation
  const keywordMap = useMemo(() => {
    return new Map<string, SimNode>(keywordNodes.map(n => [n.id, n]));
  }, [keywordNodes]);

  // Level 2: Chunk simulation (separate from keyword simulation)
  const keywordRadius = BASE_DOT_RADIUS * DOT_SCALE_FACTOR;
  const chunkSimulation = useChunkSimulation({
    chunks: chunkNodes,
    keywords: keywordMap,
    keywordRadius,
    chunkSizeMultiplier,
  });

  // Tick chunk simulation every frame
  useFrame(() => {
    chunkSimulation.tick();
  });

  // Combine keyword and chunk nodes for rendering
  const simNodes = useMemo(() => {
    return [...keywordNodes, ...chunkNodes];
  }, [keywordNodes, chunkNodes]);

  // Update labelRefs when simNodes change (for label rendering)
  useEffect(() => {
    labelRefs.simNodesRef.current = simNodes;

    // Compute node degrees for keyword label visibility
    if (simNodes.length > 0) {
      const degrees = computeNodeDegrees(
        simNodes.map(n => n.id),
        edges as SimLink[]
      );
      labelRefs.nodeDegreesRef.current = degrees;

      // Compute cluster colors for label coloring
      // Use Leiden cluster IDs from nodeToClusterRef if available, otherwise fall back to node.communityId
      const nodeToCluster = labelRefs.nodeToClusterRef.current;
      const grouped = nodeToCluster.size > 0
        ? groupNodesByMap(simNodes, nodeToCluster)
        : groupNodesByCommunity(simNodes);
      const colors = computeClusterColors(grouped, pcaTransform ?? undefined);
      labelRefs.clusterColorsRef.current = colors;
    }
  }, [simNodes, edges, pcaTransform, labelRefs]);

  // Compute curve directions ONLY for similarity edges
  const curveDirections = useEdgeCurveDirections(simNodes, edges as SimLink[]);

  // Calculate dynamic max zoom distance based on visible node positions
  const { size } = useThree();
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
      <CameraController onZoomChange={onZoomChange} maxDistance={maxDistance} />

      {/* Labels updater - updates camera state and triggers label renders */}
      <LabelsUpdater labelRefs={labelRefs} />

      <ForceSimulation
        nodes={nodes}
        edges={edges}
        onSimulationReady={setKeywordNodes}
      />

      {/* Chunk layer (furthest back, z < 0) */}
      {chunkNodes.length > 0 && (
        <ChunkNodes
          chunkNodes={chunkNodes}
          simNodes={simNodes}
          colorMixRatio={colorMixRatio}
          colorDesaturation={colorDesaturation}
          pcaTransform={pcaTransform}
          zoomRange={zoomPhaseConfig.chunkCrossfade}
          chunkZDepth={chunkZDepth}
          panelThickness={panelThickness}
          chunkTextDepthScale={chunkTextDepthScale}
          chunkSizeMultiplier={chunkSizeMultiplier}
          chunkScreenRectsRef={labelRefs.chunkScreenRectsRef}
          searchOpacities={searchOpacities}
        />
      )}

      {/* Frosted glass panel (between chunks and keywords) */}
      <TransmissionPanel
        enabled={blurEnabled && chunkNodes.length > 0}
        distanceRatio={panelDistanceRatio}
        thickness={panelThickness}
      />

      {/* Chunk containment edges (keyword → chunk) */}
      {keywordNodes.length > 0 && chunkNodes.length > 0 && (
        <ChunkEdges
          simNodes={keywordNodes}
          chunkNodes={chunkNodes}
          curveIntensity={0.25}
          curveDirections={curveDirections}
          colorMixRatio={colorMixRatio}
          colorDesaturation={colorDesaturation}
          pcaTransform={pcaTransform ?? undefined}
          searchOpacities={searchOpacities}
        />
      )}

      {/* Keyword similarity edges - constant opacity */}
      {keywordNodes.length > 0 && edges.length > 0 && (
        <KeywordEdges
          simNodes={keywordNodes}
          edges={edges as SimLink[]}
          curveIntensity={0.25}
          curveDirections={curveDirections}
          colorMixRatio={colorMixRatio}
          colorDesaturation={colorDesaturation}
          pcaTransform={pcaTransform ?? undefined}
          showKNNEdges={showKNNEdges}
          searchOpacities={searchOpacities}
        />
      )}

      {/* Keyword layer (front, z = 0) */}
      {keywordNodes.length > 0 && (
        <KeywordNodes
          simNodes={keywordNodes}
          colorMixRatio={colorMixRatio}
          colorDesaturation={colorDesaturation}
          pcaTransform={pcaTransform}
          zoomRange={zoomPhaseConfig.chunkCrossfade}
          keywordTiers={keywordTiers}
          searchOpacities={searchOpacities}
        />
      )}
    </>
  );
}
