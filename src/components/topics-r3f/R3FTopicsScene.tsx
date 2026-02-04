/**
 * Scene coordinator for R3F Topics renderer.
 * Orchestrates all child components (camera, simulation, nodes, edges, labels).
 */

import { useState, useMemo } from "react";
import { CameraController } from "./CameraController";
import { ForceSimulation } from "./ForceSimulation";
import { KeywordNodes } from "./KeywordNodes";
import { ChunkNodes } from "./ChunkNodes";
import { TransmissionPanel } from "./TransmissionPanel";
import { KeywordEdges } from "./KeywordEdges";
import { ChunkEdges } from "./ChunkEdges";
import { useEdgeCurveDirections } from "@/hooks/useEdgeCurveDirections";
import type { KeywordNode, SimilarityEdge, ProjectNode } from "@/lib/graph-queries";
import type { PCATransform } from "@/lib/semantic-colors";
import type { SimNode, SimLink } from "@/lib/map-renderer";

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
  onKeywordClick?: (keyword: string) => void;
  onProjectClick?: (projectId: string) => void;
  onProjectDrag?: (projectId: string, position: { x: number; y: number }) => void;
  onZoomChange?: (zoomScale: number) => void;
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
  onKeywordClick,
  onProjectClick,
  onProjectDrag,
  onZoomChange,
}: R3FTopicsSceneProps) {
  // Simulation nodes shared between ForceSimulation and KeywordNodes
  const [simNodes, setSimNodes] = useState<SimNode[]>([]);

  // Compute curve directions ONLY for similarity edges
  const curveDirections = useEdgeCurveDirections(simNodes, edges as SimLink[]);

  // Debug: check for duplicate and bidirectional edges
  if (edges.length > 0 && Math.random() < 0.1) {
    const edgeKeys = new Set<string>();
    const duplicates: string[] = [];
    const bidirectional: string[] = [];
    let knnCount = 0;

    for (const edge of edges as SimLink[]) {
      const sourceId = typeof edge.source === "string" ? edge.source : (edge.source as any).id;
      const targetId = typeof edge.target === "string" ? edge.target : (edge.target as any).id;
      const key = `${sourceId}->${targetId}`;
      const reverseKey = `${targetId}->${sourceId}`;

      if (edge.isKNN) knnCount++;

      // Check for exact duplicate
      if (edgeKeys.has(key)) {
        duplicates.push(key);
      }

      // Check for bidirectional edge
      if (edgeKeys.has(reverseKey)) {
        bidirectional.push(`${sourceId}<->${targetId}`);
      }

      edgeKeys.add(key);
    }

    if (duplicates.length > 0) {
      console.warn(`Duplicate edges found:`, duplicates);
    }
    if (bidirectional.length > 0) {
      console.warn(`Bidirectional edges found (both A->B and B->A):`, bidirectional.slice(0, 10));
    }
    console.log(`Total edges: ${edges.length}, Unique: ${edgeKeys.size}, Bidirectional pairs: ${bidirectional.length}, k-NN edges: ${knnCount}`);
  }

  return (
    <>
      <CameraController onZoomChange={onZoomChange} />

      <ForceSimulation
        nodes={nodes}
        edges={edges}
        onSimulationReady={setSimNodes}
      />

      {/* Chunk layer (furthest back, z < 0) */}
      {chunkNodes.length > 0 && <ChunkNodes chunkNodes={chunkNodes} />}

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
          onKeywordClick={onKeywordClick}
        />
      )}
    </>
  );
}
