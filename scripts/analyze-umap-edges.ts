/**
 * Analyze UMAP edge connections using Claude Haiku in batch mode.
 *
 * Processes high-weight edges to understand what makes connected nodes
 * semantically similar. Uses 5 edges per API call for efficiency.
 *
 * Usage:
 *   npm run script scripts/analyze-umap-edges.ts <graph-file> [edgeCount] [batchSize]
 *
 * Examples:
 *   npm run script scripts/analyze-umap-edges.ts data/umap-graph-1771091480022.json
 *   npm run script scripts/analyze-umap-edges.ts data/umap-graph-1771091480022.json 50 3
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs/promises";

// ============================================================================
// Configuration
// ============================================================================

const EDGES_TO_ANALYZE = 100;
const BATCH_SIZE = 5; // Edges per API call
const RESULTS_PATH = "./data/umap-edge-analysis.jsonl";

// ============================================================================
// Types
// ============================================================================

interface UmapGraphNode {
  id: string;
  content: string;
  summary: string | null;
  sourcePath: string;
  headingContext: string[] | null;
  chunkType: string | null;
  position: [number, number];
}

interface UmapEdge {
  source: number;
  target: number;
  weight: number;
  restLength: number | null;
}

interface UmapGraphData {
  nodes: UmapGraphNode[];
  edges: UmapEdge[];
  metadata: {
    nodeCount: number;
    edgeCount: number;
    exportDate: string;
  };
}

interface EdgeAnalysis {
  sourceId: string;
  targetId: string;
  weight: number;
  similarity: string;
  themes: string[];
  connection_type: string;
}

// ============================================================================
// Graph Loading
// ============================================================================

async function loadGraph(filepath: string): Promise<UmapGraphData> {
  const raw = await fs.readFile(filepath, "utf-8");
  return JSON.parse(raw);
}

// ============================================================================
// Edge Analysis
// ============================================================================

async function analyzeEdgeBatch(
  edges: Array<{ edge: UmapEdge; source: UmapGraphNode; target: UmapGraphNode }>,
  anthropic: Anthropic
): Promise<EdgeAnalysis[]> {
  const prompt = `Analyze these ${edges.length} pairs of connected text chunks to understand what makes them semantically similar.

${edges.map((e, i) => `
PAIR ${i + 1} (weight: ${e.edge.weight.toFixed(3)}):

SOURCE:
${e.source.content.substring(0, 500)}${e.source.content.length > 500 ? "..." : ""}

TARGET:
${e.target.content.substring(0, 500)}${e.target.content.length > 500 ? "..." : ""}
`).join("\n---\n")}

For each pair, identify:
1. The core semantic similarity (what connects them)
2. 2-3 key themes they share
3. Connection type (e.g., "elaboration", "contrast", "example", "cause-effect", "shared concept", "related perspective")

Return ONLY a JSON array (no other text) with this exact format:
[
  {
    "pair": 1,
    "similarity": "brief description of what connects them",
    "themes": ["theme1", "theme2"],
    "connection_type": "type"
  },
  ...
]`;

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";

  // Extract JSON (handle markdown code blocks)
  let jsonText = text;
  const jsonMatch = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (jsonMatch) {
    jsonText = jsonMatch[1];
  }

  const parsed = JSON.parse(jsonText);

  // Map back to edge IDs
  return parsed.map((result: any, i: number) => ({
    sourceId: edges[i].source.id,
    targetId: edges[i].target.id,
    weight: edges[i].edge.weight,
    similarity: result.similarity,
    themes: result.themes,
    connection_type: result.connection_type,
  }));
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: npm run script scripts/analyze-umap-edges.ts <graph-file> [edgeCount] [batchSize]");
    process.exit(1);
  }

  const graphFile = args[0];
  const edgeCount = args[1] ? parseInt(args[1]) : EDGES_TO_ANALYZE;
  const batchSize = args[2] ? parseInt(args[2]) : BATCH_SIZE;

  console.log(`Loading graph from ${graphFile}...`);
  const graph = await loadGraph(graphFile);
  console.log(`Loaded ${graph.nodes.length} nodes, ${graph.edges.length} edges`);

  // Select top edges by weight
  const sortedEdges = [...graph.edges].sort((a, b) => b.weight - a.weight);
  const topEdges = sortedEdges.slice(0, edgeCount);
  console.log(`Analyzing top ${topEdges.length} edges by weight`);
  console.log(`Weight range: ${topEdges[0].weight.toFixed(3)} - ${topEdges[topEdges.length - 1].weight.toFixed(3)}`);

  // Initialize Anthropic client
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Process in batches
  const allResults: EdgeAnalysis[] = [];
  const totalBatches = Math.ceil(topEdges.length / batchSize);

  for (let i = 0; i < topEdges.length; i += batchSize) {
    const batchNum = Math.floor(i / batchSize) + 1;
    const batch = topEdges.slice(i, i + batchSize);

    // Build batch with full node data
    const edgesWithNodes = batch.map((edge) => ({
      edge,
      source: graph.nodes[edge.source],
      target: graph.nodes[edge.target],
    }));

    console.log(`Processing batch ${batchNum}/${totalBatches} (${batch.length} edges)...`);

    try {
      const results = await analyzeEdgeBatch(edgesWithNodes, anthropic);
      allResults.push(...results);

      // Append to JSONL after each batch
      const lines = results.map((r) => JSON.stringify(r)).join("\n") + "\n";
      await fs.appendFile(RESULTS_PATH, lines);

      console.log(`  ✓ Analyzed ${results.length} edges`);
    } catch (error) {
      console.error(`  ✗ Error in batch ${batchNum}:`, error);
      // Continue with next batch
    }

    // Brief delay between API calls
    if (i + batchSize < topEdges.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  console.log(`\nComplete! Analyzed ${allResults.length} edges`);
  console.log(`Results saved to ${RESULTS_PATH}`);

  // Print summary
  const connectionTypes = new Map<string, number>();
  for (const result of allResults) {
    connectionTypes.set(result.connection_type, (connectionTypes.get(result.connection_type) || 0) + 1);
  }

  console.log("\nConnection type distribution:");
  const sorted = [...connectionTypes.entries()].sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sorted) {
    console.log(`  ${type}: ${count}`);
  }
}

main().catch(console.error);
