/**
 * Generic hook for dragging instances in an instancedMesh.
 *
 * Only onPointerDown uses R3F's raycasting (to pick which instance was hit).
 * Once a drag starts, move/end tracking switches to DOM-level pointer events
 * on the canvas so the drag continues even when the cursor leaves all instances
 * (common in focus mode where only a few instances are visible).
 */

import { useRef, useCallback, useEffect } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

export interface UseInstancedMeshDragOptions {
  /** Pick which instance (if any) was clicked. Return null to ignore the event. */
  pickInstance: (event: ThreeEvent<PointerEvent>) => number | null;
  /** Called when drag starts. Use to fix the instance position in the simulation. */
  onDragStart: (index: number) => void;
  /** Called during drag with world coordinates at z=0 plane. */
  onDrag: (index: number, worldX: number, worldY: number) => void;
  /** Called when drag ends. Use to unfix the instance in the simulation. */
  onDragEnd: (index: number) => void;
  /** Whether dragging is enabled (default: true). */
  enabled?: boolean;
  /** Called when drag state toggles (true while pointer is dragging). */
  onDragStateChange?: (dragging: boolean) => void;
  /** Called when pointer is released without dragging (click). */
  onClick?: (index: number) => void;
}

/**
 * Returns event handlers for dragging instances in an instancedMesh.
 * Attach onPointerDown to the mesh. Move/end tracking is handled at the DOM level.
 */
export function useInstancedMeshDrag({
  pickInstance,
  onDragStart,
  onDrag,
  onDragEnd,
  enabled = true,
  onDragStateChange,
  onClick,
}: UseInstancedMeshDragOptions) {
  const { camera, gl } = useThree();

  // Store callbacks in refs so DOM handlers always call the latest versions
  // without needing to re-attach listeners on every render.
  const callbacksRef = useRef({ onDragStart, onDrag, onDragEnd, onDragStateChange, onClick });
  callbacksRef.current = { onDragStart, onDrag, onDragEnd, onDragStateChange, onClick };

  // Track active drag state
  const dragStateRef = useRef<{
    index: number;
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
    dragStarted: boolean;
  } | null>(null);

  // Reusable vectors for NDC-to-world projection (avoid per-move allocations)
  const ndcVec = useRef(new THREE.Vector3());
  const dirVec = useRef(new THREE.Vector3());
  const DRAG_THRESHOLD_PX = 4;

  /** Convert client coords to world coords at z=0 plane. */
  const clientToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect();
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
      ndcVec.current.set(ndcX, ndcY, 0).unproject(camera);
      dirVec.current.copy(ndcVec.current).sub(camera.position);
      const t = -camera.position.z / dirVec.current.z;
      return {
        x: camera.position.x + dirVec.current.x * t,
        y: camera.position.y + dirVec.current.y * t,
      };
    },
    [camera, gl],
  );

  // Clean up DOM listeners if the component unmounts mid-drag.
  const domListenersRef = useRef<{ move: (e: PointerEvent) => void; end: (e: PointerEvent) => void } | null>(null);
  useEffect(() => {
    return () => {
      if (domListenersRef.current) {
        const canvas = gl.domElement;
        canvas.removeEventListener("pointermove", domListenersRef.current.move);
        canvas.removeEventListener("pointerup", domListenersRef.current.end);
        canvas.removeEventListener("pointercancel", domListenersRef.current.end);
        domListenersRef.current = null;
      }
    };
  }, [gl]);

  const handlePointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!enabled) return;

      event.stopPropagation();
      const index = pickInstance(event);
      if (index === null) return;

      const { clientX, clientY } = event.nativeEvent;
      dragStateRef.current = {
        index,
        pointerId: event.pointerId,
        startX: clientX,
        startY: clientY,
        moved: false,
        dragStarted: false,
      };
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);

      const canvas = gl.domElement;

      // DOM-level move handler — survives even when the pointer leaves all instances.
      const domMove = (e: PointerEvent) => {
        const state = dragStateRef.current;
        if (!state || e.pointerId !== state.pointerId) return;

        if (!state.moved) {
          const dx = e.clientX - state.startX;
          const dy = e.clientY - state.startY;
          if (dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
            state.moved = true;
          }
        }

        if (state.moved && !state.dragStarted) {
          state.dragStarted = true;
          callbacksRef.current.onDragStart(state.index);
          callbacksRef.current.onDragStateChange?.(true);
        }

        if (!state.dragStarted) return;

        const world = clientToWorld(e.clientX, e.clientY);
        callbacksRef.current.onDrag(state.index, world.x, world.y);
      };

      // DOM-level up/cancel handler.
      const domEnd = (e: PointerEvent) => {
        const state = dragStateRef.current;
        if (!state || e.pointerId !== state.pointerId) return;

        if (state.dragStarted) {
          callbacksRef.current.onDragEnd(state.index);
          callbacksRef.current.onDragStateChange?.(false);
        }
        try {
          (event.target as HTMLElement).releasePointerCapture?.(e.pointerId);
        } catch { /* already released */ }
        if (!state.dragStarted && callbacksRef.current.onClick) {
          callbacksRef.current.onClick(state.index);
        }
        dragStateRef.current = null;

        canvas.removeEventListener("pointermove", domMove);
        canvas.removeEventListener("pointerup", domEnd);
        canvas.removeEventListener("pointercancel", domEnd);
        domListenersRef.current = null;
      };

      canvas.addEventListener("pointermove", domMove);
      canvas.addEventListener("pointerup", domEnd);
      canvas.addEventListener("pointercancel", domEnd);
      domListenersRef.current = { move: domMove, end: domEnd };
    },
    [enabled, pickInstance, clientToWorld, gl],
  );

  return {
    onPointerDown: enabled ? handlePointerDown : undefined,
  };
}
