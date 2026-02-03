/**
 * R3F-based renderer for TopicsView.
 * Uses React Three Fiber's declarative component model.
 */

import { Canvas } from "@react-three/fiber";
import { R3FTopicsScene } from "./R3FTopicsScene";
import type { KeywordNode, SimilarityEdge, ProjectNode } from "@/lib/graph-queries";
import type { PCATransform } from "@/lib/semantic-colors";

export interface R3FTopicsCanvasProps {
  nodes: KeywordNode[];
  edges: SimilarityEdge[];
  projectNodes?: ProjectNode[];
  colorMixRatio: number;
  pcaTransform: PCATransform | null;
  onKeywordClick?: (keyword: string) => void;
  onProjectClick?: (projectId: string) => void;
  onProjectDrag?: (projectId: string, position: { x: number; y: number }) => void;
  onZoomChange?: (zoomScale: number) => void;
}

export function R3FTopicsCanvas({
  nodes,
  edges,
  projectNodes = [],
  colorMixRatio,
  pcaTransform,
  onKeywordClick,
  onProjectClick,
  onProjectDrag,
  onZoomChange,
}: R3FTopicsCanvasProps) {
  return (
    <Canvas
      camera={{
        position: [0, 0, 10500],
        fov: 10,
        near: 0.1,
        far: 100000,  // Need large far plane since camera starts far away
      }}
      gl={{ antialias: true, alpha: false }}
      style={{ width: "100%", height: "100%" }}
    >
      <color attach="background" args={["#ffffff"]} />
      <ambientLight intensity={1} />

      <R3FTopicsScene
        nodes={nodes}
        edges={edges}
        projectNodes={projectNodes}
        colorMixRatio={colorMixRatio}
        pcaTransform={pcaTransform}
        onKeywordClick={onKeywordClick}
        onProjectClick={onProjectClick}
        onProjectDrag={onProjectDrag}
        onZoomChange={onZoomChange}
      />
    </Canvas>
  );
}
