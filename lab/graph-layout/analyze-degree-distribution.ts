/**
 * Analyze degree distribution by node type in the semantic navigator map.
 *
 * Tests the hypothesis that keywords have much higher degree than articles,
 * which might explain why UMAP pulls keywords to the center.
 */

interface MapNode {
  id: string;
  type: "keyword" | "article" | "chunk";
  label: string;
}

interface MapEdge {
  source: string;
  target: string;
  similarity?: number;
}

interface MapData {
  nodes: MapNode[];
  edges: MapEdge[];
}

function computeStats(values: number[]) {
  if (values.length === 0) return { min: 0, max: 0, mean: 0, median: 0, stdDev: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / values.length;
  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean,
    median: sorted[Math.floor(sorted.length / 2)],
    stdDev: Math.sqrt(variance),
  };
}

function printHistogram(values: number[], label: string, bucketSize: number = 5) {
  if (values.length === 0) {
    console.log(`  No data for ${label}`);
    return;
  }

  const max = Math.max(...values);
  const buckets = new Map<number, number>();

  for (let i = 0; i <= max; i += bucketSize) {
    buckets.set(i, 0);
  }

  for (const v of values) {
    const bucket = Math.floor(v / bucketSize) * bucketSize;
    buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
  }

  console.log(`\n${label} degree distribution:`);
  console.log("  Degree Range | Count | Histogram");
  console.log("  " + "-".repeat(50));

  const maxCount = Math.max(...buckets.values());
  const sortedBuckets = [...buckets.entries()].sort((a, b) => a[0] - b[0]);

  for (const [bucket, count] of sortedBuckets) {
    if (count === 0) continue;
    const rangeLabel = `${bucket}-${bucket + bucketSize - 1}`.padStart(10);
    const countStr = count.toString().padStart(5);
    const barLength = Math.round((count / maxCount) * 30);
    const bar = "#".repeat(barLength);
    console.log(`  ${rangeLabel} | ${countStr} | ${bar}`);
  }
}

async function main() {
  console.log("Fetching map data...\n");
  const res = await fetch("http://localhost:3000/api/map?level=7&neighbors=true&maxEdges=6");
  if (!res.ok) {
    console.error("Failed to fetch:", res.status);
    process.exit(1);
  }
  const data: MapData = await res.json();

  console.log(`=== Graph Overview ===`);
  console.log(`Total nodes: ${data.nodes.length}`);
  console.log(`Total edges: ${data.edges.length}`);

  const articles = data.nodes.filter((n) => n.type === "article");
  const keywords = data.nodes.filter((n) => n.type === "keyword");
  console.log(`  Articles: ${articles.length}`);
  console.log(`  Keywords: ${keywords.length}`);

  // Compute degrees
  const degree = new Map<string, number>();
  for (const n of data.nodes) degree.set(n.id, 0);
  for (const e of data.edges) {
    degree.set(e.source, (degree.get(e.source) || 0) + 1);
    degree.set(e.target, (degree.get(e.target) || 0) + 1);
  }

  const artDegrees = articles.map((n) => degree.get(n.id) || 0);
  const kwDegrees = keywords.map((n) => degree.get(n.id) || 0);

  const artStats = computeStats(artDegrees);
  const kwStats = computeStats(kwDegrees);

  console.log(`\n=== Degree Statistics ===`);
  console.log(`\nArticles:`);
  console.log(`  Min:    ${artStats.min}`);
  console.log(`  Max:    ${artStats.max}`);
  console.log(`  Mean:   ${artStats.mean.toFixed(2)}`);
  console.log(`  Median: ${artStats.median}`);
  console.log(`  StdDev: ${artStats.stdDev.toFixed(2)}`);
  console.log(`\nKeywords:`);
  console.log(`  Min:    ${kwStats.min}`);
  console.log(`  Max:    ${kwStats.max}`);
  console.log(`  Mean:   ${kwStats.mean.toFixed(2)}`);
  console.log(`  Median: ${kwStats.median}`);
  console.log(`  StdDev: ${kwStats.stdDev.toFixed(2)}`);
  console.log(`\n=== Comparison ===`);
  console.log(`Mean degree ratio (keyword/article): ${(kwStats.mean / artStats.mean).toFixed(2)}x`);
  console.log(`Median degree ratio (keyword/article): ${(kwStats.median / artStats.median).toFixed(2)}x`);

  // Print histograms
  printHistogram(artDegrees, "Article", 2);
  printHistogram(kwDegrees, "Keyword", 5);

  // Edge type breakdown
  let artKw = 0, kwKw = 0, artArt = 0;
  for (const e of data.edges) {
    const srcKw = e.source.startsWith("kw:");
    const tgtKw = e.target.startsWith("kw:");
    if (srcKw && tgtKw) kwKw++;
    else if (!srcKw && !tgtKw) artArt++;
    else artKw++;
  }
  console.log(`\n=== Edge Types ===`);
  console.log(`  Article-Keyword: ${artKw}`);
  console.log(`  Keyword-Keyword: ${kwKw}`);
  console.log(`  Article-Article: ${artArt}`);

  // Top degree nodes
  const topNodes = [...degree.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log(`\n=== Top 10 Highest Degree ===`);
  for (const [id, deg] of topNodes) {
    const node = data.nodes.find((n) => n.id === id);
    console.log(`  [${node?.type}] "${node?.label}" - degree ${deg}`);
  }
}

main().catch(console.error);
