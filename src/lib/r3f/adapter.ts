/**
 * Renderer adapter for R3F renderer.
 * Implements RendererAdapter interface to bridge with hover controller.
 */

import * as THREE from "three";
import type { RendererAdapter } from "@/lib/topics-hover-controller";
import type { SimNode } from "@/lib/map-renderer";
import { CAMERA_Z_SCALE_BASE } from "@/lib/rendering-utils/camera-controller";

export interface R3FAdapterOptions {
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  getNodes: () => SimNode[];
  getHoveredNode: () => SimNode | null;
  applyHighlightCallback: (ids: Set<string> | null, baseDim: number) => void;
}

/**
 * Create a RendererAdapter for the R3F renderer.
 */
export function createR3FAdapter(options: R3FAdapterOptions): RendererAdapter {
  const { camera, scene, getNodes, getHoveredNode, applyHighlightCallback } = options;

  return {
    getTransform() {
      // Zoom scale k = CAMERA_Z_SCALE_BASE / cameraZ
      const k = CAMERA_Z_SCALE_BASE / camera.position.z;
      return {
        k,
        x: -camera.position.x,
        y: -camera.position.y,
      };
    },

    screenToWorld(screen: { x: number; y: number }) {
      // Convert screen coordinates to world coordinates using camera.unproject
      const canvas = scene.userData.canvas as HTMLCanvasElement | undefined;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      const x = (screen.x / rect.width) * 2 - 1;
      const y = -(screen.y / rect.height) * 2 + 1;

      const vector = new THREE.Vector3(x, y, 0);
      vector.unproject(camera);

      return { x: vector.x, y: vector.y };
    },

    isHoveringProject() {
      const hovered = getHoveredNode();
      return hovered?.type === "project";
    },

    getNodes,

    applyHighlight(ids: Set<string> | null, baseDim: number) {
      applyHighlightCallback(ids, baseDim);
    },

    getCameraZ() {
      return camera.position.z;
    },
  };
}
