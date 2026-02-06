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
import { CAMERA_FOV_DEGREES } from "@/lib/three/zoom-to-cursor";
import { useWheelEventForwarding } from "@/hooks/useWheelEventForwarding";
import type { KeywordNode, SimilarityEdge, ProjectNode } from "@/lib/graph-queries";
import type { PCATransform, ClusterColorInfo } from "@/lib/semantic-colors";
import type { SimNode } from "@/lib/map-renderer";
import type { ZoomPhaseConfig } from "@/lib/zoom-phase-config";
import type { LabelOverlayManager } from "@/lib/label-overlays";
import type { CameraState, ContentScreenRect, LabelRefs, LabelsOverlayHandle } from "./R3FLabelContext";
import type { ContentNode } from "@/lib/content-loader";
import type { KeywordTierMap } from "@/lib/topics-filter";

export interface R3FTopicsCanvasProps {
  nodes: KeywordNode[];
  edges: SimilarityEdge[];
  projectNodes?: ProjectNode[];
  contentsByKeyword?: Map<string, ContentNode[]>;
  colorMixRatio: number;
  colorDesaturation: number;
  pcaTransform: PCATransform | null;
  blurEnabled?: boolean;
  /** Show k-NN connectivity edges (usually hidden, only affect force simulation) */
  showKNNEdges?: boolean;
  panelDistanceRatio: number;
  panelThickness: number;
  zoomPhaseConfig: ZoomPhaseConfig;
  contentZDepth?: number;
  contentTextDepthScale?: number;
  contentSizeMultiplier?: number;
  keywordTiers?: KeywordTierMap | null;
  /** Runtime cluster IDs from useClusterLabels (for label rendering) */
  nodeToCluster?: Map<string, number>;
  /** Search opacity map (node id -> opacity) for semantic search highlighting */
  searchOpacities?: Map<string, number>;
  /** Current camera Z position for zoom-dependent effects */
  cameraZ?: number;
  onKeywordClick?: (keyword: string) => void;
  onKeywordLabelClick?: (keywordId: string) => void;
  onClusterLabelClick?: (clusterId: number) => void;
  onProjectClick?: (projectId: string) => void;
  onProjectDrag?: (projectId: string, position: { x: number; y: number }) => void;
  onZoomChange?: (zoomScale: number) => void;
  onChunkHover?: (chunkId: string | null, content: string | null) => void;
  /**
   * Handler for keyword hover.
   * Required because R3F renderer always detects hover and expects a handler.
   */
  onKeywordHover: (keywordId: string | null) => void;
}

export const R3FTopicsCanvas = forwardRef<LabelsOverlayHandle, R3FTopicsCanvasProps>(
  function R3FTopicsCanvas({
    nodes,
    edges,
    projectNodes = [],
    contentsByKeyword,
    colorMixRatio,
    colorDesaturation,
    pcaTransform,
    blurEnabled = true,
    showKNNEdges = false,
    panelDistanceRatio,
    panelThickness,
    zoomPhaseConfig,
    contentZDepth,
    contentTextDepthScale,
    contentSizeMultiplier,
    keywordTiers,
    nodeToCluster,
    searchOpacities,
    cameraZ,
    onKeywordClick,
    onKeywordLabelClick,
    onClusterLabelClick,
    onProjectClick,
    onProjectDrag,
    onZoomChange,
    onChunkHover,
    onKeywordHover,
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

    // Cursor position handler
    const handlePointerMove = (e: React.PointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;

      setCursorPosition({ x: screenX, y: screenY });

      // Convert screen coordinates to world coordinates for hover label system
      const camera = cameraStateRef.current;
      const fovRadians = CAMERA_FOV_DEGREES * Math.PI / 180;
      const visibleHeight = 2 * camera.z * Math.tan(fovRadians / 2);
      const visibleWidth = visibleHeight * (rect.width / rect.height);

      // Convert screen to NDC (Normalized Device Coordinates)
      const ndcX = (screenX / rect.width) * 2 - 1;
      const ndcY = -((screenY / rect.height) * 2 - 1); // Flip Y (screen Y down, world Y up)

      // Convert NDC to world coordinates
      const worldX = camera.x + ndcX * (visibleWidth / 2);
      const worldY = camera.y + ndcY * (visibleHeight / 2);

      cursorWorldPosRef.current = { x: worldX, y: worldY };
    };

    // Cursor leave handler (clears cursor position)
    const handlePointerLeave = () => {
      setCursorPosition(null);
      cursorWorldPosRef.current = null;
    };

    // Container ref for DOM overlay positioning
    const containerRef = useRef<HTMLDivElement>(null);

    // Refs for label rendering (bridging Canvas internals to DOM overlay)
    const cameraStateRef = useRef<CameraState>({ x: 0, y: 0, z: 10500 });
    const simNodesRef = useRef<SimNode[]>([]);
    const nodeDegreesRef = useRef<Map<string, number>>(new Map());
    const clusterColorsRef = useRef<Map<number, ClusterColorInfo>>(new Map());
    const nodeToClusterRef = useRef<Map<string, number>>(nodeToCluster ?? new Map());
    const labelManagerRef = useRef<LabelOverlayManager | null>(null);
    const contentScreenRectsRef = useRef<Map<string, ContentScreenRect>>(new Map());
    const cursorWorldPosRef = useRef<{ x: number; y: number } | null>(null);

    // Keep nodeToCluster ref updated
    nodeToClusterRef.current = nodeToCluster ?? new Map();

    const labelRefs: LabelRefs = {
      cameraStateRef,
      containerRef,
      simNodesRef,
      nodeDegreesRef,
      clusterColorsRef,
      nodeToClusterRef,
      labelManagerRef,
      contentScreenRectsRef,
      cursorWorldPosRef,
    };

    // Forward wheel events from DOM overlays to canvas
    useWheelEventForwarding(containerRef);

    return (
      <div
        ref={containerRef}
        style={{ position: "relative", width: "100%", height: "100%", userSelect: "none" }}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
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
        >
          <color attach="background" args={[backgroundColor]} />
          <ambientLight intensity={1} />
          <Environment preset="city" />

          <R3FTopicsScene
            nodes={nodes}
            edges={edges}
            projectNodes={projectNodes}
            contentsByKeyword={contentsByKeyword}
            colorMixRatio={colorMixRatio}
            colorDesaturation={colorDesaturation}
            pcaTransform={pcaTransform}
            blurEnabled={blurEnabled}
            showKNNEdges={showKNNEdges}
            panelDistanceRatio={panelDistanceRatio}
            panelThickness={panelThickness}
            zoomPhaseConfig={zoomPhaseConfig}
            contentZDepth={contentZDepth}
            contentTextDepthScale={contentTextDepthScale}
            contentSizeMultiplier={contentSizeMultiplier}
            keywordTiers={keywordTiers}
            searchOpacities={searchOpacities}
            cameraZ={cameraZ}
            onProjectClick={onProjectClick}
            onProjectDrag={onProjectDrag}
            onZoomChange={onZoomChange}
            labelRefs={labelRefs}
            cursorPosition={cursorPosition}
          />
        </Canvas>

        {/* DOM-based label overlay (sibling to Canvas) */}
        <LabelsOverlay
          ref={ref}
          labelRefs={labelRefs}
          keywordLabelRange={zoomPhaseConfig.keywordLabels}
          contentsByKeyword={contentsByKeyword}
          searchOpacities={searchOpacities}
          onKeywordLabelClick={onKeywordLabelClick}
          onClusterLabelClick={onClusterLabelClick}
          onKeywordHover={onKeywordHover}
        />
      </div>
    );
  }
);
