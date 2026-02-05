/**
 * Classifies wheel events into gesture types for consistent handling across renderers.
 * Enables intuitive trackpad gestures: scroll-to-pan, pinch-to-zoom.
 */

export type GestureType = 'pinch' | 'scroll-pan' | 'scroll-zoom';

/**
 * Classify a wheel event based on modifier keys.
 *
 * @param event - WheelEvent from browser
 * @returns Gesture type:
 *   - 'pinch': Trackpad pinch gesture (ctrlKey set by browser)
 *   - 'scroll-zoom': Scroll with modifier key held (cmd/alt)
 *   - 'scroll-pan': Plain scroll (no modifiers)
 */
export function classifyWheelGesture(event: WheelEvent): GestureType {
  // Trackpad pinch: browser sets ctrlKey automatically
  if (event.ctrlKey) {
    return 'pinch';
  }

  // Modifier key held: treat scroll as zoom
  if (event.metaKey || event.altKey) {
    return 'scroll-zoom';
  }

  // Default: scroll is for panning
  return 'scroll-pan';
}
