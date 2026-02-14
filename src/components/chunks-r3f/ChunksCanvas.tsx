/**
 * R3F Canvas wrapper for the chunks UMAP visualization.
 * Minimal setup: camera, background, scene.
 */

import { useState, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { getBackgroundColor, watchThemeChanges } from "@/lib/theme";
import { CAMERA_FOV_DEGREES } from "@/lib/rendering-utils/zoom-to-cursor";
import { ChunksScene } from "./ChunksScene";
import type { ChunkEmbeddingData } from "@/app/api/chunks/embeddings/route";
import type { UmapEdge } from "@/hooks/useUmapLayout";

interface ChunksCanvasProps {
  chunks: ChunkEmbeddingData[];
  umapPositions: Float32Array;
  searchOpacities: Map<string, number>;
  neighborhoodEdges: UmapEdge[];
  neighborhoodEdgesVersion: number;
  isRunning: boolean;
}

export function ChunksCanvas({
  chunks,
  umapPositions,
  searchOpacities,
  neighborhoodEdges,
  neighborhoodEdgesVersion,
  isRunning,
}: ChunksCanvasProps) {
  const [backgroundColor, setBackgroundColor] = useState(getBackgroundColor);

  useEffect(() => {
    return watchThemeChanges((isDark) => {
      setBackgroundColor(isDark ? "#18181b" : "#ffffff");
    });
  }, []);

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <Canvas
        camera={{
          // Start far enough to see the full UMAP layout (targetRadius=500, fov=10)
          position: [0, 0, 6000],
          fov: CAMERA_FOV_DEGREES,
          near: 1,
          far: 100000,
        }}
        gl={{ antialias: true, alpha: false }}
        style={{ width: "100%", height: "100%" }}
      >
        <color attach="background" args={[backgroundColor]} />
        <ChunksScene
          chunks={chunks}
          umapPositions={umapPositions}
          searchOpacities={searchOpacities}
          neighborhoodEdges={neighborhoodEdges}
          neighborhoodEdgesVersion={neighborhoodEdgesVersion}
          isRunning={isRunning}
        />
      </Canvas>
    </div>
  );
}
