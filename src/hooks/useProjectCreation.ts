/**
 * Hook for cursor tracking and project creation via keyboard.
 *
 * Handles:
 * - Tracking hover state over the graph container
 * - Tracking cursor position (screen and world coordinates)
 * - 'N' key handler to create a project at cursor position
 */

import { useEffect, useRef } from "react";
import { useStableCallback } from "@/hooks/useStableRef";

export interface UseProjectCreationOptions {
  onCreateProject?: (
    worldPos: { x: number; y: number },
    screenPos: { x: number; y: number }
  ) => void;
}

export interface UseProjectCreationResult {
  /** Whether the cursor is currently hovering over the graph container */
  isHoveringRef: React.MutableRefObject<boolean>;
  /** Current cursor position in world coordinates (null when not hovering) */
  cursorWorldPosRef: React.MutableRefObject<{ x: number; y: number } | null>;
  /** Current cursor position in screen coordinates (null when not hovering) */
  cursorScreenPosRef: React.MutableRefObject<{ x: number; y: number } | null>;
}

/**
 * Track cursor position and handle 'N' key for project creation.
 *
 * @example
 * const { isHoveringRef, cursorWorldPosRef, cursorScreenPosRef } = useProjectCreation({
 *   onCreateProject: (worldPos, screenPos) => {
 *     // Create project at worldPos
 *   },
 * });
 *
 * // In event handlers:
 * onMouseEnter: () => { isHoveringRef.current = true; }
 * onMouseMove: (e) => {
 *   cursorScreenPosRef.current = { x: e.clientX, y: e.clientY };
 *   cursorWorldPosRef.current = screenToWorld(cursorScreenPosRef.current);
 * }
 * onMouseLeave: () => {
 *   isHoveringRef.current = false;
 *   cursorWorldPosRef.current = null;
 *   cursorScreenPosRef.current = null;
 * }
 */
export function useProjectCreation(
  options: UseProjectCreationOptions
): UseProjectCreationResult {
  const { onCreateProject } = options;

  const isHoveringRef = useRef(false);
  const cursorWorldPosRef = useRef<{ x: number; y: number } | null>(null);
  const cursorScreenPosRef = useRef<{ x: number; y: number } | null>(null);

  const handleCreateProject = useStableCallback(onCreateProject);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only trigger on 'N' key when hovering and not typing in an input
      if (e.key !== "n" && e.key !== "N") return;
      if (!isHoveringRef.current) return;
      if (!cursorWorldPosRef.current || !cursorScreenPosRef.current) return;

      // Don't trigger if user is typing in an input field
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      e.preventDefault();
      handleCreateProject(cursorWorldPosRef.current, cursorScreenPosRef.current);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleCreateProject]);

  return { isHoveringRef, cursorWorldPosRef, cursorScreenPosRef };
}
