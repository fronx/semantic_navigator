/**
 * Shared pan event handler for Three.js and R3F renderers.
 * Framework-agnostic implementation that attaches mouse event listeners.
 */

import { calculatePan } from "./pan-camera";

export interface PanHandlerOptions {
  /** Canvas element to attach event listeners to */
  canvas: HTMLElement;
  /** Get current camera Z position */
  getCameraZ: () => number;
  /** Called with world-space deltas and mouse position when panning */
  onPan: (worldDeltaX: number, worldDeltaY: number, mouseX: number, mouseY: number) => void;
  /** Called when pan starts with initial mouse position (optional) */
  onPanStart?: (mouseX: number, mouseY: number) => void;
  /** Called when pan ends (optional) */
  onPanEnd?: () => void;
  /** Check if pan should start (optional - allows custom checks like project drag detection) */
  shouldStartPan?: (event: MouseEvent) => boolean;
}

/**
 * Create pan event handlers and attach them to the canvas.
 * Returns a cleanup function to remove event listeners.
 */
export function createPanHandler(options: PanHandlerOptions): () => void {
  const { canvas, getCameraZ, onPan, onPanStart, onPanEnd, shouldStartPan } = options;

  // Pan state
  let isPanning = false;
  let isPointerDown = false;
  let startMouseX = 0;
  let startMouseY = 0;
  let lastMouseX = 0;
  let lastMouseY = 0;

  // Minimum pixels the mouse must move before panning starts.
  // Prevents tiny movements during a click from triggering a pan,
  // which would shift the camera and cause R3F's raycaster to miss
  // the instancedMesh instance on pointerup.
  const DRAG_THRESHOLD = 4;

  const handleMouseDown = (event: MouseEvent) => {
    // Only pan on left click
    if (event.button !== 0) return;

    // Allow caller to prevent pan (e.g., when dragging project nodes)
    if (shouldStartPan && !shouldStartPan(event)) return;

    isPointerDown = true;
    startMouseX = event.clientX;
    startMouseY = event.clientY;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (!isPointerDown) return;

    // Check drag threshold before starting pan
    if (!isPanning) {
      const dx = event.clientX - startMouseX;
      const dy = event.clientY - startMouseY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;

      // Threshold exceeded - start panning
      isPanning = true;
      canvas.style.cursor = "grabbing";
      onPanStart?.(startMouseX, startMouseY);
    }

    const deltaX = event.clientX - lastMouseX;
    const deltaY = event.clientY - lastMouseY;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;

    // Calculate pan using shared logic
    const rect = canvas.getBoundingClientRect();
    const { worldDeltaX, worldDeltaY } = calculatePan({
      screenDeltaX: deltaX,
      screenDeltaY: deltaY,
      cameraZ: getCameraZ(),
      containerWidth: rect.width,
      containerHeight: rect.height,
    });

    onPan(worldDeltaX, worldDeltaY, event.clientX, event.clientY);
  };

  const handleMouseUp = () => {
    if (isPanning) {
      canvas.style.cursor = "grab";
      onPanEnd?.();
    }
    isPanning = false;
    isPointerDown = false;
  };

  // Attach event listeners
  canvas.addEventListener('mousedown', handleMouseDown);
  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('mouseup', handleMouseUp);
  canvas.addEventListener('mouseleave', handleMouseUp);

  // Return cleanup function
  return () => {
    canvas.removeEventListener('mousedown', handleMouseDown);
    canvas.removeEventListener('mousemove', handleMouseMove);
    canvas.removeEventListener('mouseup', handleMouseUp);
    canvas.removeEventListener('mouseleave', handleMouseUp);
  };
}
