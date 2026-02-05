/**
 * DOM-based label overlay for R3F renderer.
 * Creates and manages the label overlay manager from label-overlays.ts.
 *
 * This component renders outside the Canvas (as a DOM sibling) and uses
 * refs to access camera state that's updated by components inside Canvas.
 */

import { useEffect, useImperativeHandle, forwardRef } from "react";
import { createLabelOverlayManager } from "@/lib/label-overlays";
import { CAMERA_FOV_DEGREES } from "@/lib/three/zoom-to-cursor";
import { getNodeRadius, DOT_SCALE_FACTOR } from "@/lib/three/node-renderer";
import type { LabelRefs, LabelsOverlayHandle } from "./R3FLabelContext";
import type { SimNode } from "@/lib/map-renderer";

const CAMERA_FOV_RADIANS = CAMERA_FOV_DEGREES * Math.PI / 180;

export interface LabelsOverlayProps {
  /** All refs needed for label rendering */
  labelRefs: LabelRefs;
  /** Keyword label zoom range thresholds */
  keywordLabelRange: { start: number; full: number };
  /** Handler for keyword label click */
  onKeywordLabelClick?: (keywordId: string) => void;
  /** Handler for cluster label click */
  onClusterLabelClick?: (clusterId: number) => void;
}

export const LabelsOverlay = forwardRef<LabelsOverlayHandle, LabelsOverlayProps>(
  function LabelsOverlay({ labelRefs, keywordLabelRange, onKeywordLabelClick, onClusterLabelClick }, ref) {
    const {
      cameraStateRef,
      containerRef,
      simNodesRef,
      nodeDegreesRef,
      clusterColorsRef,
      nodeToClusterRef,
      labelManagerRef,
    } = labelRefs;

    // Create label manager on mount
    useEffect(() => {
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

      /**
       * Convert 3D world coordinates to screen coordinates with perspective projection.
       * Uses proper perspective projection accounting for Z depth and parallax.
       */
      function worldToScreen3D(world: { x: number; y: number; z: number }): { x: number; y: number } | null {
        const rect = containerEl.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;

        const camera = cameraStateRef.current;

        // Calculate perspective-corrected position
        // Using similar math to Three.js perspective projection
        const dx = world.x - camera.x;
        const dy = world.y - camera.y;
        const dz = world.z - camera.z;

        // Check if behind camera (negative Z in view space)
        if (dz >= 0) return null;

        // Perspective division: project onto near plane
        // FOV determines the projection scale
        const halfFovTan = Math.tan(CAMERA_FOV_RADIANS / 2);
        const aspect = rect.width / rect.height;

        // Project X and Y with perspective
        const ndcX = (dx / (-dz * halfFovTan * aspect));
        const ndcY = (dy / (-dz * halfFovTan));

        // Convert NDC to screen coordinates
        return {
          x: ((ndcX + 1) / 2) * rect.width,
          y: ((1 - ndcY) / 2) * rect.height, // Flip Y (screen Y down, world Y up)
        };
      }

      const labelManager = createLabelOverlayManager({
        container,
        worldToScreen,
        worldToScreen3D,
        getCameraZ: () => cameraStateRef.current.z,
        getNodeRadius: (node: SimNode) => getNodeRadius(node, 1) * DOT_SCALE_FACTOR,
        getClusterColors: () => clusterColorsRef.current,
        getKeywordLabelRange: () => keywordLabelRange,
        getChunkScreenRects: () => labelRefs.chunkScreenRectsRef.current,
        getNodeToCluster: () => nodeToClusterRef.current,
        onKeywordLabelClick,
        onClusterLabelClick,
      });

      labelManagerRef.current = labelManager;

      return () => {
        labelManager.destroy();
        labelManagerRef.current = null;
      };
    }, [containerRef, cameraStateRef, clusterColorsRef, labelManagerRef, keywordLabelRange]);

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
      updateChunkLabels: (parentColors: Map<string, string>) => {
        const manager = labelManagerRef.current;
        const nodes = simNodesRef.current;
        if (manager && nodes.length > 0) {
          manager.updateChunkLabels(nodes, parentColors);
        }
      },
      getNodes: () => simNodesRef.current,
    }), [labelManagerRef, simNodesRef, nodeDegreesRef]);

    // This component doesn't render anything - DOM elements created by label manager
    return null;
  }
);
