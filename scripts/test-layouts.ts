/**
 * Test script to analyze and compare layout algorithm outputs.
 *
 * This script runs both force-directed and UMAP layouts headlessly
 * and outputs position statistics to help tune parameters for
 * comparable visual density between the two modes.
 *
 * ## Usage
 *
 *   npm run script scripts/test-layouts.ts
 *
 * ## Key Metrics
 *
 * - **Canvas overflow**: How much the layout extends beyond a 1000x1000 canvas.
 *   Force layout typically overflows (needs zoom out), while UMAP is scaled to fit.
 *
 * - **Zoom required**: The zoom level needed to fit the layout on screen.
 *   Values < 1 mean zoom out, > 1 means zoom in.
 *
 * - **Clustering metric**: Ratio of p25/p75 distances from centroid.
 *   Lower values indicate tighter clustering.
 *
 * ## Tuning Parameters
 *
 * Edit these in src/lib/map-layout.ts:
 *
 * - `buildKnnFromEdges`: Power transform exponent (currently 0.5)
 *   Higher = more spread in distance values
 *
 * - `computeUmapLayout`: minDist (20.0), spread (200.0), epochs (500)
 *   Higher minDist/spread = more visual separation
 *
 * - `scalePositions`: padding (100px)
 *   Affects how UMAP fills the canvas
 *
 * ## Goal
 *
 * Both layouts should require similar zoom levels for comfortable viewing.
 * If Force needs 0.4x zoom (zoom out) and UMAP needs 1.0x (no zoom),
 * users will experience jarring differences when switching modes.
 */

import type { MapData } from "@/app/api/map/route";
import {
  computeForceLayout,
  computeUmapLayoutRaw,
  computePositionStats,
  centerPositions,
  buildKnnFromEdges,
} from "@/lib/map-layout";

const CANVAS_SIZE = 1000; // Simulated canvas dimensions

async function fetchMapData(): Promise<MapData> {
  const res = await fetch("http://localhost:3000/api/map?level=3&clustered=true");
  if (!res.ok) {
    throw new Error(`Failed to fetch map data: ${res.status}`);
  }
  return res.json();
}

function formatStats(stats: ReturnType<typeof computePositionStats>, label: string) {
  const maxSpread = Math.max(stats.xRange.spread, stats.yRange.spread);
  const zoomToFit = CANVAS_SIZE / maxSpread;
  const overflowRatio = maxSpread / CANVAS_SIZE;

  return `
  ${label}
  ${"=".repeat(label.length)}
  Nodes: ${stats.count}

  Position ranges:
    X: ${stats.xRange.min.toFixed(0)} to ${stats.xRange.max.toFixed(0)} (spread: ${stats.xRange.spread.toFixed(0)})
    Y: ${stats.yRange.min.toFixed(0)} to ${stats.yRange.max.toFixed(0)} (spread: ${stats.yRange.spread.toFixed(0)})

  Canvas fit (${CANVAS_SIZE}x${CANVAS_SIZE}):
    Max spread: ${maxSpread.toFixed(0)}px
    Overflow ratio: ${overflowRatio.toFixed(2)}x ${overflowRatio > 1 ? "(extends beyond canvas)" : "(fits within canvas)"}
    Zoom to fit: ${zoomToFit.toFixed(2)}x ${zoomToFit < 1 ? "(zoom OUT needed)" : "(zoom IN possible)"}

  Distribution from centroid:
    Centroid: (${stats.centroid.x.toFixed(0)}, ${stats.centroid.y.toFixed(0)})
    Avg distance: ${stats.avgDistFromCentroid.toFixed(0)}
    Percentiles: p5=${stats.percentiles.p5.toFixed(0)}, p25=${stats.percentiles.p25.toFixed(0)}, p50=${stats.percentiles.p50.toFixed(0)}, p75=${stats.percentiles.p75.toFixed(0)}, p95=${stats.percentiles.p95.toFixed(0)}
    Clustering (p25/p75): ${(stats.percentiles.p25 / stats.percentiles.p75).toFixed(3)}
`;
}

async function main() {
  console.log("Layout Comparison Test");
  console.log("======================\n");

  console.log("Fetching map data...");
  const data = await fetchMapData();
  console.log(`Dataset: ${data.nodes.length} nodes, ${data.edges.length} edges\n`);

  // Analyze input data
  const similarities = data.edges
    .map((e) => e.similarity)
    .filter((s): s is number => s !== undefined)
    .sort((a, b) => b - a);

  if (similarities.length > 0) {
    console.log("Edge similarity distribution:");
    console.log(`  Range: ${similarities[similarities.length - 1].toFixed(3)} to ${similarities[0].toFixed(3)}`);
    console.log(`  Median: ${similarities[Math.floor(similarities.length / 2)].toFixed(3)}`);
  }

  const knn = buildKnnFromEdges(data.nodes, data.edges);
  const allDistances: number[] = [];
  for (const id in knn) {
    for (const neighbor of knn[id]) {
      allDistances.push(neighbor.distance);
    }
  }
  allDistances.sort((a, b) => a - b);
  if (allDistances.length > 0) {
    console.log("\nkNN distances (after power transform):");
    console.log(`  Range: ${allDistances[0].toFixed(3)} to ${allDistances[allDistances.length - 1].toFixed(3)}`);
    console.log(`  Median: ${allDistances[Math.floor(allDistances.length / 2)].toFixed(3)}`);
  }

  // Run Force layout
  console.log("\nRunning Force layout...");
  const forcePositions = computeForceLayout(data.nodes, data.edges, {
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
    maxTicks: 300,
  });
  const forceStats = computePositionStats(forcePositions);
  console.log(formatStats(forceStats, "Force Layout (raw positions)"));

  // Run UMAP layout (raw)
  console.log("Running UMAP layout...");
  let lastProgress = 0;
  const umapRawPositions = await computeUmapLayoutRaw(data.nodes, data.edges, {
    onProgress: ({ progress }) => {
      if (progress - lastProgress >= 25) {
        process.stdout.write(`  ${progress}%...`);
        lastProgress = progress;
      }
    },
  });
  console.log(" done");

  const umapRawStats = computePositionStats(umapRawPositions);
  console.log(formatStats(umapRawStats, "UMAP Layout (raw positions)"));

  // Center UMAP on canvas (as MapView now does - no scaling, just centering)
  const umapCenteredPositions = centerPositions(umapRawPositions, CANVAS_SIZE, CANVAS_SIZE);
  const umapCenteredStats = computePositionStats(umapCenteredPositions);
  console.log(formatStats(umapCenteredStats, "UMAP Layout (centered on canvas)"));

  // Summary comparison
  const forceMaxSpread = Math.max(forceStats.xRange.spread, forceStats.yRange.spread);
  const umapCenteredMaxSpread = Math.max(umapCenteredStats.xRange.spread, umapCenteredStats.yRange.spread);
  const forceZoom = CANVAS_SIZE / forceMaxSpread;
  const umapZoom = CANVAS_SIZE / umapCenteredMaxSpread;

  console.log("\n" + "=".repeat(50));
  console.log("SUMMARY");
  console.log("=".repeat(50));
  console.log(`\nZoom levels needed to fit on ${CANVAS_SIZE}x${CANVAS_SIZE} canvas:`);
  console.log(`  Force: ${forceZoom.toFixed(2)}x ${forceZoom < 1 ? "(zoom out)" : "(fits)"}`);
  console.log(`  UMAP:  ${umapZoom.toFixed(2)}x ${umapZoom < 1 ? "(zoom out)" : "(fits)"}`);
  console.log(`  Ratio: ${(forceZoom / umapZoom).toFixed(2)}x`);

  if (Math.abs(forceZoom - umapZoom) > 0.3) {
    console.log("\n[!] Significant zoom difference detected.");
    if (forceZoom < umapZoom) {
      console.log("    Force is more spread out than UMAP.");
      console.log("    Consider: increase UMAP minDist/spread, or reduce scalePositions padding");
    } else {
      console.log("    UMAP is more spread out than Force.");
      console.log("    Consider: decrease UMAP minDist/spread, or increase scalePositions padding");
    }
  } else {
    console.log("\n[OK] Zoom levels are comparable.");
  }

  console.log("\nClustering comparison (p25/p75, lower = tighter clusters):");
  const forceCluster = forceStats.percentiles.p25 / forceStats.percentiles.p75;
  const umapCluster = umapCenteredStats.percentiles.p25 / umapCenteredStats.percentiles.p75;
  console.log(`  Force: ${forceCluster.toFixed(3)}`);
  console.log(`  UMAP:  ${umapCluster.toFixed(3)}`);
}

main().catch(console.error);
