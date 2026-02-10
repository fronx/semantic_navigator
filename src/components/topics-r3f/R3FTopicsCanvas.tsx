/**
 * R3F-based renderer for TopicsView.
 * Uses React Three Fiber's declarative component model.
 */

import { useState, useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment } from "@react-three/drei";

import { R3FTopicsScene } from "./R3FTopicsScene";
import { getBackgroundColor, watchThemeChanges } from "@/lib/theme";
import { useStableCallback } from "@/hooks/useStableRef";
import { CAMERA_FOV_DEGREES } from "@/lib/rendering-utils/zoom-to-cursor";
import { useWheelEventForwarding } from "@/hooks/useWheelEventForwarding";
import type { KeywordNode, SimilarityEdge, ProjectNode } from "@/lib/graph-queries";
import type { PCATransform, ClusterColorInfo } from "@/lib/semantic-colors";
import type { SimNode } from "@/lib/map-renderer";
import type { ZoomPhaseConfig } from "@/lib/zoom-phase-config";
import type { CameraState, ContentScreenRect, LabelRefs, LabelsOverlayHandle } from "./R3FLabelContext";
import type { ContentNode } from "@/lib/content-loader";
import type { KeywordTierMap } from "@/lib/topics-filter";
import type { FocusState } from "@/lib/focus-mode";

export interface R3FTopicsCanvasProps {
  nodes: KeywordNode[];
  /** Total keyword count before filtering — used for stable instancedMesh allocation */
  totalKeywordCount: number;
  edges: SimilarityEdge[];
  projectNodes?: ProjectNode[];
  contentsByKeyword?: Map<string, ContentNode[]>;
  colorMixRatio: number;
  colorDesaturation: number;
  clusterLabelDesaturation?: number;
  pcaTransform: PCATransform | null;
  blurEnabled?: boolean;
  /** Show k-NN connectivity edges (usually hidden, only affect force simulation) */
  showKNNEdges?: boolean;
  panelDistanceRatio: number;
  panelThickness: number;
  zoomPhaseConfig: ZoomPhaseConfig;
  contentZDepth?: number;
  contentTextDepthScale?: number;
  keywordSizeMultiplier?: number;
  /** Per-node size multipliers based on degree (node id -> multiplier) */
  nodeSizeMultipliers?: Map<string, number>;
  contentSizeMultiplier?: number;
  contentTextContrast?: number;
  /** Spring force strength for content node tethering (0.01-1.0, default 0.1) */
  contentSpringStrength?: number;
  /** Charge force strength for node repulsion (negative = repel, default -200) */
  chargeStrength?: number;
  /** Use unified simulation (keywords + content in single simulation) instead of separate simulations */
  unifiedSimulation?: boolean;
  /** Transmission panel roughness */
  panelRoughness?: number;
  /** Transmission panel transparency */
  panelTransmission?: number;
  /** Transmission panel anisotropic blur strength */
  panelAnisotropicBlur?: number;
  keywordTiers?: KeywordTierMap | null;
  /** Focus state for click-to-focus interaction (margin push) */
  focusState?: FocusState | null;
  /** Runtime cluster IDs from useClusterLabels (for label rendering) */
  nodeToCluster?: Map<string, number>;
  /** Search opacity map (node id -> opacity) for semantic search highlighting */
  searchOpacities?: Map<string, number>;
  /** Current camera Z position for zoom-dependent effects */
  cameraZ?: number;
  /** Cluster label shadow strength (0 = no shadow, 2 = extra strong) */
  clusterLabelShadowStrength?: number;
  /** Use semantically-matched fonts for cluster labels */
  useSemanticFontsForClusters?: boolean;
  /** Use semantically-matched fonts for keyword labels */
  useSemanticFontsForKeywords?: boolean;
  onKeywordClick?: (keyword: string) => void;
  onKeywordLabelClick?: (keywordId: string) => void;
  onClusterLabelClick?: (clusterId: number) => void;
  onProjectClick?: (projectId: string) => void;
  onProjectDrag?: (projectId: string, position: { x: number; y: number }) => void;
  onZoomChange?: (zoomScale: number) => void;
  onChunkHover?: (chunkId: string | null, content: string | null) => void;
  /** Background click handler (clears focus mode) */
  onBackgroundClick?: () => void;
  /**
   * Handler for keyword hover.
   * Required because R3F renderer always detects hover and expects a handler.
   */
  onKeywordHover: (keywordId: string | null) => void;
}

export const R3FTopicsCanvas = forwardRef<LabelsOverlayHandle, R3FTopicsCanvasProps>(
  function R3FTopicsCanvas({
    nodes,
    totalKeywordCount,
    edges,
    projectNodes = [],
    contentsByKeyword,
    colorMixRatio,
    colorDesaturation,
    clusterLabelDesaturation = 0,
    pcaTransform,
    blurEnabled = true,
    showKNNEdges = false,
    panelDistanceRatio,
    panelThickness,
    zoomPhaseConfig,
    contentZDepth,
    contentTextDepthScale,
    keywordSizeMultiplier,
    nodeSizeMultipliers,
    contentSizeMultiplier,
    contentTextContrast,
    contentSpringStrength,
    chargeStrength,
    unifiedSimulation,
    panelRoughness,
    panelTransmission,
    panelAnisotropicBlur,
    keywordTiers,
    focusState,
    nodeToCluster,
    searchOpacities,
    cameraZ,
    clusterLabelShadowStrength,
    useSemanticFontsForClusters,
    useSemanticFontsForKeywords,
    onKeywordClick,
    onKeywordLabelClick,
    onClusterLabelClick,
    onProjectClick,
    onProjectDrag,
    onZoomChange,
    onChunkHover: _onChunkHover,
    onBackgroundClick,
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
    const contentScreenRectsRef = useRef<Map<string, ContentScreenRect>>(new Map());
    const cursorWorldPosRef = useRef<{ x: number; y: number } | null>(null);
    const hoveredKeywordIdRef = useRef<string | null>(null);
    const hoveredContentIdRef = useRef<string | null>(null);
    const pulledPositionsRef = useRef<Map<string, { x: number; y: number; connectedPrimaryIds: string[] }>>(new Map());
    const pulledContentPositionsRef = useRef<Map<string, { x: number; y: number; connectedPrimaryIds: string[] }>>(new Map());
    const focusPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
    const flyToRef = useRef<((x: number, y: number) => void) | null>(null);

    // Keep nodeToCluster ref updated (lint suppressed: updating ref during render is intentional)
    // eslint-disable-next-line react-hooks/refs
    nodeToClusterRef.current = nodeToCluster ?? new Map();

    const keywordClickHandler = onKeywordClick ?? onKeywordLabelClick;
    void _onChunkHover;

    // Memoize with [] — every value is a stable useRef
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const labelRefs: LabelRefs = useMemo(() => ({
      cameraStateRef,
      containerRef,
      simNodesRef,
      nodeDegreesRef,
      clusterColorsRef,
      nodeToClusterRef,
      contentScreenRectsRef,
      cursorWorldPosRef,
      hoveredKeywordIdRef,
      hoveredContentIdRef,
      pulledPositionsRef,
      pulledContentPositionsRef,
    }), []);

    // Forward wheel events from DOM overlays to canvas
    useWheelEventForwarding(containerRef);

    // Stabilize the keyword hover callback to prevent label manager recreation on every mouse move
    const stableOnKeywordHover = useStableCallback((id: string | null) => {
      hoveredKeywordIdRef.current = id;
      onKeywordHover(id);
    });

    useImperativeHandle(ref, () => ({
      getNodes: () => labelRefs.simNodesRef.current,
    }), []);

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
            fov: CAMERA_FOV_DEGREES,
            near: 0.1,
            far: 100000, // Need large far plane since camera starts far away
          }}
          gl={{ antialias: true, alpha: false, stencil: true }}
          style={{ width: "100%", height: "100%" }}
          onPointerMissed={() => { onBackgroundClick?.(); }}
        >
          <color attach="background" args={[backgroundColor]} />
          <ambientLight intensity={1} />
          <Environment preset="city" />

          <R3FTopicsScene
            nodes={nodes}
            totalKeywordCount={totalKeywordCount}
            edges={edges}
            projectNodes={projectNodes}
            contentsByKeyword={contentsByKeyword}
            colorMixRatio={colorMixRatio}
            colorDesaturation={colorDesaturation}
            clusterLabelDesaturation={clusterLabelDesaturation}
            pcaTransform={pcaTransform}
            blurEnabled={blurEnabled}
            showKNNEdges={showKNNEdges}
            panelDistanceRatio={panelDistanceRatio}
            panelThickness={panelThickness}
            zoomPhaseConfig={zoomPhaseConfig}
            contentZDepth={contentZDepth}
            contentTextDepthScale={contentTextDepthScale}
            keywordSizeMultiplier={keywordSizeMultiplier}
            nodeSizeMultipliers={nodeSizeMultipliers}
            contentSizeMultiplier={contentSizeMultiplier}
            contentTextContrast={contentTextContrast}
            contentSpringStrength={contentSpringStrength}
            chargeStrength={chargeStrength}
            unifiedSimulation={unifiedSimulation}
            panelRoughness={panelRoughness}
            panelTransmission={panelTransmission}
            panelAnisotropicBlur={panelAnisotropicBlur}
          keywordTiers={keywordTiers}
          focusState={focusState}
          focusPositionsRef={focusPositionsRef}
          searchOpacities={searchOpacities}
          cameraZ={cameraZ}
          nodeToCluster={nodeToCluster ?? undefined}
          clusterLabelShadowStrength={clusterLabelShadowStrength}
          useSemanticFontsForClusters={useSemanticFontsForClusters}
          useSemanticFontsForKeywords={useSemanticFontsForKeywords}
          onProjectClick={onProjectClick}
          onProjectDrag={onProjectDrag}
          onZoomChange={onZoomChange}
          onKeywordClick={keywordClickHandler}
          onKeywordHover={stableOnKeywordHover}
          onClusterLabelClick={onClusterLabelClick}
          flyToRef={flyToRef}
          labelRefs={labelRefs}
          cursorPosition={cursorPosition}
        />
        </Canvas>

      </div>
    );
  }
);
