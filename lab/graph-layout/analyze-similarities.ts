/**
 * Analyze raw similarity values by edge type (before power transform).
 */

import type { MapData, MapEdge } from "@/app/api/map/route";

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
  console.log("Raw Similarity Analysis\n");

  const res = await fetch("http://localhost:3000/api/map?level=7&neighbors=true&maxEdges=6");
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  const data: MapData = await res.json();

  console.log(`Dataset: ${data.nodes.length} nodes, ${data.edges.length} edges`);

  const artKwSim: number[] = [];
  const kwKwSim: number[] = [];

  for (const edge of data.edges) {
    const srcIsKw = edge.source.startsWith("kw:");
    const tgtIsKw = edge.target.startsWith("kw:");

    if (edge.similarity === undefined) continue;

    if (srcIsKw && tgtIsKw) {
      kwKwSim.push(edge.similarity);
    } else {
      artKwSim.push(edge.similarity);
    }
  }

  const artKwStats = computeStats(artKwSim);
  const kwKwStats = computeStats(kwKwSim);

  console.log(`\n=== Article-Keyword Similarities (${artKwStats.count} edges) ===`);
  console.log(`  Range: ${artKwStats.min.toFixed(4)} to ${artKwStats.max.toFixed(4)}`);
  console.log(`  Mean: ${artKwStats.mean.toFixed(4)}, Median: ${artKwStats.median.toFixed(4)}`);
  console.log(`  IQR: [${artKwStats.p25.toFixed(4)}, ${artKwStats.p75.toFixed(4)}]`);

  console.log(`\n=== Keyword-Keyword Similarities (${kwKwStats.count} edges) ===`);
  console.log(`  Range: ${kwKwStats.min.toFixed(4)} to ${kwKwStats.max.toFixed(4)}`);
  console.log(`  Mean: ${kwKwStats.mean.toFixed(4)}, Median: ${kwKwStats.median.toFixed(4)}`);
  console.log(`  IQR: [${kwKwStats.p25.toFixed(4)}, ${kwKwStats.p75.toFixed(4)}]`);

  console.log(`\n=== Comparison ===`);
  const meanDiff = kwKwStats.mean - artKwStats.mean;
  console.log(`Mean difference (kw-kw - art-kw): ${meanDiff.toFixed(4)}`);
  console.log(`Kw-Kw mean is ${(kwKwStats.mean / artKwStats.mean).toFixed(2)}x Art-Kw mean`);

  if (artKwStats.mean < kwKwStats.p25) {
    console.log(`\n[!] Article-Keyword similarities are systematically LOWER`);
    console.log(`    Art-Kw mean (${artKwStats.mean.toFixed(4)}) < Kw-Kw p25 (${kwKwStats.p25.toFixed(4)})`);
    console.log(`\n    Solution: Scale article-keyword similarities or use different comparison.`);
  }

  // Show what distance values this translates to (after power transform)
  console.log(`\n=== After Power Transform (sqrt(1 - sim)) ===`);
  console.log(`Art-Kw: ${Math.sqrt(1 - artKwStats.mean).toFixed(4)} mean distance`);
  console.log(`Kw-Kw:  ${Math.sqrt(1 - kwKwStats.mean).toFixed(4)} mean distance`);
  console.log(`Difference: ${(Math.sqrt(1 - artKwStats.mean) - Math.sqrt(1 - kwKwStats.mean)).toFixed(4)}`);
}

main().catch(console.error);
