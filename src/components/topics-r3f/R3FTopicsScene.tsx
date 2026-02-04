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
  panelDistanceRatio,
  panelThickness,
  onKeywordClick,
  onProjectClick,
  onProjectDrag,
  onZoomChange,
}: R3FTopicsSceneProps) {
  // Simulation nodes shared between ForceSimulation and KeywordNodes
  const [simNodes, setSimNodes] = useState<SimNode[]>([]);

  // Create containment edges (keyword → chunk) from chunk parentId
  const containmentEdges = useMemo(() => {
    const edges: SimLink[] = [];
    for (const chunk of chunkNodes) {
      const parentId = (chunk as any).parentId;
      if (parentId) {
        edges.push({
          source: parentId,
          target: chunk.id,
        });
      }
    }
    return edges;
  }, [chunkNodes]);

  // Combine all edges for curve direction calculation
  const allEdges = useMemo(
    () => [...(edges as SimLink[]), ...containmentEdges],
    [edges, containmentEdges]
  );

  // Compute curve directions for all edges (cached, only updates when nodes/edges change)
  const curveDirections = useEdgeCurveDirections(simNodes, allEdges);

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
      {simNodes.length > 0 && chunkNodes.length > 0 && (
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
