import { useEffect, RefObject } from "react";

/**
 * Forwards wheel events from DOM overlay elements to a target element.
 *
 * When you have DOM elements overlaid on top of a canvas (e.g., labels, controls),
 * wheel events on those elements won't reach the canvas. This hook ensures all wheel
 * events within the container are forwarded to the target element, enabling consistent
 * zoom/pan behavior regardless of where the user scrolls.
 *
 * Implementation:
 * - Adds a non-passive wheel listener to the container (allows preventDefault)
 * - Prevents default browser scroll behavior
 * - If the event target is not the target element, creates and dispatches a synthetic
 *   WheelEvent to the target with all original properties preserved
 *
 * @param containerRef - Ref to the container element that wraps both target and overlays
 * @param targetSelector - CSS selector for the target element (default: "canvas")
 *
 * @example
 * ```tsx
 * const containerRef = useRef<HTMLDivElement>(null);
 * useWheelEventForwarding(containerRef); // Defaults to "canvas"
 * // Or specify a custom selector:
 * useWheelEventForwarding(containerRef, "#my-canvas");
 *
 * return (
 *   <div ref={containerRef}>
 *     <canvas />
 *     <div className="overlay">Labels</div>
 *   </div>
 * );
 * ```
 */
export function useWheelEventForwarding(
  containerRef: RefObject<HTMLElement | null>,
  targetSelector: string = "canvas"
) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      // Forward wheel events from overlay elements to target
      const target = container.querySelector(targetSelector);
      if (!target) return;

      // If event target is not the target element (i.e., from overlay),
      // dispatch a synthetic wheel event to the target
      if (e.target !== target) {
        const syntheticEvent = new WheelEvent("wheel", {
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          deltaZ: e.deltaZ,
          deltaMode: e.deltaMode,
          clientX: e.clientX,
          clientY: e.clientY,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
          view: e.view,
          bubbles: true,
          cancelable: true,
        });
        target.dispatchEvent(syntheticEvent);
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, [containerRef, targetSelector]);
}
