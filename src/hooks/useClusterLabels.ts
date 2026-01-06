/**
 * Client-side Louvain clustering for Topics view.
 * Runs community detection on the rendered graph edges,
 * ensuring clusters match the visual layout.
 *
 * Phase 2: Fetches semantic labels from Haiku API.
 */
import { useMemo, useState, useEffect } from "react";
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { KeywordNode, SimilarityEdge } from "@/lib/graph-queries";

export interface Cluster {
  id: number;
  /** Keywords in this cluster */
  members: string[];
  /** Hub keyword (highest degree, then shortest name) */
  hub: string;
  /** Display label - starts as hub, updated to Haiku label when available */
  label: string;
}

export interface ClusterLabelsResult {
  /** Map from node ID (e.g., "kw:machine learning") to cluster ID */
  nodeToCluster: Map<string, number>;
  /** Cluster metadata indexed by cluster ID */
  clusters: Map<number, Cluster>;
}

interface ClusteringResult {
  nodeToCluster: Map<string, number>;
  clusters: Map<number, Omit<Cluster, "label">>;
}

/**
 * Compute Louvain clustering on the graph.
 * Pure function - no React hooks.
 */
function computeClustering(
  nodes: KeywordNode[],
  edges: SimilarityEdge[],
  resolution: number
): ClusteringResult {
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
  const clusters = new Map<number, Omit<Cluster, "label">>();
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
}

/**
 * Create a stable key for a clustering result.
 * Used to detect when we need to fetch new labels.
 */
function clusterKey(clusters: Map<number, Omit<Cluster, "label">>): string {
  const entries = [...clusters.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, c]) => `${id}:${c.members.slice(0, 5).join(",")}`);
  return entries.join("|");
}

/**
 * Run Louvain clustering on the provided graph edges.
 * Fetches semantic labels from Haiku API asynchronously.
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
  // Compute clustering synchronously
  const clustering = useMemo(
    () => computeClustering(nodes, edges, resolution),
    [nodes, edges, resolution]
  );

  // Track semantic labels from Haiku
  const [semanticLabels, setSemanticLabels] = useState<Record<number, string>>({});

  // Fetch semantic labels when clustering changes
  useEffect(() => {
    if (clustering.clusters.size === 0) {
      setSemanticLabels({});
      return;
    }

    const currentKey = clusterKey(clustering.clusters);
    let cancelled = false;

    async function fetchLabels() {
      try {
        const clustersPayload = [...clustering.clusters.values()].map((c) => ({
          id: c.id,
          keywords: c.members,
        }));

        const response = await fetch("/api/cluster-labels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clusters: clustersPayload }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const { labels } = await response.json();

        if (!cancelled) {
          setSemanticLabels(labels);
        }
      } catch (error) {
        console.error("[useClusterLabels] Failed to fetch semantic labels:", error);
        // Keep using hub labels on error
      }
    }

    // Clear previous labels and fetch new ones
    setSemanticLabels({});
    fetchLabels();

    return () => {
      cancelled = true;
    };
  }, [clustering]);

  // Merge clustering with semantic labels
  const clustersWithLabels = useMemo(() => {
    const result = new Map<number, Cluster>();
    for (const [id, cluster] of clustering.clusters) {
      result.set(id, {
        ...cluster,
        label: semanticLabels[id] || cluster.hub,
      });
    }
    return result;
  }, [clustering, semanticLabels]);

  return {
    nodeToCluster: clustering.nodeToCluster,
    clusters: clustersWithLabels,
  };
}
