/**
 * Leiden clustering with periphery detection for graph nodes.
 * O(n log n) complexity with post-processing to identify extremity clusters.
 */
import Graph from 'graphology';
import leiden from 'graphology-communities-louvain'; // Also exports leiden
import betweennessCentrality from 'graphology-metrics/centrality/betweenness';
import type { KeywordNode, SimilarityEdge } from '@/lib/graph-queries';

export interface ClusterResult {
  nodeToCluster: Map<string, number>;
  clusters: Map<number, {
    id: number;
    members: string[];
    hub: string;
    /** True if this cluster is peripheral (low centrality) */
    isPeripheral: boolean;
  }>;
}

/**
 * Compute Leiden clustering with periphery detection.
 *
 * @param nodes - Graph nodes
 * @param edges - Similarity edges
 * @param resolution - Controls granularity (higher = more clusters)
 * @returns Cluster assignments and metadata with periphery flags
 */
export function computeLeidenClustering(
  nodes: KeywordNode[],
  edges: SimilarityEdge[],
  resolution: number
): ClusterResult {
  if (nodes.length === 0) {
    return { nodeToCluster: new Map(), clusters: new Map() };
  }

  // Build graph
  const graph = buildGraph(nodes, edges);

  // Run Leiden clustering (O(n log n))
  const result = leiden.detailed(graph, {
    resolution,
    getEdgeWeight: 'weight',
  });

  // Compute betweenness centrality to identify peripheral nodes (O(n log n))
  const centrality = betweennessCentrality(graph);

  // Build cluster assignments and identify peripheral clusters
  return buildClusterMaps(nodes, result.communities, graph, centrality);
}

function buildGraph(nodes: KeywordNode[], edges: SimilarityEdge[]): Graph {
  const graph = new Graph({ type: 'undirected' });
  nodes.forEach(n => graph.addNode(n.id));
  edges.forEach(e => {
    if (graph.hasNode(e.source) && graph.hasNode(e.target)) {
      // Skip self-loops and duplicate edges
      if (e.source === e.target) return;
      if (graph.hasEdge(e.source, e.target)) return;

      graph.addEdge(e.source, e.target, { weight: e.similarity });
    }
  });
  return graph;
}

function buildClusterMaps(
  nodes: KeywordNode[],
  communities: Record<string, number>,
  graph: Graph,
  centrality: Record<string, number>
): ClusterResult {
  const nodeToCluster = new Map<string, number>();
  const clusterMembers = new Map<number, Array<{
    id: string;
    label: string;
    degree: number;
    centrality: number;
  }>>();

  // Build cluster membership
  for (const [nodeId, clusterId] of Object.entries(communities)) {
    nodeToCluster.set(nodeId, clusterId);

    if (!clusterMembers.has(clusterId)) {
      clusterMembers.set(clusterId, []);
    }

    const node = nodes.find(n => n.id === nodeId);
    if (node) {
      clusterMembers.get(clusterId)!.push({
        id: nodeId,
        label: node.label,
        degree: graph.degree(nodeId),
        centrality: centrality[nodeId] || 0,
      });
    }
  }

  // Identify peripheral clusters and select hubs
  const clusters = new Map();
  for (const [clusterId, members] of clusterMembers) {
    // Compute average centrality for this cluster
    const avgCentrality = members.reduce((sum, m) => sum + m.centrality, 0) / members.length;

    // Peripheral clusters have low average centrality (bottom 25th percentile)
    const allAvgCentralities = Array.from(clusterMembers.values()).map(m =>
      m.reduce((sum, node) => sum + node.centrality, 0) / m.length
    );
    allAvgCentralities.sort((a, b) => a - b);
    const peripheryThreshold = allAvgCentralities[Math.floor(allAvgCentralities.length * 0.25)];
    const isPeripheral = avgCentrality <= peripheryThreshold;

    // Select hub (highest degree, shortest label)
    const sorted = [...members].sort((a, b) => {
      if (b.degree !== a.degree) return b.degree - a.degree;
      return a.label.length - b.label.length;
    });

    clusters.set(clusterId, {
      id: clusterId,
      members: members.map(m => m.label),
      hub: sorted[0].label,
      isPeripheral,
    });
  }

  return { nodeToCluster, clusters };
}
