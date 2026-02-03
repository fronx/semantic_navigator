/**
 * Frosted glass transmission panel between keyword and chunk layers.
 * Uses MeshTransmissionMaterial for blur effect (inspired by drei Nike example).
 */

import { MeshTransmissionMaterial } from "@react-three/drei";
import { CHUNK_Z_DEPTH } from "@/lib/chunk-zoom-config";

export interface TransmissionPanelProps {
  enabled?: boolean;
}

export function TransmissionPanel({ enabled = true }: TransmissionPanelProps) {
  if (!enabled) return null;

  // Position panel halfway between keywords (z=0) and chunks (z=CHUNK_Z_DEPTH)
  const panelZ = CHUNK_Z_DEPTH / 2; // e.g., -75 if chunks at -150

  // Large enough to cover the viewport at all zoom levels
  const panelSize = 50000;

  return (
    <mesh position={[0, 0, panelZ]}>
      <planeGeometry args={[panelSize, panelSize]} />
      <MeshTransmissionMaterial
        samples={16}
        resolution={512}
        anisotropicBlur={0.1}
        thickness={0.1}
        roughness={0.5}
        toneMapped={true}
        transparent
        opacity={0.8}
      />
    </mesh>
  );
}
