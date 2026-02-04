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

export interface R3FTopicsSceneProps {
  nodes: KeywordNode[];
  edges: SimilarityEdge[];
  projectNodes: ProjectNode[];
  chunkNodes: SimNode[];
  colorMixRatio: number;
  pcaTransform: PCATransform | null;
  blurEnabled?: boolean;
  /** Show k-NN connectivity edges (usually hidden, only affect force simulation) */
  showKNNEdges?: boolean;
  panelDistanceRatio: number;
  panelThickness: number;
  zoomPhaseConfig: ZoomPhaseConfig;
  onKeywordClick?: (keyword: string) => void;
  onProjectClick?: (projectId: string) => void;
  onProjectDrag?: (projectId: string, position: { x: number; y: number }) => void;
  onZoomChange?: (zoomScale: number) => void;
  /** Refs for label rendering (bridging to DOM overlay) */
  labelRefs: LabelRefs;
}

export function R3FTopicsScene({
  nodes,
  edges,
  projectNodes,
  chunkNodes,
  colorMixRatio,
  pcaTransform,
  blurEnabled = true,
  showKNNEdges = false,
  panelDistanceRatio,
  panelThickness,
  zoomPhaseConfig,
  onKeywordClick,
  onProjectClick,
  onProjectDrag,
  onZoomChange,
  labelRefs,
}: R3FTopicsSceneProps) {
  // Simulation nodes shared between ForceSimulation and KeywordNodes
  const [simNodes, setSimNodes] = useState<SimNode[]>([]);

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
        />
      )}

      {/* Frosted glass panel (between chunks and keywords) */}
      <TransmissionPanel
        enabled={blurEnabled && chunkNodes.length > 0}
        distanceRatio={panelDistanceRatio}
        thickness={panelThickness}
      />

      {/* Chunk containment edges (keyword → chunk) - fade with zoom */}
      {false && simNodes.length > 0 && chunkNodes.length > 0 && (
        <ChunkEdges
          simNodes={simNodes}
          chunkNodes={chunkNodes}
          curveIntensity={0.25}
          curveDirections={curveDirections}
          colorMixRatio={colorMixRatio}
          pcaTransform={pcaTransform ?? undefined}
        />
      )}

      {/* Keyword similarity edges - constant opacity */}
      {simNodes.length > 0 && edges.length > 0 && (
        <KeywordEdges
          simNodes={simNodes}
          edges={edges as SimLink[]}
          curveIntensity={0.25}
          curveDirections={curveDirections}
          colorMixRatio={colorMixRatio}
          pcaTransform={pcaTransform ?? undefined}
          showKNNEdges={showKNNEdges}
        />
      )}

      {/* Keyword layer (front, z = 0) */}
      {simNodes.length > 0 && (
        <KeywordNodes
          simNodes={simNodes}
          colorMixRatio={colorMixRatio}
          pcaTransform={pcaTransform}
          zoomRange={zoomPhaseConfig.chunkCrossfade}
          onKeywordClick={onKeywordClick}
        />
      )}
    </>
  );
}
