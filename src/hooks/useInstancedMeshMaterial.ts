/**
 * Hook to initialize instanceColor and material for an instancedMesh.
 * Ensures vertex colors work by creating the material after instanceColor exists.
 */

import { useRef } from "react";
import * as THREE from "three";

export function useInstancedMeshMaterial(instanceCount: number) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial | null>(null);

  const handleMeshRef = (mesh: THREE.InstancedMesh | null) => {
    meshRef.current = mesh;

    if (mesh && !mesh.instanceColor) {
      // FIRST: Create instanceColor attribute with default white color
      const colors = new Float32Array(instanceCount * 3);
      for (let i = 0; i < instanceCount; i++) {
        colors[i * 3] = 1; // R
        colors[i * 3 + 1] = 1; // G
        colors[i * 3 + 2] = 1; // B
      }
      mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
      mesh.instanceColor.needsUpdate = true;

      // SECOND: Create and attach material AFTER instanceColor exists
      // This ensures the shader compiles with vertex color support from the start

      // Dispose old material if it exists
      if (mesh.material) {
        (mesh.material as THREE.Material).dispose();
      }

      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0xffffff),
        transparent: false,
        depthTest: true,
        depthWrite: true,
      });
      material.toneMapped = false;
      mesh.material = material;
      materialRef.current = material;

      // CRITICAL: Force shader recompilation to include instanceColor support
      material.needsUpdate = true;
    }
  };

  return { meshRef, materialRef, handleMeshRef };
}
