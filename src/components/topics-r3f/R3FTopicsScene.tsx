/**
 * Scene coordinator for R3F Topics renderer.
 * Orchestrates all child components (camera, simulation, nodes, edges, labels).
 */

import { useState, useMemo, useEffect } from "react";
import { CameraController } from "./CameraController";
import { ForceSimulation } from "./ForceSimulation";
import { KeywordNodes } from "./KeywordNodes";
import { ChunkNodes } from "./ChunkNodes";
import { TransmissionPanel } from "./TransmissionPanel";
import { KeywordEdges } from "./KeywordEdges";
import { ChunkEdges } from "./ChunkEdges";
import { LabelsUpdater } from "./LabelsUpdater";
import { useEdgeCurveDirections } from "@/hooks/useEdgeCurveDirections";
import { computeNodeDegrees } from "@/lib/label-overlays";
import { groupNodesByCommunity } from "@/lib/hull-renderer";
import { computeClusterColors } from "@/lib/semantic-colors";
import type { KeywordNode, SimilarityEdge, ProjectNode } from "@/lib/graph-queries";
import type { PCATransform } from "@/lib/semantic-colors";
import type { SimNode, SimLink } from "@/lib/map-renderer";
import type { ZoomPhaseConfig } from "@/lib/zoom-phase-config";
import type { LabelRefs } from "./R3FLabelContext";
import type { ChunkNode } from "@/lib/chunk-loader";

export interface R3FTopicsSceneProps {
  nodes: KeywordNode[];
  edges: SimilarityEdge[];
  projectNodes: ProjectNode[];
  chunksByKeyword?: Map<string, ChunkNode[]>;
  colorMixRatio: number;
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
  onKeywordClick?: (keyword: string) => void;
  onProjectClick?: (projectId: string) => void;
  onProjectDrag?: (projectId: string, position: { x: number; y: number }) => void;
  onZoomChange?: (zoomScale: number) => void;
  /** Refs for label rendering (bridging to DOM overlay) */
  labelRefs: LabelRefs;
  /** Cursor position for 3D text proximity filtering */
  cursorPosition: { x: number; y: number } | null;
  /** Locked chunk IDs (clicked chunks stay visible) */
  lockedChunkIds: Set<string>;
  /** Handler for chunk click (locks/unlocks chunk) */
  onChunkClick: (chunkId: string) => void;
}

export function R3FTopicsScene({
  nodes,
  edges,
  projectNodes,
  chunksByKeyword,
  colorMixRatio,
  pcaTransform,
  blurEnabled = true,
  showKNNEdges = false,
  panelDistanceRatio,
  panelThickness,
  zoomPhaseConfig,
  chunkZDepth = -150,
  chunkTextDepthScale = -15.0,
  onKeywordClick,
  onProjectClick,
  onProjectDrag,
  onZoomChange,
  labelRefs,
  cursorPosition,
  lockedChunkIds,
  onChunkClick,
}: R3FTopicsSceneProps) {
  // Simulation nodes shared between ForceSimulation and rendering components
  // Contains both keywords and chunks, positioned by d3-force
  const [simNodes, setSimNodes] = useState<SimNode[]>([]);

  // Track hovered chunk for text preview when zoomed out
  const [hoveredChunkId, setHoveredChunkId] = useState<string | null>(null);

  // Extract keyword and chunk nodes from simulation results
  const { keywordNodes, chunkNodes } = useMemo(() => {
    const keywords = simNodes.filter(n => n.type === "keyword");
    const chunks = simNodes.filter(n => n.type === "chunk");

    console.log('[R3F Scene] Simulation nodes:', {
      total: simNodes.length,
      keywords: keywords.length,
      chunks: chunks.length,
    });

    return { keywordNodes: keywords, chunkNodes: chunks };
  }, [simNodes]);

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
      const grouped = groupNodesByCommunity(simNodes);
      const colors = computeClusterColors(grouped, pcaTransform ?? undefined);
      labelRefs.clusterColorsRef.current = colors;
    }
  }, [simNodes, edges, pcaTransform, labelRefs]);

  // Compute curve directions ONLY for similarity edges
  const curveDirections = useEdgeCurveDirections(simNodes, edges as SimLink[]);

  return (
    <>
      <CameraController onZoomChange={onZoomChange} />

      {/* Labels updater - updates camera state and triggers label renders */}
      <LabelsUpdater labelRefs={labelRefs} />

      <ForceSimulation
        nodes={nodes}
        edges={edges}
        chunksByKeyword={chunksByKeyword}
        onSimulationReady={setSimNodes}
      />

      {/* Chunk layer (furthest back, z < 0) */}
      {chunkNodes.length > 0 && (
        <ChunkNodes
          chunkNodes={chunkNodes}
          simNodes={simNodes}
          colorMixRatio={colorMixRatio}
          pcaTransform={pcaTransform}
          zoomRange={zoomPhaseConfig.chunkCrossfade}
          chunkZDepth={chunkZDepth}
          panelThickness={panelThickness}
          chunkTextDepthScale={chunkTextDepthScale}
          onChunkClick={onChunkClick}
          onChunkHover={setHoveredChunkId}
          chunkScreenRectsRef={labelRefs.chunkScreenRectsRef}
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
          pcaTransform={pcaTransform ?? undefined}
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
          pcaTransform={pcaTransform ?? undefined}
          showKNNEdges={showKNNEdges}
        />
      )}

      {/* Keyword layer (front, z = 0) */}
      {keywordNodes.length > 0 && (
        <KeywordNodes
          simNodes={keywordNodes}
          colorMixRatio={colorMixRatio}
          pcaTransform={pcaTransform}
          zoomRange={zoomPhaseConfig.chunkCrossfade}
          onKeywordClick={onKeywordClick}
        />
      )}
    </>
  );
}
