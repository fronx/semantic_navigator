/**
 * Analyze edge distance distribution by type.
 */

import type { MapData } from "@/app/api/map/route";
import { buildKnnFromEdges } from "@/lib/map-layout";

function computeStats(values: number[]) {
  if (values.length === 0) return { count: 0, min: 0, max: 0, mean: 0, median: 0, p25: 0, p75: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const pct = (p: number) => sorted[Math.floor(sorted.length * p / 100)] ?? 0;
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
    median: pct(50),
    p25: pct(25),
    p75: pct(75),
  };
}

async function main() {
  console.log("Edge Distance Analysis\n");

  const res = await fetch("http://localhost:3000/api/map?level=7&neighbors=true&maxEdges=6");
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  const data: MapData = await res.json();

  console.log(`Dataset: ${data.nodes.length} nodes, ${data.edges.length} edges`);

  const knn = buildKnnFromEdges(data.nodes, data.edges);

  const artKwDist: number[] = [];
  const kwKwDist: number[] = [];
  const seen = new Set<string>();

  for (const srcId in knn) {
    const srcIsKw = srcId.startsWith("kw:");
    for (const neighbor of knn[srcId]) {
      const key = [srcId, neighbor.id].sort().join("-");
      if (seen.has(key)) continue;
      seen.add(key);

      const tgtIsKw = neighbor.id.startsWith("kw:");
      if (srcIsKw && tgtIsKw) kwKwDist.push(neighbor.distance);
      else artKwDist.push(neighbor.distance);
    }
  }

  const artKwStats = computeStats(artKwDist);
  const kwKwStats = computeStats(kwKwDist);

  console.log(`\n=== Article-Keyword Distances (${artKwStats.count} edges) ===`);
  console.log(`  Range: ${artKwStats.min.toFixed(4)} to ${artKwStats.max.toFixed(4)}`);
  console.log(`  Mean: ${artKwStats.mean.toFixed(4)}, Median: ${artKwStats.median.toFixed(4)}`);
  console.log(`  IQR: [${artKwStats.p25.toFixed(4)}, ${artKwStats.p75.toFixed(4)}]`);

  console.log(`\n=== Keyword-Keyword Distances (${kwKwStats.count} edges) ===`);
  console.log(`  Range: ${kwKwStats.min.toFixed(4)} to ${kwKwStats.max.toFixed(4)}`);
  console.log(`  Mean: ${kwKwStats.mean.toFixed(4)}, Median: ${kwKwStats.median.toFixed(4)}`);
  console.log(`  IQR: [${kwKwStats.p25.toFixed(4)}, ${kwKwStats.p75.toFixed(4)}]`);

  console.log(`\n=== Analysis ===`);
  const artKwRange = artKwStats.max - artKwStats.min;
  const kwKwRange = kwKwStats.max - kwKwStats.min;
  console.log(`Art-Kw range: ${artKwRange.toFixed(4)}`);
  console.log(`Kw-Kw range:  ${kwKwRange.toFixed(4)}`);

  if (artKwRange < 0.01) {
    console.log(`\n[!] Article-Keyword edges have ZERO variance!`);
    console.log(`    UMAP sees all art-kw connections as identical.`);
  }

  if (artKwStats.mean > kwKwStats.p75) {
    console.log(`\n[!] Art-Kw mean (${artKwStats.mean.toFixed(4)}) > Kw-Kw p75 (${kwKwStats.p75.toFixed(4)})`);
    console.log(`    Article connections are weaker than most keyword connections.`);
  }
}

main().catch(console.error);
