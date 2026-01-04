/**
 * Test if different configurations affect the article/keyword centrality ratio.
 */

import type { MapData } from "@/app/api/map/route";
import { buildKnnFromEdges, type LayoutPosition } from "@/lib/map-layout";
import { umapLayout } from "umapper";

function computeCentralityRatio(
  positions: LayoutPosition[],
  nodes: MapData["nodes"]
): { meanRatio: number; medianRatio: number } {
  const posById = new Map(positions.map(p => [p.id, p]));

  // Compute centroid
  const xs = positions.map(p => p.x);
  const ys = positions.map(p => p.y);
  const centroid = {
    x: xs.reduce((a, b) => a + b, 0) / xs.length,
    y: ys.reduce((a, b) => a + b, 0) / ys.length,
  };

  const articles = nodes.filter(n => n.type === "article");
  const keywords = nodes.filter(n => n.type === "keyword");

  const artDist = articles
    .map(n => posById.get(n.id))
    .filter((p): p is LayoutPosition => !!p)
    .map(p => Math.sqrt((p.x - centroid.x) ** 2 + (p.y - centroid.y) ** 2))
    .sort((a, b) => a - b);

  const kwDist = keywords
    .map(n => posById.get(n.id))
    .filter((p): p is LayoutPosition => !!p)
    .map(p => Math.sqrt((p.x - centroid.x) ** 2 + (p.y - centroid.y) ** 2))
    .sort((a, b) => a - b);

  const artMean = artDist.reduce((a, b) => a + b, 0) / artDist.length;
  const kwMean = kwDist.reduce((a, b) => a + b, 0) / kwDist.length;
  const artMedian = artDist[Math.floor(artDist.length / 2)];
  const kwMedian = kwDist[Math.floor(kwDist.length / 2)];

  return {
    meanRatio: artMean / kwMean,
    medianRatio: artMedian / kwMedian,
  };
}

interface TestConfig {
  label: string;
  repulsionStrength?: number;
  attractionStrength?: number;
  minAttractiveScale?: number;
}

async function main() {
  console.log("Centrality Ratio Test\n");
  console.log("Goal: Find config where Mean Ratio ≈ 1.0 (articles and keywords equally distributed)\n");

  const res = await fetch("http://localhost:3000/api/map?level=7&neighbors=true&maxEdges=6");
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  const data: MapData = await res.json();

  console.log(`Dataset: ${data.nodes.length} nodes, ${data.edges.length} edges`);
  console.log(`  Articles: ${data.nodes.filter(n => n.type === "article").length}`);
  console.log(`  Keywords: ${data.nodes.filter(n => n.type === "keyword").length}\n`);

  const knn = buildKnnFromEdges(
    data.nodes.map(n => ({ ...n, type: "keyword" as const, label: n.id })),
    data.edges
  );

  const configs: TestConfig[] = [
    { label: "Default" },
    { label: "rep=10", repulsionStrength: 10 },
    { label: "rep=1", repulsionStrength: 1 },
    { label: "attr=200", attractionStrength: 200 },
    { label: "attr=1000", attractionStrength: 1000 },
    { label: "scale=1", minAttractiveScale: 1 },
    { label: "scale=0", minAttractiveScale: 0 },
    { label: "rep=10 + scale=1", repulsionStrength: 10, minAttractiveScale: 1 },
    { label: "rep=1 + attr=200", repulsionStrength: 1, attractionStrength: 200 },
    { label: "rep=1 + attr=1000 + scale=0", repulsionStrength: 1, attractionStrength: 1000, minAttractiveScale: 0 },
  ];

  console.log("Config                              | Mean Ratio | Median Ratio | Status");
  console.log("-".repeat(75));

  for (const config of configs) {
    const positions = await umapLayout(knn, {
      minDist: 20.0,
      spread: 200,
      epochs: 500,
      repulsionStrength: config.repulsionStrength,
      attractionStrength: config.attractionStrength,
      minAttractiveScale: config.minAttractiveScale,
    });

    const { meanRatio, medianRatio } = computeCentralityRatio(positions, data.nodes);

    const status = meanRatio > 1.15 ? "Articles at periphery" :
                   meanRatio < 0.85 ? "Keywords at periphery" : "BALANCED";

    console.log(
      `${config.label.padEnd(35)} | ${meanRatio.toFixed(2).padStart(10)} | ${medianRatio.toFixed(2).padStart(12)} | ${status}`
    );
  }

  console.log("\n\nInterpretation:");
  console.log("  Mean Ratio > 1.15: Articles are further from center (BAD)");
  console.log("  Mean Ratio < 0.85: Keywords are further from center (unusual)");
  console.log("  Mean Ratio ≈ 1.0:  Balanced distribution (GOOD)");
}

main().catch(console.error);
