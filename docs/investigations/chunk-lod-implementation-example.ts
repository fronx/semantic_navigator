/**
 * Proof-of-concept: Visibility-based culling for chunk nodes
 *
 * This is a minimal implementation example showing how to add visibility culling
 * to the existing updateNodeScales() function in src/lib/three/node-renderer.ts.
 *
 * BEFORE: Chunks scale to 0 but are still rendered (wasteful)
 * AFTER: Chunks with scale < 0.01 are hidden (skip rendering entirely)
 *
 * Performance gain: ~0.5-1ms per frame when zoomed out
 */

// ============================================================================
// CURRENT IMPLEMENTATION (from src/lib/three/node-renderer.ts)
// ============================================================================

interface ScaleValues {
  keywordScale: number;
  chunkScale: number;
}

interface NodeMeshGroup {
  group: THREE.Group;
  fill: THREE.Mesh;
  outline: THREE.Mesh;
  node: SimNode;
}

function updateNodeScales_CURRENT(
  nodeCache: Map<string, NodeMeshGroup>,
  scales: ScaleValues
): void {
  for (const cached of nodeCache.values()) {
    const { node, group } = cached;

    // Apply scale based on node type
    if (node.type === "keyword") {
      group.scale.setScalar(scales.keywordScale);
    } else if (node.type === "chunk") {
      group.scale.setScalar(scales.chunkScale);
    }
    // Projects and articles don't scale (they're always visible)
  }
}

// ============================================================================
// OPTIMIZED IMPLEMENTATION (with visibility culling)
// ============================================================================

/** Threshold below which nodes are considered invisible (1% of full size) */
const VISIBILITY_THRESHOLD = 0.01;

function updateNodeScales_OPTIMIZED(
  nodeCache: Map<string, NodeMeshGroup>,
  scales: ScaleValues
): void {
  for (const cached of nodeCache.values()) {
    const { node, group } = cached;

    // Apply scale based on node type
    if (node.type === "keyword") {
      group.scale.setScalar(scales.keywordScale);
      // Hide keywords when too small to see (optional - keywords usually don't scale to 0)
      group.visible = scales.keywordScale >= VISIBILITY_THRESHOLD;
    } else if (node.type === "chunk") {
      group.scale.setScalar(scales.chunkScale);
      // Hide chunks when too small to see (PRIMARY OPTIMIZATION)
      group.visible = scales.chunkScale >= VISIBILITY_THRESHOLD;
    }
    // Projects and articles don't scale (they're always visible)
  }
}

// ============================================================================
// ALTERNATIVE: More Aggressive Culling
// ============================================================================

/**
 * Alternative implementation with more aggressive culling thresholds.
 * Use this if you want chunks to disappear slightly earlier.
 */
function updateNodeScales_AGGRESSIVE(
  nodeCache: Map<string, NodeMeshGroup>,
  scales: ScaleValues
): void {
  // More aggressive thresholds
  const CHUNK_VISIBILITY_THRESHOLD = 0.05; // Hide when < 5% of full size
  const KEYWORD_VISIBILITY_THRESHOLD = 0.1; // Hide when < 10% of full size

  for (const cached of nodeCache.values()) {
    const { node, group } = cached;

    if (node.type === "keyword") {
      group.scale.setScalar(scales.keywordScale);
      group.visible = scales.keywordScale >= KEYWORD_VISIBILITY_THRESHOLD;
    } else if (node.type === "chunk") {
      group.scale.setScalar(scales.chunkScale);
      group.visible = scales.chunkScale >= CHUNK_VISIBILITY_THRESHOLD;
    }
  }
}

// ============================================================================
// PERFORMANCE MEASUREMENT
// ============================================================================

/**
 * Example: Measure performance impact of visibility culling
 *
 * Run this in the browser console while interacting with the graph:
 *
 * 1. Without culling:
 *    - Open DevTools → Performance
 *    - Record 10 seconds of zooming out
 *    - Note frame time and GPU usage
 *
 * 2. With culling:
 *    - Apply the optimized implementation
 *    - Record 10 seconds of zooming out
 *    - Compare frame time and GPU usage
 *
 * Expected improvement: 0.5-1ms per frame when zoomed out to cameraZ > 10000
 */

// ============================================================================
// TESTING
// ============================================================================

/**
 * Test cases for visibility culling:
 *
 * 1. Very far (cameraZ = 20000):
 *    - chunkScale should be ~0.0
 *    - All chunks should be invisible (group.visible = false)
 *    - Verify no visual difference (chunks already invisible at scale 0)
 *
 * 2. Transition (cameraZ = 5000):
 *    - chunkScale should be ~0.25
 *    - All chunks should be visible (group.visible = true)
 *    - Verify chunks are rendering properly
 *
 * 3. Very close (cameraZ = 50):
 *    - chunkScale should be 1.0
 *    - All chunks should be visible (group.visible = true)
 *    - Verify full-size chunk rendering
 *
 * 4. Edge case (chunkScale = 0.01):
 *    - Chunks should just become visible
 *    - Verify no visual popping or artifacts
 */

// ============================================================================
// INTEGRATION WITH EXISTING CODE
// ============================================================================

/**
 * To integrate this into the existing codebase:
 *
 * 1. Open src/lib/three/node-renderer.ts
 * 2. Find the updateNodeScales() function (around line 290)
 * 3. Add the VISIBILITY_THRESHOLD constant at the top of the file
 * 4. Add the group.visible assignment for chunks (2 lines)
 * 5. Optionally add for keywords as well
 * 6. Test in browser to verify no visual regression
 *
 * Total code change: ~5 lines
 * Risk: Very low (only affects invisible nodes)
 * Benefit: Measurable performance gain when zoomed out
 */

// ============================================================================
// FUTURE: Instanced Rendering (Advanced)
// ============================================================================

/**
 * For reference: If draw calls become a bottleneck, instanced rendering
 * would be the next optimization step. This requires more significant refactoring.
 *
 * Example approach:
 *
 * 1. Create shared geometry for all chunks:
 *    const chunkGeometry = new THREE.CircleGeometry(baseRadius, 64);
 *    const chunkMaterial = new THREE.MeshBasicMaterial();
 *
 * 2. Create instanced mesh:
 *    const chunkInstances = new THREE.InstancedMesh(
 *      chunkGeometry,
 *      chunkMaterial,
 *      CHUNK_COUNT
 *    );
 *
 * 3. Update per-instance attributes each frame:
 *    for (let i = 0; i < chunks.length; i++) {
 *      matrix.setPosition(chunks[i].x, chunks[i].y, chunks[i].z);
 *      matrix.scale.setScalar(chunks[i].scale);
 *      chunkInstances.setMatrixAt(i, matrix);
 *      chunkInstances.setColorAt(i, chunks[i].color);
 *    }
 *    chunkInstances.instanceMatrix.needsUpdate = true;
 *
 * Benefits:
 * - Reduces 266 draw calls to 1 draw call
 * - 10-50x performance improvement for large node counts
 *
 * Complexity:
 * - Requires significant refactoring of node-renderer.ts
 * - Harder to integrate with 3d-force-graph
 * - Only implement if profiling shows draw calls are a real bottleneck
 */

// ============================================================================
// REFERENCES
// ============================================================================

/**
 * Useful links:
 *
 * - Three.js Object3D.visible:
 *   https://threejs.org/docs/#api/en/core/Object3D.visible
 *
 * - Three.js InstancedMesh:
 *   https://threejs.org/docs/#api/en/objects/InstancedMesh
 *
 * - WebGL Performance Best Practices:
 *   https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices
 *
 * - Chrome DevTools Performance:
 *   https://developer.chrome.com/docs/devtools/performance/
 */
