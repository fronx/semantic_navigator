/**
 * Scene coordinator for R3F Topics renderer.
 * Orchestrates all child components (camera, simulation, nodes, edges, labels).
 */

import { useState } from "react";
import { CameraController } from "./CameraController";
import { ForceSimulation } from "./ForceSimulation";
import { KeywordNodes } from "./KeywordNodes";
import type { KeywordNode, SimilarityEdge, ProjectNode } from "@/lib/graph-queries";
import type { PCATransform } from "@/lib/semantic-colors";
import type { SimNode } from "@/lib/map-renderer";

export interface R3FTopicsSceneProps {
  nodes: KeywordNode[];
  edges: SimilarityEdge[];
  projectNodes: ProjectNode[];
  colorMixRatio: number;
  pcaTransform: PCATransform | null;
  onKeywordClick?: (keyword: string) => void;
  onProjectClick?: (projectId: string) => void;
  onProjectDrag?: (projectId: string, position: { x: number; y: number }) => void;
  onZoomChange?: (zoomScale: number) => void;
}

export function R3FTopicsScene({
  nodes,
  edges,
  projectNodes,
  colorMixRatio,
  pcaTransform,
  onKeywordClick,
  onProjectClick,
  onProjectDrag,
  onZoomChange,
}: R3FTopicsSceneProps) {
  // Simulation nodes shared between ForceSimulation and KeywordNodes
  const [simNodes, setSimNodes] = useState<SimNode[]>([]);

  return (
    <>
      <CameraController onZoomChange={onZoomChange} />

      <ForceSimulation
        nodes={nodes}
        edges={edges}
        onSimulationReady={setSimNodes}
      />

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
