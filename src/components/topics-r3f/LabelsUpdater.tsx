/**
 * Frame-based label update component.
 * Runs inside Canvas and uses useFrame() to:
 * 1. Update cameraStateRef with current camera position
 * 2. Trigger label manager updates every frame
 */

import { useFrame, useThree } from "@react-three/fiber";
import { calculateScales } from "@/lib/chunk-scale";
import { DEFAULT_ZOOM_PHASE_CONFIG } from "@/lib/zoom-phase-config";
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
    const cameraZ = camera.position.z;
    cameraStateRef.current = {
      x: camera.position.x,
      y: camera.position.y,
      z: cameraZ,
    };

    // Trigger label updates
    const manager = labelManagerRef.current;
    const nodes = simNodesRef.current;
    if (!manager || nodes.length === 0) return;

    manager.updateClusterLabels(nodes);
    manager.updateKeywordLabels(nodes, nodeDegreesRef.current);

    // Build parent color map for chunk labels
    // Note: Chunk nodes will receive color from their parent keywords via label manager
    const parentColors = new Map<string, string>();
    manager.updateChunkLabels(nodes, parentColors);

    // Update label opacity based on zoom level (fades chunk labels in/out)
    const scales = calculateScales(cameraZ, DEFAULT_ZOOM_PHASE_CONFIG.chunkCrossfade);
    manager.updateLabelOpacity(scales);

    manager.syncChunkPreview();

    // Update hover label based on cursor position
    manager.updateHoverLabel(nodes);
  });

  return null;
}
