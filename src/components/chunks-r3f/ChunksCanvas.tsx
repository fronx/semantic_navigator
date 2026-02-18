/**
 * R3F Canvas wrapper for the chunks UMAP visualization.
 * Minimal setup: camera, background, scene.
 */

import { useState, useEffect, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { getBackgroundColor, watchThemeChanges } from "@/lib/theme";
import { CAMERA_FOV_DEGREES } from "@/lib/rendering-utils/zoom-to-cursor";
import { ChunksScene } from "./ChunksScene";
import type { ChunkEmbeddingData } from "@/app/api/chunks/embeddings/route";
import type { LabelFadeConfig } from "@/components/ChunksControlSidebar";
import type { UmapEdge } from "@/hooks/useUmapLayout";

interface ChunksCanvasProps {
  chunks: ChunkEmbeddingData[];
  umapPositions: Float32Array;
  searchOpacities: Map<string, number>;
  neighborhoodEdges: UmapEdge[] | Array<{ source: number; target: number; weight: number }>;
  neighborhoodEdgesVersion: number;
  isRunning: boolean;
  onSelectChunk: (chunkId: string | null) => void;
  colorSaturation: number;
  minSaturation: number;
  chunkColorMix: number;
  edgeThickness: number;
  edgeMidpoint: number;
  edgeCountPivot: number;
  edgeCountFloor: number;
  nodeSizeMin: number;
  nodeSizeMax: number;
  nodeSizePivot: number;
  hoverRadius: number;
  coarseClusters: Record<number, number> | null;
  fineClusters: Record<number, number> | null;
  coarseLabels: Record<number, string> | null;
  fineLabels: Record<number, string> | null;
  labelFades: LabelFadeConfig;
  onLayoutSettled?: (positions: Float32Array) => void;
  onCameraZChange?: (z: number) => void;
  focusChunk?: { id: string; seq: number } | null;
}

export function ChunksCanvas({
  chunks,
  umapPositions,
  searchOpacities,
  neighborhoodEdges,
  neighborhoodEdgesVersion,
  isRunning,
  onSelectChunk,
  colorSaturation,
  minSaturation,
  chunkColorMix,
  edgeThickness,
  edgeMidpoint,
  edgeCountPivot,
  edgeCountFloor,
  nodeSizeMin,
  nodeSizeMax,
  nodeSizePivot,
  hoverRadius,
  coarseClusters,
  fineClusters,
  coarseLabels,
  fineLabels,
  labelFades,
  onLayoutSettled,
  onCameraZChange,
  focusChunk,
}: ChunksCanvasProps) {
  const [backgroundColor, setBackgroundColor] = useState(getBackgroundColor);
  const backgroundClickRef = useRef<(() => void) | null>(null);

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
        onPointerMissed={() => backgroundClickRef.current?.()}
      >
        <color attach="background" args={[backgroundColor]} />
        <ChunksScene
          chunks={chunks}
          umapPositions={umapPositions}
          searchOpacities={searchOpacities}
          neighborhoodEdges={neighborhoodEdges as UmapEdge[]}
          neighborhoodEdgesVersion={neighborhoodEdgesVersion}
          isRunning={isRunning}
          onSelectChunk={onSelectChunk}
          colorSaturation={colorSaturation}
          minSaturation={minSaturation}
          chunkColorMix={chunkColorMix}
          edgeThickness={edgeThickness}
          edgeMidpoint={edgeMidpoint}
          edgeCountPivot={edgeCountPivot}
          edgeCountFloor={edgeCountFloor}
          nodeSizeMin={nodeSizeMin}
          nodeSizeMax={nodeSizeMax}
          nodeSizePivot={nodeSizePivot}
          hoverRadius={hoverRadius}
          backgroundClickRef={backgroundClickRef}
          coarseClusters={coarseClusters}
          fineClusters={fineClusters}
          coarseLabels={coarseLabels}
          fineLabels={fineLabels}
          labelFades={labelFades}
          onLayoutSettled={onLayoutSettled}
          onCameraZChange={onCameraZChange}
          focusChunk={focusChunk}
        />
      </Canvas>
    </div>
  );
}
