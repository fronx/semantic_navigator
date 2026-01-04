/**
 * Analyze UMAP layout centrality by node type.
 * Tests different attractionStrength values to find the right balance.
 */

import type { MapData } from "@/app/api/map/route";
import { computeUmapLayoutRaw, type LayoutPosition } from "@/lib/map-layout";

function computeStats(values: number[]) {
  if (values.length === 0) return { count: 0, mean: 0, median: 0, p25: 0, p75: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const pct = (p: number) => sorted[Math.floor(sorted.length * p / 100)] ?? 0;
  return {
    count: sorted.length,
    mean: sum / sorted.length,
    median: pct(50),
    p25: pct(25),
    p75: pct(75),
  };
}

interface MapNode {
  id: string;
  type: "keyword" | "article" | "chunk";
}

async function analyzeWithAttractionStrength(
  data: MapData,
  attractionStrength: number
): Promise<{ meanRatio: number; medianRatio: number }> {
  const articles = data.nodes.filter(n => n.type === "article");
  const keywords = data.nodes.filter(n => n.type === "keyword");

  const positions = await computeUmapLayoutRaw(data.nodes, data.edges, {
    attractionStrength,
    epochs: 300, // Faster for comparison
  });

  const posById = new Map(positions.map(p => [p.id, p]));

  const xs = positions.map(p => p.x);
  const ys = positions.map(p => p.y);
  const centroid = {
    x: xs.reduce((a, b) => a + b, 0) / xs.length,
    y: ys.reduce((a, b) => a + b, 0) / ys.length,
  };

  const artDist = articles
    .map(n => posById.get(n.id))
    .filter((p): p is LayoutPosition => !!p)
    .map(p => Math.sqrt((p.x - centroid.x) ** 2 + (p.y - centroid.y) ** 2));

  const kwDist = keywords
    .map(n => posById.get(n.id))
    .filter((p): p is LayoutPosition => !!p)
    .map(p => Math.sqrt((p.x - centroid.x) ** 2 + (p.y - centroid.y) ** 2));

  const artStats = computeStats(artDist);
  const kwStats = computeStats(kwDist);

  return {
    meanRatio: artStats.mean / kwStats.mean,
    medianRatio: artStats.median / kwStats.median,
  };
}

async function main() {
  console.log("UMAP Centrality Analysis - Attraction Strength Sweep\n");

  const res = await fetch("http://localhost:3000/api/map?level=7&neighbors=true&maxEdges=6");
  if (!res.ok) throw new Error(`Failed: ${res.status}`);
  const data: MapData = await res.json();

  const articles = data.nodes.filter(n => n.type === "article");
  const keywords = data.nodes.filter(n => n.type === "keyword");
  console.log(`Dataset: ${data.nodes.length} nodes, ${data.edges.length} edges`);
  console.log(`  Articles: ${articles.length}, Keywords: ${keywords.length}\n`);

  // Test different attraction strength values
  const strengthValues = [1.0, 2.0, 3.0, 4.0, 5.0];

  console.log("Testing attractionStrength values...\n");
  console.log("Strength | Mean Ratio | Median Ratio | Status");
  console.log("-".repeat(55));

  for (const strength of strengthValues) {
    process.stdout.write(`${strength.toFixed(1).padStart(8)} |`);
    const result = await analyzeWithAttractionStrength(data, strength);

    const status = result.meanRatio > 1.2 ? "Periphery effect" :
                   result.meanRatio < 0.8 ? "Unexpected" : "OK";

    console.log(
      ` ${result.meanRatio.toFixed(2).padStart(10)} | ${result.medianRatio.toFixed(2).padStart(12)} | ${status}`
    );
  }

  console.log("\nGoal: Find attractionStrength where Mean Ratio is close to 1.0");
}

main().catch(console.error);
