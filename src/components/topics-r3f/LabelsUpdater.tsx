/**
 * Frame-based label update component.
 * Runs inside Canvas and uses useFrame() to:
 * 1. Update cameraStateRef with current camera position
 * 2. Trigger label manager updates every frame
 */

import { useFrame, useThree } from "@react-three/fiber";
import type { LabelRefs } from "./R3FLabelContext";

export interface LabelsUpdaterProps {
  /** All refs needed for label rendering */
  labelRefs: LabelRefs;
}

export function LabelsUpdater({ labelRefs }: LabelsUpdaterProps) {
  const { camera } = useThree();
  const {
    cameraStateRef,
    simNodesRef,
    nodeDegreesRef,
    labelManagerRef,
  } = labelRefs;

  useFrame(() => {
    // Update camera state ref (read by LabelsOverlay's worldToScreen)
    cameraStateRef.current = {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
    };

    // Trigger label updates
    const manager = labelManagerRef.current;
    const nodes = simNodesRef.current;
    if (!manager || nodes.length === 0) return;

    manager.updateClusterLabels(nodes);
    manager.updateKeywordLabels(nodes, nodeDegreesRef.current);
    manager.syncChunkPreview();
  });

  return null;
}
