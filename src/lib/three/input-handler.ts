/**
 * Input handler for the Three.js renderer.
 * Handles mouse pan, wheel zoom, and click/drag detection.
 */

import type { CameraController } from "./camera-controller";
import type { AutoFitState } from "@/lib/auto-fit";
import { markUserInteraction } from "@/lib/auto-fit";
import type { SimNode } from "@/lib/map-renderer";
import { createPanHandler } from "./pan-handler";
import { classifyWheelGesture } from "./gesture-classifier";
import { calculatePan } from "./pan-camera";

export interface InputHandlerOptions {
  container: HTMLElement;
  cameraController: CameraController;
  autoFitState: AutoFitState;
  /** Get currently hovered node (to avoid panning when over project) */
  getHoveredNode: () => SimNode | null;
  /** Called during zoom gesture (for hover highlight updates) */
  onZoom?: () => void;
  /** Called after zoom/pan settles */
  onZoomEnd?: () => void;
  /** Called when labels need updating (during pan/zoom) */
  onLabelsUpdate: () => void;
}

export interface InputHandler {
  /** Check if currently dragging a project node */
  isDraggingProject(): boolean;
  /** Set dragging project state (called by graph's onNodeDrag) */
  setDraggingProject(dragging: boolean): void;
  /** Mark that a project was just dragged (to suppress click) */
  markProjectDragged(): void;
  /** Clean up event listeners */
  destroy(): void;
}

export function createInputHandler(options: InputHandlerOptions): InputHandler {
  const {
    container,
    cameraController,
    autoFitState,
    getHoveredNode,
    onZoom,
    onZoomEnd,
    onLabelsUpdate,
  } = options;

  // Drag vs click detection
  let startMouseX = 0;
  let startMouseY = 0;
  let wasDrag = false;
  const DRAG_THRESHOLD = 5; // pixels

  // Project node drag state
  let isDraggingProjectNode = false;
  let projectWasDragged = false;

  // Zoom debounce
  let zoomEndTimeout: ReturnType<typeof setTimeout> | null = null;

  // Create shared pan handler
  const cleanupPanHandler = createPanHandler({
    canvas: container,
    getCameraZ: () => cameraController.getCameraZ(),
    onPan: (worldDeltaX, worldDeltaY, mouseX, mouseY) => {
      // Check if movement exceeds drag threshold
      const dx = Math.abs(mouseX - startMouseX);
      const dy = Math.abs(mouseY - startMouseY);
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
        wasDrag = true;
      }

      cameraController.applyWorldPan(worldDeltaX, worldDeltaY);
      onLabelsUpdate();
    },
    onPanStart: (mouseX, mouseY) => {
      startMouseX = mouseX;
      startMouseY = mouseY;
      wasDrag = false;
    },
    onPanEnd: () => {
      markUserInteraction(autoFitState);
      cameraController.notifyZoomChange();
      onZoomEnd?.();
    },
    shouldStartPan: (event) => {
      // Don't pan if already dragging a project node
      if (isDraggingProjectNode) return false;

      // If hovering over a project node, let 3d-force-graph handle it
      const hoveredNode = getHoveredNode();
      if (hoveredNode?.type === "project") return false;

      return true;
    },
  });

  // Suppress click events that were actually drags
  const handleClick = (event: MouseEvent) => {
    if (wasDrag || projectWasDragged) {
      event.stopPropagation();
    }
    // Reset for next interaction
    wasDrag = false;
    projectWasDragged = false;
  };

  const handleWheel = (event: WheelEvent) => {
    event.preventDefault();

    const gesture = classifyWheelGesture(event);
    const rect = container.getBoundingClientRect();

    if (gesture === 'scroll-pan') {
      // Two-finger scroll without modifiers → pan
      const { worldDeltaX, worldDeltaY } = calculatePan({
        screenDeltaX: -event.deltaX,  // Negative for natural scroll direction
        screenDeltaY: -event.deltaY,
        cameraZ: cameraController.getCameraZ(),
        containerWidth: rect.width,
        containerHeight: rect.height,
      });

      cameraController.applyWorldPan(worldDeltaX, worldDeltaY);
      markUserInteraction(autoFitState);
      onLabelsUpdate();

      // Notify end of pan (debounced)
      if (zoomEndTimeout) clearTimeout(zoomEndTimeout);
      zoomEndTimeout = setTimeout(() => {
        cameraController.notifyZoomChange();
        onZoomEnd?.();
      }, 150);
    } else {
      // 'pinch' or 'scroll-zoom' → zoom to cursor
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;

      // Convert mouse position to normalized device coordinates (-1 to +1)
      const ndcX = (mouseX / rect.width) * 2 - 1;
      const ndcY = -(mouseY / rect.height) * 2 + 1;

      cameraController.zoom(event.deltaY, { x: ndcX, y: ndcY });
      markUserInteraction(autoFitState);
      onLabelsUpdate();

      // Notify for hover highlight recalculation during zoom
      onZoom?.();

      // Debounce callback to avoid React re-renders during zoom
      if (zoomEndTimeout) clearTimeout(zoomEndTimeout);
      zoomEndTimeout = setTimeout(() => {
        cameraController.notifyZoomChange();
        onZoomEnd?.();
      }, 150);
    }
  };

  // Attach event listeners (pan handled by shared handler)
  container.addEventListener("click", handleClick, true); // capture phase
  container.addEventListener("wheel", handleWheel, { passive: false });

  return {
    isDraggingProject() {
      return isDraggingProjectNode;
    },

    setDraggingProject(dragging: boolean) {
      isDraggingProjectNode = dragging;
    },

    markProjectDragged() {
      projectWasDragged = true;
    },

    destroy() {
      if (zoomEndTimeout) clearTimeout(zoomEndTimeout);
      cleanupPanHandler(); // Cleanup shared pan handler
      container.removeEventListener("click", handleClick, true);
      container.removeEventListener("wheel", handleWheel);
    },
  };
}
