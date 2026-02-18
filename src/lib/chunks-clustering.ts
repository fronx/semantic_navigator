import Graph from "graphology";
import leiden from "graphology-communities-louvain";

interface WeightedEdge {
  source: number;
  target: number;
  weight: number;
}

/**
 * Run Leiden clustering on a UMAP neighborhood graph.
 * Nodes are integer indices (0..nodeCount-1), edges carry weights.
 *
 * @returns Map from node index to cluster ID
 */
export function clusterUmapGraph(
  edges: WeightedEdge[],
  nodeCount: number,
  resolution: number
): Map<number, number> {
  const graph = new Graph({ type: "undirected" });

  for (let i = 0; i < nodeCount; i++) {
    graph.addNode(String(i));
  }

  for (const edge of edges) {
    const src = String(edge.source);
    const tgt = String(edge.target);
    if (src === tgt) continue;
    if (graph.hasEdge(src, tgt)) continue;
    graph.addEdge(src, tgt, { weight: edge.weight });
  }

  const result = leiden.detailed(graph, {
    resolution,
    getEdgeWeight: "weight",
  });

  const nodeToCluster = new Map<number, number>();
  for (const [nodeStr, clusterId] of Object.entries(result.communities)) {
    nodeToCluster.set(parseInt(nodeStr, 10), clusterId);
  }
  return nodeToCluster;
}
