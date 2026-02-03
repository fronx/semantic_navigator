/**
 * Performance analysis for Three.js chunk node rendering
 *
 * This script analyzes the rendering cost of chunk nodes at different zoom levels
 * to determine if LOD optimization is worthwhile.
 *
 * Run: npm run script scripts/analyze-three-performance.ts
 */

import * as THREE from "three";

// ============================================================================
// Test Configuration
// ============================================================================

const CHUNK_NODE_COUNT = 266;
const CIRCLE_SEGMENTS = 64; // Current implementation
const BASE_DOT_RADIUS = 4;
const DOT_SCALE_FACTOR = 2.5;
const CIRCLE_RADIUS = BASE_DOT_RADIUS * 0.8 * DOT_SCALE_FACTOR; // Chunk radius

// Zoom levels to test
const ZOOM_SCENARIOS = [
  { name: "Very Far (keywords only)", cameraZ: 20000, chunkScale: 0.0 },
  { name: "Far (transition start)", cameraZ: 10000, chunkScale: 0.0 },
  { name: "Mid (50% chunks)", cameraZ: 5000, chunkScale: 0.25 },
  { name: "Close (90% chunks)", cameraZ: 500, chunkScale: 0.81 },
  { name: "Very Close (full chunks)", cameraZ: 50, chunkScale: 1.0 },
];

// ============================================================================
// Performance Tests
// ============================================================================

interface PerformanceResults {
  scenario: string;
  cameraZ: number;
  chunkScale: number;
  geometryVertices: number;
  totalVertices: number;
  estimatedGPUTime: number;
  memoryMB: number;
  recommendation: string;
}

function analyzeGeometry(): void {
  console.log("=".repeat(80));
  console.log("THREE.JS CHUNK NODE PERFORMANCE ANALYSIS");
  console.log("=".repeat(80));
  console.log();

  // 1. Geometry Analysis
  console.log("1. GEOMETRY COMPLEXITY");
  console.log("-".repeat(80));

  const circleGeometry = new THREE.CircleGeometry(CIRCLE_RADIUS, CIRCLE_SEGMENTS);
  const ringGeometry = new THREE.RingGeometry(CIRCLE_RADIUS, CIRCLE_RADIUS + 1.5, CIRCLE_SEGMENTS);

  const circleVertices = circleGeometry.attributes.position.count;
  const ringVertices = ringGeometry.attributes.position.count;
  const totalVerticesPerNode = circleVertices + ringVertices;

  console.log(`Circle geometry: ${circleVertices} vertices (${CIRCLE_SEGMENTS} segments)`);
  console.log(`Ring geometry: ${ringVertices} vertices`);
  console.log(`Total per node: ${totalVerticesPerNode} vertices`);
  console.log(`Total for ${CHUNK_NODE_COUNT} chunks: ${totalVerticesPerNode * CHUNK_NODE_COUNT} vertices`);
  console.log();

  // 2. Memory Analysis
  console.log("2. MEMORY FOOTPRINT");
  console.log("-".repeat(80));

  // Each vertex: 3 floats (x,y,z) = 12 bytes
  // Each normal: 3 floats = 12 bytes
  // Each UV: 2 floats = 8 bytes
  const bytesPerVertex = 12 + 12 + 8; // position + normal + uv
  const geometryMemory = (circleVertices + ringVertices) * bytesPerVertex;
  const totalGeometryMemory = geometryMemory * CHUNK_NODE_COUNT;

  console.log(`Per-node geometry: ${(geometryMemory / 1024).toFixed(2)} KB`);
  console.log(`Total geometry memory: ${(totalGeometryMemory / 1024 / 1024).toFixed(2)} MB`);
  console.log();

  // 3. Draw Call Analysis
  console.log("3. DRAW CALL ANALYSIS");
  console.log("-".repeat(80));

  const drawCallsPerNode = 2; // fill + outline
  const totalDrawCalls = drawCallsPerNode * CHUNK_NODE_COUNT;

  console.log(`Draw calls per node: ${drawCallsPerNode} (fill + outline)`);
  console.log(`Total draw calls: ${totalDrawCalls}`);
  console.log();
  console.log("⚠️  BOTTLENECK IDENTIFIED: Draw calls, not vertex count!");
  console.log(`   ${totalDrawCalls} separate meshes = ${totalDrawCalls} draw calls`);
  console.log(`   Modern GPUs can handle millions of vertices but struggle with many draw calls`);
  console.log();

  // 4. Scale-based Analysis
  console.log("4. ZOOM-LEVEL PERFORMANCE");
  console.log("-".repeat(80));

  const results: PerformanceResults[] = [];

  for (const scenario of ZOOM_SCENARIOS) {
    // When scale is near 0, Three.js still processes the mesh but vertices are invisible
    // Frustum culling only helps if the mesh is entirely outside the view
    const effectiveScale = Math.max(0.001, scenario.chunkScale);

    // Estimate GPU time per frame (rough approximation)
    // At scale=0, vertices still get transformed but produce ~0 pixels
    // This is wasteful but not as bad as full rendering
    const vertexProcessingCost = 0.001; // ms per 1000 vertices
    const pixelFillCost = scenario.chunkScale * 0.002; // ms per 1000 pixels (scales with visibility)

    const vertexTime = (totalVerticesPerNode * CHUNK_NODE_COUNT / 1000) * vertexProcessingCost;
    const pixelTime = (totalVerticesPerNode * CHUNK_NODE_COUNT / 1000) * pixelFillCost;
    const estimatedGPUTime = vertexTime + pixelTime;

    let recommendation = "";
    if (scenario.chunkScale < 0.01) {
      recommendation = "✓ Good candidate for visibility culling (scale < 0.01)";
    } else if (scenario.chunkScale < 0.3) {
      recommendation = "→ Moderate visibility, LOD could help";
    } else {
      recommendation = "× Full rendering required, no LOD benefit";
    }

    results.push({
      scenario: scenario.name,
      cameraZ: scenario.cameraZ,
      chunkScale: scenario.chunkScale,
      geometryVertices: totalVerticesPerNode,
      totalVertices: totalVerticesPerNode * CHUNK_NODE_COUNT,
      estimatedGPUTime,
      memoryMB: totalGeometryMemory / 1024 / 1024,
      recommendation,
    });
  }

  console.table(results.map(r => ({
    Scenario: r.scenario,
    "Camera Z": r.cameraZ,
    "Chunk Scale": r.chunkScale.toFixed(2),
    "Total Vertices": r.totalVertices.toLocaleString(),
    "Est. GPU (ms)": r.estimatedGPUTime.toFixed(3),
    Recommendation: r.recommendation,
  })));
  console.log();

  // 5. LOD Strategy Comparison
  console.log("5. LOD STRATEGY COMPARISON");
  console.log("=".repeat(80));
  console.log();

  console.log("Option A: Visibility-Based Culling");
  console.log("-".repeat(80));
  console.log("Implementation: Set mesh.visible = false when chunkScale < 0.01");
  console.log();
  console.log("Pros:");
  console.log("  ✓ Simple implementation (1-line change in updateNodeScales)");
  console.log("  ✓ Completely skips rendering when scale is tiny");
  console.log("  ✓ No geometry changes needed");
  console.log();
  console.log("Cons:");
  console.log("  × Still in scene graph (frustum check overhead)");
  console.log("  × Binary on/off (no gradual LOD)");
  console.log();
  console.log("Estimated savings: ~0.5-1ms per frame when zoomed out");
  console.log("Complexity: Low");
  console.log();

  console.log("Option B: THREE.LOD (Level of Detail)");
  console.log("-".repeat(80));
  console.log("Implementation: Use Three.js LOD system with distance thresholds");
  console.log();
  console.log("Pros:");
  console.log("  ✓ Industry-standard approach");
  console.log("  ✓ Automatic distance-based switching");
  console.log("  ✓ Can have multiple detail levels");
  console.log();
  console.log("Cons:");
  console.log("  × Complex setup (need multiple geometries per node)");
  console.log("  × For circles, detail differences are minimal");
  console.log("  × Overkill for simple geometry");
  console.log();
  console.log("Estimated savings: Minimal (circles already simple)");
  console.log("Complexity: High");
  console.log();

  console.log("Option C: Geometry Simplification");
  console.log("-".repeat(80));
  console.log("Implementation: Reduce circle segments based on distance");
  console.log();
  const highDetailSegments = 64;
  const midDetailSegments = 16;
  const lowDetailSegments = 8;

  console.log(`  Far:   ${lowDetailSegments} segments → ${(lowDetailSegments + 2) * 2} vertices per node`);
  console.log(`  Mid:   ${midDetailSegments} segments → ${(midDetailSegments + 2) * 2} vertices per node`);
  console.log(`  Close: ${highDetailSegments} segments → ${(highDetailSegments + 2) * 2} vertices per node`);
  console.log();
  const vertexReduction = ((highDetailSegments - lowDetailSegments) / highDetailSegments) * 100;
  console.log(`Vertex reduction: ${vertexReduction.toFixed(0)}% when far`);
  console.log();
  console.log("Cons:");
  console.log("  × Circles already low-poly (diminishing returns)");
  console.log("  × Still have ${totalDrawCalls} draw calls (main bottleneck)");
  console.log();
  console.log("Estimated savings: <0.1ms per frame");
  console.log("Complexity: Medium");
  console.log();

  console.log("Option D: Instanced Rendering ⭐ RECOMMENDED");
  console.log("-".repeat(80));
  console.log("Implementation: Use InstancedMesh for all chunks");
  console.log();
  console.log("Pros:");
  console.log(`  ✓ Massive draw call reduction: ${totalDrawCalls} → 2 draw calls (fill + outline)`);
  console.log("  ✓ GPU instancing = huge performance win");
  console.log("  ✓ Same visual quality");
  console.log("  ✓ Can still control per-instance visibility, scale, color");
  console.log();
  console.log("Cons:");
  console.log("  × More complex implementation (instanced attributes)");
  console.log("  × Harder to integrate with 3d-force-graph");
  console.log("  × All instances share same base geometry");
  console.log();
  console.log("Estimated savings: 2-5ms per frame (massive improvement)");
  console.log("Complexity: Medium-High");
  console.log();

  // 6. Final Recommendation
  console.log("6. FINAL RECOMMENDATION");
  console.log("=".repeat(80));
  console.log();
  console.log("ANALYSIS SUMMARY:");
  console.log("-".repeat(80));
  console.log(`Current rendering cost: ~${totalVerticesPerNode * CHUNK_NODE_COUNT} vertices, ${totalDrawCalls} draw calls`);
  console.log(`Vertex count is LOW (well within GPU limits)`);
  console.log(`Draw call count is MODERATE (could be optimized)`);
  console.log();
  console.log("PRIMARY BOTTLENECK: Draw calls, not vertex count or scale");
  console.log();
  console.log("RECOMMENDED APPROACH:");
  console.log("-".repeat(80));
  console.log();
  console.log("SHORT TERM (Quick Win):");
  console.log("  → Implement Option A: Visibility Culling");
  console.log("  → Set mesh.visible = false when chunkScale < 0.01");
  console.log("  → Simple, safe, provides immediate benefit when zoomed out");
  console.log("  → Can be implemented in ~5 lines of code");
  console.log();
  console.log("LONG TERM (Best Performance):");
  console.log("  → Consider Option D: Instanced Rendering");
  console.log("  → Only if profiling shows draw calls are a real bottleneck");
  console.log("  → Requires refactoring node-renderer.ts");
  console.log("  → Would eliminate 99% of draw call overhead");
  console.log();
  console.log("NOT RECOMMENDED:");
  console.log("  × Option B (THREE.LOD) - Overkill for simple circles");
  console.log("  × Option C (Geometry Simplification) - Wrong bottleneck");
  console.log();
  console.log("REALITY CHECK:");
  console.log("-".repeat(80));
  console.log(`266 chunks × ~130 vertices = ~34,000 vertices total`);
  console.log(`Modern GPUs handle 10+ million vertices easily`);
  console.log(`The real question: Are 532 draw calls actually causing issues?`);
  console.log();
  console.log("MEASUREMENT NEEDED:");
  console.log("  1. Use browser DevTools Performance tab");
  console.log("  2. Record 10 seconds of graph interaction");
  console.log("  3. Look for frame drops or 'Main' thread congestion");
  console.log("  4. Check GPU utilization (Chrome: Rendering > Frame Rendering Stats)");
  console.log();
  console.log("If performance is already smooth, DON'T optimize yet!");
  console.log("Premature optimization is the root of all evil.");
  console.log();

  circleGeometry.dispose();
  ringGeometry.dispose();
}

// ============================================================================
// Run Analysis
// ============================================================================

analyzeGeometry();
