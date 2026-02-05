/**
 * R3F-based renderer for TopicsView.
 * Uses React Three Fiber's declarative component model.
 */

import { useState, useEffect, useRef, forwardRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import { R3FTopicsScene } from "./R3FTopicsScene";
import { LabelsOverlay } from "./LabelsOverlay";
import { getBackgroundColor, watchThemeChanges } from "@/lib/theme";
import type { KeywordNode, SimilarityEdge, ProjectNode } from "@/lib/graph-queries";
import type { PCATransform, ClusterColorInfo } from "@/lib/semantic-colors";
import type { SimNode } from "@/lib/map-renderer";
import type { ZoomPhaseConfig } from "@/lib/zoom-phase-config";
import type { LabelOverlayManager } from "@/lib/label-overlays";
import type { CameraState, ChunkScreenRect, LabelRefs, LabelsOverlayHandle } from "./R3FLabelContext";
import type { ChunkNode } from "@/lib/chunk-loader";
import type { KeywordTierMap } from "@/lib/topics-filter";

export interface R3FTopicsCanvasProps {
  nodes: KeywordNode[];
  edges: SimilarityEdge[];
  projectNodes?: ProjectNode[];
  chunksByKeyword?: Map<string, ChunkNode[]>;
  colorMixRatio: number;
  pcaTransform: PCATransform | null;
  blurEnabled?: boolean;
  /** Show k-NN connectivity edges (usually hidden, only affect force simulation) */
  showKNNEdges?: boolean;
  panelDistanceRatio: number;
  panelThickness: number;
  zoomPhaseConfig: ZoomPhaseConfig;
  chunkZDepth?: number;
  chunkTextDepthScale?: number;
  keywordTiers?: KeywordTierMap | null;
  onKeywordClick?: (keyword: string) => void;
  onKeywordLabelClick?: (keywordId: string) => void;
  onProjectClick?: (projectId: string) => void;
  onProjectDrag?: (projectId: string, position: { x: number; y: number }) => void;
  onZoomChange?: (zoomScale: number) => void;
}

export const R3FTopicsCanvas = forwardRef<LabelsOverlayHandle, R3FTopicsCanvasProps>(
  function R3FTopicsCanvas({
    nodes,
    edges,
    projectNodes = [],
    chunksByKeyword,
    colorMixRatio,
    pcaTransform,
    blurEnabled = true,
    showKNNEdges = false,
    panelDistanceRatio,
    panelThickness,
    zoomPhaseConfig,
    chunkZDepth,
    chunkTextDepthScale,
    keywordTiers,
    onKeywordClick,
    onKeywordLabelClick,
    onProjectClick,
    onProjectDrag,
    onZoomChange,
  }, ref) {
    // Theme-aware background color that updates when system theme changes
    const [backgroundColor, setBackgroundColor] = useState(getBackgroundColor);

    useEffect(() => {
      return watchThemeChanges((isDark) => {
        setBackgroundColor(isDark ? "#18181b" : "#ffffff");
      });
    }, []);

    // Cursor position tracking for 3D text proximity
    const [cursorPosition, setCursorPosition] = useState<{ x: number; y: number } | null>(null);

    // Locked chunks (clicked chunks stay visible until background click)
    const [lockedChunkIds, setLockedChunkIds] = useState<Set<string>>(new Set());

    // Cursor position handler
    const handlePointerMove = (e: React.PointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      setCursorPosition({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    };

    // Chunk click handler (locks chunk visible)
    const handleChunkClick = (chunkId: string) => {
      setLockedChunkIds((prev) => {
        const next = new Set(prev);
        if (next.has(chunkId)) {
          next.delete(chunkId); // Toggle: clicking locked chunk unlocks it
        } else {
          next.add(chunkId); // Lock new chunk
        }
        return next;
      });
    };

    // Background click handler (clears all locks)
    const handleBackgroundClick = () => {
      setLockedChunkIds(new Set());
    };

    // Container ref for DOM overlay positioning
    const containerRef = useRef<HTMLDivElement>(null);

    // Refs for label rendering (bridging Canvas internals to DOM overlay)
    const cameraStateRef = useRef<CameraState>({ x: 0, y: 0, z: 10500 });
    const simNodesRef = useRef<SimNode[]>([]);
    const nodeDegreesRef = useRef<Map<string, number>>(new Map());
    const clusterColorsRef = useRef<Map<number, ClusterColorInfo>>(new Map());
    const labelManagerRef = useRef<LabelOverlayManager | null>(null);
    const chunkScreenRectsRef = useRef<Map<string, ChunkScreenRect>>(new Map());

    const labelRefs: LabelRefs = {
      cameraStateRef,
      containerRef,
      simNodesRef,
      nodeDegreesRef,
      clusterColorsRef,
      labelManagerRef,
      chunkScreenRectsRef,
    };

    return (
      <div
        ref={containerRef}
        style={{ position: "relative", width: "100%", height: "100%" }}
        onPointerMove={handlePointerMove}
      >
        <Canvas
          camera={{
            position: [0, 0, 10500],
            fov: 10,
            near: 0.1,
            far: 100000, // Need large far plane since camera starts far away
          }}
          gl={{ antialias: true, alpha: false }}
          style={{ width: "100%", height: "100%" }}
          onClick={handleBackgroundClick}
        >
          <color attach="background" args={[backgroundColor]} />
          <ambientLight intensity={1} />
          <Environment preset="city" />

          <R3FTopicsScene
            nodes={nodes}
            edges={edges}
            projectNodes={projectNodes}
            chunksByKeyword={chunksByKeyword}
            colorMixRatio={colorMixRatio}
            pcaTransform={pcaTransform}
            blurEnabled={blurEnabled}
            showKNNEdges={showKNNEdges}
            panelDistanceRatio={panelDistanceRatio}
            panelThickness={panelThickness}
            zoomPhaseConfig={zoomPhaseConfig}
            chunkZDepth={chunkZDepth}
            chunkTextDepthScale={chunkTextDepthScale}
            keywordTiers={keywordTiers}
            onKeywordClick={onKeywordClick}
            onProjectClick={onProjectClick}
            onProjectDrag={onProjectDrag}
            onZoomChange={onZoomChange}
            labelRefs={labelRefs}
            cursorPosition={cursorPosition}
            lockedChunkIds={lockedChunkIds}
            onChunkClick={handleChunkClick}
          />
        </Canvas>

        {/* DOM-based label overlay (sibling to Canvas) */}
        <LabelsOverlay
          ref={ref}
          labelRefs={labelRefs}
          keywordLabelRange={zoomPhaseConfig.keywordLabels}
          onKeywordLabelClick={onKeywordLabelClick}
        />
      </div>
    );
  }
);
