/**
 * Generic hook for dragging instances in an instancedMesh.
 * Handles pointer capture, NDC-to-world coordinate conversion at z=0 plane,
 * and provides stable event handlers that work during fast mouse movement.
 */

import { useRef, useCallback } from "react";
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
 * Attach to onPointerDown, onPointerMove, onPointerUp, onPointerCancel.
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
    },
    [enabled, pickInstance]
  );

  const handlePointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!enabled) return;

      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;

      if (!state.moved) {
        const dx = event.nativeEvent.clientX - state.startX;
        const dy = event.nativeEvent.clientY - state.startY;
        if (dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
          state.moved = true;
        }
      }

      if (state.moved && !state.dragStarted) {
        state.dragStarted = true;
        onDragStart(state.index);
        onDragStateChange?.(true);
      }

      if (!state.dragStarted) return;

      // Convert mouse position to NDC using native event for accuracy during fast movement
      const rect = gl.domElement.getBoundingClientRect();
      const ndcX = ((event.nativeEvent.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((event.nativeEvent.clientY - rect.top) / rect.height) * 2 + 1;

      // Unproject NDC to world, then intersect with z=0 plane
      ndcVec.current.set(ndcX, ndcY, 0).unproject(camera);
      dirVec.current.copy(ndcVec.current).sub(camera.position);
      const t = -camera.position.z / dirVec.current.z;
      const worldX = camera.position.x + dirVec.current.x * t;
      const worldY = camera.position.y + dirVec.current.y * t;

      onDrag(state.index, worldX, worldY);
    },
    [enabled, onDrag, camera, gl]
  );

  const handlePointerEnd = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!enabled) return;

      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;

      if (state.dragStarted) {
        onDragEnd(state.index);
        onDragStateChange?.(false);
      }
      (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
      if (!state.dragStarted && onClick) {
        onClick(state.index);
      }
      dragStateRef.current = null;
    },
    [enabled, onDragEnd, onDragStateChange, onClick]
  );

  return {
    onPointerDown: enabled ? handlePointerDown : undefined,
    onPointerMove: enabled ? handlePointerMove : undefined,
    onPointerUp: enabled ? handlePointerEnd : undefined,
    onPointerCancel: enabled ? handlePointerEnd : undefined,
  };
}
