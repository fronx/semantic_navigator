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
  let lastMouseX = 0;
  let lastMouseY = 0;

  const handleMouseDown = (event: MouseEvent) => {
    // Only pan on left click
    if (event.button !== 0) return;

    // Allow caller to prevent pan (e.g., when dragging project nodes)
    if (shouldStartPan && !shouldStartPan(event)) return;

    isPanning = true;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
    canvas.style.cursor = "grabbing";

    onPanStart?.(event.clientX, event.clientY);
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (!isPanning) return;

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
      isPanning = false;
      canvas.style.cursor = "grab";
      onPanEnd?.();
    }
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
