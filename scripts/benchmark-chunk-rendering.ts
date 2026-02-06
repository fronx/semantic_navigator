/**
 * Baseline performance benchmark for chunk rendering
 *
 * Measures:
 * - Scale calculation time
 * - Node scale update time (simulated)
 * - Total update cycle time
 *
 * Run with: npm run script scripts/benchmark-chunk-rendering.ts
 */

import { calculateScales } from '@/lib/content-scale';
import { CONTENT_Z_TRANSITION_MIN, CONTENT_Z_TRANSITION_MAX } from '@/lib/content-zoom-config';

// ============================================================================
// Synthetic Data Generators
// ============================================================================

interface SyntheticNode {
  id: string;
  type: 'keyword' | 'chunk';
  scale: number;
}

function generateSyntheticNodes(keywordCount: number, chunksPerKeyword: number): SyntheticNode[] {
  const nodes: SyntheticNode[] = [];

  // Generate keywords
  for (let i = 0; i < keywordCount; i++) {
    nodes.push({
      id: `kw:keyword-${i}`,
      type: 'keyword',
      scale: 1.0,
    });
  }

  // Generate chunks
  for (let i = 0; i < keywordCount; i++) {
    for (let j = 0; j < chunksPerKeyword; j++) {
      nodes.push({
        id: `chunk-${i}-${j}`,
        type: 'chunk',
        scale: 0.0,
      });
    }
  }

  return nodes;
}

// ============================================================================
// Performance Benchmarks
// ============================================================================

function benchmarkScaleCalculation(iterations: number): { avgTime: number; opsPerSec: number } {
  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    const z = CONTENT_Z_TRANSITION_MIN + Math.random() * (CONTENT_Z_TRANSITION_MAX - CONTENT_Z_TRANSITION_MIN);
    calculateScales(z);
  }

  const end = performance.now();
  const totalTime = end - start;
  const avgTime = totalTime / iterations;
  const opsPerSec = (iterations / totalTime) * 1000;

  return { avgTime, opsPerSec };
}

function benchmarkNodeScaleUpdate(nodes: SyntheticNode[], iterations: number): { avgTime: number; opsPerSec: number } {
  // Simulate updating node scales (what happens in updateNodeScales)
  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    const scales = calculateScales(5000); // arbitrary camera Z

    // Simulate iterating through all nodes and updating scale
    for (const node of nodes) {
      if (node.type === 'keyword') {
        node.scale = scales.keywordScale;
      } else if (node.type === 'chunk') {
        node.scale = scales.chunkScale;
      }
    }
  }

  const end = performance.now();
  const totalTime = end - start;
  const avgTime = totalTime / iterations;
  const opsPerSec = (iterations / totalTime) * 1000;

  return { avgTime, opsPerSec };
}

function benchmarkFullUpdateCycle(nodes: SyntheticNode[], iterations: number): { avgTime: number; opsPerSec: number } {
  // Simulate a full update cycle with camera movement detection
  let lastCameraZ = -1;
  const CAMERA_Z_THRESHOLD = 1;
  const start = performance.now();

  let updateCount = 0;
  for (let i = 0; i < iterations; i++) {
    // Simulate camera movement (move by 5 units each time to trigger updates)
    const cameraZ = 1000 + (i * 5);
    const cameraMoved = Math.abs(cameraZ - lastCameraZ) > CAMERA_Z_THRESHOLD;

    if (cameraMoved) {
      lastCameraZ = cameraZ;
      const scales = calculateScales(cameraZ);

      // Update all nodes
      for (const node of nodes) {
        if (node.type === 'keyword') {
          node.scale = scales.keywordScale;
        } else if (node.type === 'chunk') {
          node.scale = scales.chunkScale;
        }
      }

      updateCount++;
    }
  }

  const end = performance.now();
  const totalTime = end - start;
  const avgTime = totalTime / iterations;
  const opsPerSec = (iterations / totalTime) * 1000;

  return { avgTime, opsPerSec, updateCount };
}

// ============================================================================
// Main Benchmark Runner
// ============================================================================

async function main() {
  console.log('=== Chunk Rendering Performance Baseline ===\n');

  // Test configurations
  const configs = [
    { keywords: 50, chunksPerKeyword: 5, label: 'Small (50 keywords, 250 chunks)' },
    { keywords: 100, chunksPerKeyword: 5, label: 'Medium (100 keywords, 500 chunks)' },
    { keywords: 200, chunksPerKeyword: 5, label: 'Large (200 keywords, 1000 chunks)' },
  ];

  console.log('--- Scale Calculation Performance ---');
  const scaleCalcResults = benchmarkScaleCalculation(10000);
  console.log(`Average time: ${scaleCalcResults.avgTime.toFixed(4)} ms`);
  console.log(`Operations/sec: ${scaleCalcResults.opsPerSec.toFixed(0)}`);
  console.log('');

  for (const config of configs) {
    console.log(`--- ${config.label} ---`);
    const nodes = generateSyntheticNodes(config.keywords, config.chunksPerKeyword);
    console.log(`Total nodes: ${nodes.length}`);

    // Benchmark node scale updates
    const nodeUpdateResults = benchmarkNodeScaleUpdate(nodes, 1000);
    console.log(`  Node scale update avg time: ${nodeUpdateResults.avgTime.toFixed(4)} ms`);
    console.log(`  Updates/sec: ${nodeUpdateResults.opsPerSec.toFixed(0)}`);

    // Benchmark full update cycle with camera movement
    const fullCycleResults = benchmarkFullUpdateCycle(nodes, 1000);
    console.log(`  Full cycle avg time: ${fullCycleResults.avgTime.toFixed(4)} ms`);
    console.log(`  Cycles/sec: ${fullCycleResults.opsPerSec.toFixed(0)}`);
    console.log(`  Actual updates: ${fullCycleResults.updateCount} / 1000 (camera movement detection working)`);
    console.log('');
  }

  // Performance targets
  console.log('--- Performance Targets ---');
  console.log('Target: 60 FPS = 16.67ms per frame');
  console.log('Budget for chunk updates: ~2-3ms per frame (leaving room for other rendering)');
  console.log('');

  // Recommendations
  const mediumConfig = configs[1];
  const mediumNodes = generateSyntheticNodes(mediumConfig.keywords, mediumConfig.chunksPerKeyword);
  const mediumResults = benchmarkNodeScaleUpdate(mediumNodes, 1000);

  console.log('--- Analysis ---');
  if (mediumResults.avgTime < 3) {
    console.log('✅ Performance is good - updates fit within frame budget');
  } else if (mediumResults.avgTime < 5) {
    console.log('⚠️  Performance is marginal - may cause frame drops');
  } else {
    console.log('❌ Performance is poor - will cause significant frame drops');
  }

  console.log('\n=== Benchmark Complete ===');
}

main().catch(console.error);
