/**
 * Benchmark cluster label generation latency.
 *
 * Measures:
 * - Total round-trip time via /api/cluster-labels endpoint
 * - Direct Anthropic API time (bypasses endpoint)
 * - Network overhead (total - direct API time)
 *
 * Usage: npm run script scripts/benchmark-cluster-labels.ts
 *
 * Requires dev server running at localhost:3000
 */
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import { generateClusterLabels } from "../src/lib/llm";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

interface KeywordNode {
  id: string;
  label: string;
  embedding?: number[];
}

interface SimilarityEdge {
  source: string;
  target: string;
  similarity: number;
}

interface TopicsData {
  nodes: KeywordNode[];
  edges: SimilarityEdge[];
}

interface ClusterPayload {
  id: number;
  keywords: string[];
}

async function fetchTopicsData(): Promise<TopicsData> {
  const response = await fetch(`${BASE_URL}/api/topics`);
  if (!response.ok) {
    throw new Error(`Failed to fetch topics: ${response.status}`);
  }
  return response.json();
}

function computeClusters(
  nodes: KeywordNode[],
  edges: SimilarityEdge[],
  resolution: number
): ClusterPayload[] {
  if (nodes.length === 0) return [];

  const graph = new Graph({ type: "undirected" });

  for (const node of nodes) {
    graph.addNode(node.id);
  }

  for (const edge of edges) {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
    if (edge.source === edge.target) continue;
    if (graph.hasEdge(edge.source, edge.target)) continue;
    graph.addEdge(edge.source, edge.target, { weight: edge.similarity });
  }

  const result = louvain.detailed(graph, {
    resolution,
    getEdgeWeight: "weight",
  });

  // Group nodes by cluster
  const clusterMembers = new Map<number, string[]>();
  const nodeLabels = new Map(nodes.map((n) => [n.id, n.label]));

  for (const [nodeId, clusterId] of Object.entries(result.communities)) {
    if (!clusterMembers.has(clusterId)) {
      clusterMembers.set(clusterId, []);
    }
    clusterMembers.get(clusterId)!.push(nodeLabels.get(nodeId) || nodeId);
  }

  return [...clusterMembers.entries()].map(([id, keywords]) => ({
    id,
    keywords,
  }));
}

async function benchmarkEndpoint(clusters: ClusterPayload[]): Promise<number> {
  const start = performance.now();

  const response = await fetch(`${BASE_URL}/api/cluster-labels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clusters }),
  });

  if (!response.ok) {
    throw new Error(`Endpoint failed: ${response.status}`);
  }

  await response.json();
  return performance.now() - start;
}

async function benchmarkDirectApi(clusters: ClusterPayload[]): Promise<number> {
  const start = performance.now();
  await generateClusterLabels(clusters);
  return performance.now() - start;
}

async function main() {
  const iterations = parseInt(process.argv[2] || "3", 10);
  const resolution = parseFloat(process.argv[3] || "1.0");

  console.log("Cluster Label Benchmark");
  console.log("=======================");
  console.log(`Iterations: ${iterations}`);
  console.log(`Resolution: ${resolution}`);
  console.log(`Server: ${BASE_URL}`);
  console.log();

  // Fetch graph data
  console.log("Fetching topics data...");
  const topicsData = await fetchTopicsData();
  console.log(`  Nodes: ${topicsData.nodes.length}`);
  console.log(`  Edges: ${topicsData.edges.length}`);
  console.log();

  // Compute clusters
  console.log("Computing clusters (Louvain)...");
  const clusterStart = performance.now();
  const clusters = computeClusters(topicsData.nodes, topicsData.edges, resolution);
  const clusterTime = performance.now() - clusterStart;
  console.log(`  Clusters: ${clusters.length}`);
  console.log(`  Time: ${clusterTime.toFixed(0)}ms`);

  const totalKeywords = clusters.reduce((sum, c) => sum + c.keywords.length, 0);
  console.log(`  Total keywords: ${totalKeywords}`);
  console.log();

  // Benchmark
  const endpointTimes: number[] = [];
  const directTimes: number[] = [];

  for (let i = 1; i <= iterations; i++) {
    console.log(`--- Iteration ${i}/${iterations} ---`);

    // Endpoint benchmark
    console.log("  Endpoint (/api/cluster-labels)...");
    const endpointTime = await benchmarkEndpoint(clusters);
    endpointTimes.push(endpointTime);
    console.log(`    ${endpointTime.toFixed(0)}ms`);

    // Direct API benchmark
    console.log("  Direct API (generateClusterLabels)...");
    const directTime = await benchmarkDirectApi(clusters);
    directTimes.push(directTime);
    console.log(`    ${directTime.toFixed(0)}ms`);

    console.log();
  }

  // Summary
  const avgEndpoint = endpointTimes.reduce((a, b) => a + b, 0) / endpointTimes.length;
  const avgDirect = directTimes.reduce((a, b) => a + b, 0) / directTimes.length;
  const networkOverhead = avgEndpoint - avgDirect;

  console.log("=======================");
  console.log("SUMMARY");
  console.log("=======================");
  console.log(`Clusters: ${clusters.length}`);
  console.log(`Keywords: ${totalKeywords}`);
  console.log();
  console.log(`Avg endpoint time:     ${avgEndpoint.toFixed(0)}ms`);
  console.log(`Avg direct API time:   ${avgDirect.toFixed(0)}ms`);
  console.log(`Network overhead:      ${networkOverhead.toFixed(0)}ms`);
  console.log();
  console.log(`Louvain clustering:    ${clusterTime.toFixed(0)}ms`);
  console.log();

  // Per-cluster estimate
  const perClusterTime = avgDirect / clusters.length;
  console.log(`Time per cluster:      ${perClusterTime.toFixed(1)}ms`);

  // CSV output for easy copying
  console.log();
  console.log("CSV: clusters,keywords,endpoint_ms,direct_ms,overhead_ms");
  console.log(`CSV: ${clusters.length},${totalKeywords},${avgEndpoint.toFixed(0)},${avgDirect.toFixed(0)},${networkOverhead.toFixed(0)}`);
}

main().catch(console.error);
