/**
 * DOM-based label overlay for R3F renderer.
 * Creates and manages the label overlay manager from label-overlays.ts.
 *
 * This component renders outside the Canvas (as a DOM sibling) and uses
 * refs to access camera state that's updated by components inside Canvas.
 */

import { useImperativeHandle, forwardRef, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import { createLabelOverlayManager } from "@/lib/label-overlays";
import { CAMERA_FOV_DEGREES } from "@/lib/three/zoom-to-cursor";
import { getNodeRadius, DOT_SCALE_FACTOR } from "@/lib/three/node-renderer";
import { useStableCallback } from "@/hooks/useStableRef";
import { useStableEffect } from "@/hooks/useStableEffect";
import type { LabelRefs, LabelsOverlayHandle } from "./R3FLabelContext";
import type { SimNode } from "@/lib/map-renderer";
import type { ContentNode } from "@/lib/content-loader";

const CAMERA_FOV_RADIANS = CAMERA_FOV_DEGREES * Math.PI / 180;

export interface LabelsOverlayProps {
  /** All refs needed for label rendering */
  labelRefs: LabelRefs;
  /** Keyword label zoom range thresholds */
  keywordLabelRange: { start: number; full: number };
  /** Source data for chunk content (bypasses SimNode transformation) */
  contentsByKeyword?: Map<string, ContentNode[]>;
  /** Search opacity map (node id -> opacity) for semantic search highlighting */
  searchOpacities?: Map<string, number>;
  /** Handler for keyword label click */
  onKeywordLabelClick?: (keywordId: string) => void;
  /** Handler for cluster label click */
  onClusterLabelClick?: (clusterId: number) => void;
  /** Handler for keyword hover */
  onKeywordHover?: (keywordId: string | null) => void;
  /** Disable DOM-based cluster labels (for 3D label experiments) */
  disableClusterLabels?: boolean;
  /** Disable DOM-based keyword labels (for three-text replacements) */
  disableKeywordLabels?: boolean;
  /** Disable DOM-based content text labels/previews */
  disableContentLabels?: boolean;
}

export const LabelsOverlay = forwardRef<LabelsOverlayHandle, LabelsOverlayProps>(
  function LabelsOverlay({ labelRefs, keywordLabelRange, contentsByKeyword, searchOpacities, onKeywordLabelClick, onClusterLabelClick, onKeywordHover, disableClusterLabels = false, disableKeywordLabels = false, disableContentLabels = false }, ref) {
    const {
      cameraStateRef,
      containerRef,
      simNodesRef,
      nodeDegreesRef,
      clusterColorsRef,
      nodeToClusterRef,
      labelManagerRef,
      cursorWorldPosRef,
    } = labelRefs;

    // Stabilize callbacks to prevent label manager recreation on parent re-renders
    const stableOnKeywordHover = useStableCallback(onKeywordHover);

    // Ref for search opacities (so label manager closure always reads latest value)
    const searchOpacitiesRef = useRef(searchOpacities);
    // eslint-disable-next-line react-hooks/refs
    searchOpacitiesRef.current = searchOpacities;

    // Ref for contentsByKeyword to prevent handleChunkLabelContainer from recreating on every content update
    const contentsByKeywordRef = useRef(contentsByKeyword);
    // eslint-disable-next-line react-hooks/refs
    contentsByKeywordRef.current = contentsByKeyword;

    // Track visible chunk labels for portal rendering
    const [chunkPortals, setChunkPortals] = useState<Map<string, {
      container: HTMLElement;
      content: string;
    }>>(new Map());

    // Callback for label manager to notify about chunk label containers
    const handleChunkLabelContainer = useCallback((
      chunkId: string,
      container: HTMLElement,
      content: string,
      visible: boolean,
      parentKeywordId?: string
    ) => {
      setChunkPortals(prev => {
        const next = new Map(prev);
        // Use unique portal key: parentKeywordId-chunkId
        // This prevents portal collisions when chunks are shared across multiple keywords
        const portalKey = parentKeywordId ? `${parentKeywordId}-${chunkId}` : chunkId;

        if (visible) {
          // Look up content directly from source data (contentsByKeyword)
          // instead of using transformed content from SimNode
          let actualContent = content;

          const contentsByKeyword = contentsByKeywordRef.current;
          if (contentsByKeyword && parentKeywordId) {
            const chunks = contentsByKeyword.get(parentKeywordId);
            const chunk = chunks?.find(c => c.id === chunkId);
            if (chunk) {
              actualContent = chunk.content;
            }
          }

          if (actualContent) {
            next.set(portalKey, { container, content: actualContent });
          } else {
            next.delete(portalKey);
          }
        } else {
          next.delete(portalKey);
        }
        return next;
      });
    }, []); // No dependencies - uses refs for latest values

    // Create label manager on mount
    // Use useStableEffect to detect if dependencies become unstable (causing flicker)
    useStableEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      // Store container in const to satisfy TypeScript narrowing
      const containerEl = container;

      /**
       * Get viewport dimensions in world units.
       * Uses camera Z and FOV to calculate visible area.
       */
      function getViewport(): { width: number; height: number } {
        const cameraZ = cameraStateRef.current.z;
        const rect = containerEl.getBoundingClientRect();
        const visibleHeight = 2 * cameraZ * Math.tan(CAMERA_FOV_RADIANS / 2);
        const visibleWidth = visibleHeight * (rect.width / rect.height);
        return { width: visibleWidth, height: visibleHeight };
      }

      /**
       * Convert world coordinates to screen coordinates.
       * Reads camera position from cameraStateRef (updated every frame).
       */
      function worldToScreen(world: { x: number; y: number }): { x: number; y: number } | null {
        const rect = containerEl.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;

        const camera = cameraStateRef.current;
        const viewport = getViewport();

        // Convert world to NDC (Normalized Device Coordinates)
        const ndcX = (world.x - camera.x) / (viewport.width / 2);
        const ndcY = (world.y - camera.y) / (viewport.height / 2);

        // Convert NDC to screen coordinates
        return {
          x: ((ndcX + 1) / 2) * rect.width,
          y: ((1 - ndcY) / 2) * rect.height, // Flip Y (screen Y down, world Y up)
        };
      }

      const labelManager = createLabelOverlayManager({
        container,
        worldToScreen,
        getCameraZ: () => cameraStateRef.current.z,
        getNodeRadius: (node: SimNode) => getNodeRadius(node, 1) * DOT_SCALE_FACTOR,
        getClusterColors: () => clusterColorsRef.current,
        getKeywordLabelRange: () => keywordLabelRange,
        getChunkScreenRects: () => labelRefs.contentScreenRectsRef.current,
        getNodeToCluster: () => nodeToClusterRef.current,
        getCursorWorldPos: () => cursorWorldPosRef.current,
        getPulledPositions: () => labelRefs.pulledPositionsRef.current,
        onKeywordLabelClick,
        onClusterLabelClick,
        onChunkLabelContainer: handleChunkLabelContainer,
        onKeywordHover: stableOnKeywordHover,
        getSearchOpacities: () => searchOpacitiesRef.current,
        disableClusterLabels,
        disableKeywordLabels,
        disableContentLabels,
      });

      labelManagerRef.current = labelManager;

      return () => {
        labelManager.destroy();
        labelManagerRef.current = null;
      };
    }, [containerRef, cameraStateRef, clusterColorsRef, labelManagerRef, keywordLabelRange, cursorWorldPosRef, handleChunkLabelContainer, stableOnKeywordHover], {
      name: 'label-manager',
      maxRunsBeforeWarn: 3, // Warn if recreates >3 times in 1 second (indicates unstable deps)
    });

    // Expose imperative handle for TopicsView to call
    useImperativeHandle(ref, () => ({
      updateClusterLabels: () => {
        const manager = labelManagerRef.current;
        const nodes = simNodesRef.current;
        if (manager && nodes.length > 0) {
          manager.updateClusterLabels(nodes);
        }
      },
      updateKeywordLabels: () => {
        const manager = labelManagerRef.current;
        const nodes = simNodesRef.current;
        const degrees = nodeDegreesRef.current;
        if (manager && nodes.length > 0) {
          manager.updateKeywordLabels(nodes, degrees);
        }
      },
      updateContentLabels: (parentColors: Map<string, string>) => {
        const manager = labelManagerRef.current;
        const nodes = simNodesRef.current;
        if (manager && nodes.length > 0) {
          manager.updateContentLabels(nodes, parentColors);
        }
      },
      getNodes: () => simNodesRef.current,
    }), [labelManagerRef, simNodesRef, nodeDegreesRef]);

    // Render markdown portals into label containers
    return (
      <>
        {Array.from(chunkPortals.entries()).map(([portalKey, { container, content }]) =>
          createPortal(
            <div className="content-markdown">
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>,
            container,
            portalKey
          )
        )}
      </>
    );
  }
);
