/**
 * R3F-based renderer for TopicsView.
 * Uses React Three Fiber's declarative component model.
 */

import { useState, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import { R3FTopicsScene } from "./R3FTopicsScene";
import { getBackgroundColor, watchThemeChanges } from "@/lib/theme";
import type { KeywordNode, SimilarityEdge, ProjectNode } from "@/lib/graph-queries";
import type { PCATransform } from "@/lib/semantic-colors";
import type { SimNode } from "@/lib/map-renderer";

export interface R3FTopicsCanvasProps {
  nodes: KeywordNode[];
  edges: SimilarityEdge[];
  projectNodes?: ProjectNode[];
  chunkNodes?: SimNode[];
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

export function R3FTopicsCanvas({
  nodes,
  edges,
  projectNodes = [],
  chunkNodes = [],
  colorMixRatio,
  pcaTransform,
  blurEnabled = true,
  panelDistanceRatio,
  panelThickness,
  onKeywordClick,
  onProjectClick,
  onProjectDrag,
  onZoomChange,
}: R3FTopicsCanvasProps) {
  // Theme-aware background color that updates when system theme changes
  const [backgroundColor, setBackgroundColor] = useState(getBackgroundColor);

  useEffect(() => {
    return watchThemeChanges((isDark) => {
      setBackgroundColor(isDark ? "#18181b" : "#ffffff");
    });
  }, []);

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
      <color attach="background" args={[backgroundColor]} />
      <ambientLight intensity={1} />
      <Environment preset="city" />

      <R3FTopicsScene
        nodes={nodes}
        edges={edges}
        projectNodes={projectNodes}
        chunkNodes={chunkNodes}
        colorMixRatio={colorMixRatio}
        pcaTransform={pcaTransform}
        blurEnabled={blurEnabled}
        panelDistanceRatio={panelDistanceRatio}
        panelThickness={panelThickness}
        onKeywordClick={onKeywordClick}
        onProjectClick={onProjectClick}
        onProjectDrag={onProjectDrag}
        onZoomChange={onZoomChange}
      />
    </Canvas>
  );
}
