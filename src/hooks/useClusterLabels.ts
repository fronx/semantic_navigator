/**
 * Client-side Louvain clustering for Topics view.
 * Runs community detection on the rendered graph edges,
 * ensuring clusters match the visual layout.
 */
import { useMemo } from "react";
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { KeywordNode, SimilarityEdge } from "@/lib/graph-queries";

export interface Cluster {
  id: number;
  /** Keywords in this cluster */
  members: string[];
  /** Hub keyword (highest degree, then shortest name) */
  hub: string;
}

export interface ClusterLabelsResult {
  /** Map from node ID (e.g., "kw:machine learning") to cluster ID */
  nodeToCluster: Map<string, number>;
  /** Cluster metadata indexed by cluster ID */
  clusters: Map<number, Cluster>;
}

/**
 * Run Louvain clustering on the provided graph edges.
 *
 * @param nodes - Keyword nodes from the graph
 * @param edges - Similarity edges (same edges used for force layout)
 * @param resolution - Louvain resolution parameter (higher = more clusters)
 */
export function useClusterLabels(
  nodes: KeywordNode[],
  edges: SimilarityEdge[],
  resolution: number
): ClusterLabelsResult {
  return useMemo(() => {
    if (nodes.length === 0) {
      return { nodeToCluster: new Map(), clusters: new Map() };
    }

    // Build graphology graph from edges
    const graph = new Graph({ type: "undirected" });

    for (const node of nodes) {
      graph.addNode(node.id);
    }

    for (const edge of edges) {
      // Skip if nodes don't exist (shouldn't happen, but defensive)
      if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
      // Skip self-loops and duplicate edges
      if (edge.source === edge.target) continue;
      if (graph.hasEdge(edge.source, edge.target)) continue;

      graph.addEdge(edge.source, edge.target, { weight: edge.similarity });
    }

    // Run Louvain
    const result = louvain.detailed(graph, {
      resolution,
      getEdgeWeight: "weight",
    });

    // Build nodeToCluster map
    const nodeToCluster = new Map<string, number>();
    for (const [nodeId, clusterId] of Object.entries(result.communities)) {
      nodeToCluster.set(nodeId, clusterId);
    }

    // Group nodes by cluster and find hubs
    const clusterMembers = new Map<number, Array<{ id: string; label: string; degree: number }>>();
    const nodeLabels = new Map(nodes.map((n) => [n.id, n.label]));

    for (const [nodeId, clusterId] of nodeToCluster) {
      if (!clusterMembers.has(clusterId)) {
        clusterMembers.set(clusterId, []);
      }
      clusterMembers.get(clusterId)!.push({
        id: nodeId,
        label: nodeLabels.get(nodeId) || nodeId,
        degree: graph.degree(nodeId),
      });
    }

    // Build cluster metadata
    const clusters = new Map<number, Cluster>();
    for (const [clusterId, members] of clusterMembers) {
      // Sort by degree desc, then label length asc to find hub
      const sorted = [...members].sort((a, b) => {
        if (b.degree !== a.degree) return b.degree - a.degree;
        return a.label.length - b.label.length;
      });

      clusters.set(clusterId, {
        id: clusterId,
        members: members.map((m) => m.label),
        hub: sorted[0].label,
      });
    }

    return { nodeToCluster, clusters };
  }, [nodes, edges, resolution]);
}
