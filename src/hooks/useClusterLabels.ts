/**
 * Client-side Louvain clustering for Topics view.
 * Runs community detection on the rendered graph edges,
 * ensuring clusters match the visual layout.
 *
 * Features:
 * - Louvain clustering on rendered graph (matches visual layout)
 * - Semantic labels from Haiku API
 * - Client-side caching with semantic similarity matching
 */
import { useMemo, useState, useEffect, useRef } from "react";
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { KeywordNode, SimilarityEdge } from "@/lib/graph-queries";
import {
  loadCache,
  saveCache,
  computeCentroid,
  findBestMatch,
  addToCache,
  touchCacheEntry,
  type ClusterLabelCache,
  type CacheMatch,
} from "@/lib/cluster-label-cache";

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
  /** Cluster metadata indexed by cluster ID (stable - doesn't change when labels arrive) */
  baseClusters: Map<number, Omit<Cluster, "label">>;
  /** Cluster metadata with labels (changes when semantic labels arrive) */
  clusters: Map<number, Cluster>;
  /** Semantic labels from Haiku (empty until loaded) */
  labels: Record<number, string>;
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

export interface UseClusterLabelsOptions {
  onError?: (message: string) => void;
}

/**
 * Run Louvain clustering on the provided graph edges.
 * Fetches semantic labels from Haiku API asynchronously.
 *
 * @param nodes - Keyword nodes from the graph
 * @param edges - Similarity edges (same edges used for force layout)
 * @param resolution - Louvain resolution parameter (higher = more clusters)
 * @param options - Optional callbacks (onError for error notifications)
 */
export function useClusterLabels(
  nodes: KeywordNode[],
  edges: SimilarityEdge[],
  resolution: number,
  options?: UseClusterLabelsOptions
): ClusterLabelsResult {
  // Compute clustering synchronously
  const clustering = useMemo(
    () => computeClustering(nodes, edges, resolution),
    [nodes, edges, resolution]
  );

  // Track semantic labels from Haiku
  const [semanticLabels, setSemanticLabels] = useState<Record<number, string>>({});

  // Cache ref to persist across renders (loaded once on mount)
  const cacheRef = useRef<ClusterLabelCache | null>(null);

  // Stable ref for onError callback to avoid re-running effect
  const onErrorRef = useRef(options?.onError);
  onErrorRef.current = options?.onError;

  // Build label-to-embedding lookup for centroid calculation
  const embeddingsByLabel = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const node of nodes) {
      if (node.embedding) {
        map.set(node.label, node.embedding);
      }
    }
    return map;
  }, [nodes]);

  // Fetch semantic labels when clustering changes (with caching)
  useEffect(() => {
    if (clustering.clusters.size === 0) {
      setSemanticLabels({});
      return;
    }

    let cancelled = false;

    async function fetchLabelsWithCache() {
      // Load cache on first run
      if (!cacheRef.current) {
        cacheRef.current = loadCache();
      }
      const cache = cacheRef.current;

      const cachedLabels: Record<number, string> = {};
      const cacheHits: Array<{ clusterId: number; match: CacheMatch; keywords: string[] }> = [];
      const cacheMisses: Array<{
        id: number;
        keywords: string[];
        centroid: number[] | null;
      }> = [];

      // Threshold for "near match" that needs refinement
      const REFINEMENT_THRESHOLD = 0.95;

      // Check cache for each cluster
      for (const cluster of clustering.clusters.values()) {
        // Collect embeddings for this cluster's keywords
        const embeddings: number[][] = [];
        for (const keyword of cluster.members) {
          const emb = embeddingsByLabel.get(keyword);
          if (emb) embeddings.push(emb);
        }

        // Compute centroid if we have embeddings
        let centroid: number[] | null = null;
        if (embeddings.length > 0) {
          centroid = computeCentroid(embeddings);

          // Try to find cached match
          const match = findBestMatch(centroid, cache);
          if (match) {
            cachedLabels[cluster.id] = match.entry.label;
            cacheHits.push({ clusterId: cluster.id, match, keywords: cluster.members });
            touchCacheEntry(match.entry);
            continue;
          }
        }

        // No cache hit - need to fetch
        cacheMisses.push({
          id: cluster.id,
          keywords: cluster.members,
          centroid,
        });
      }

      // Show cached labels immediately
      if (Object.keys(cachedLabels).length > 0 && !cancelled) {
        setSemanticLabels(cachedLabels);
      }

      // Identify near-matches that need refinement (0.85 <= similarity < 0.95)
      const needsRefinement = cacheHits.filter(
        (hit) => hit.match.similarity < REFINEMENT_THRESHOLD
      );

      // Log cache stats
      if (cacheHits.length > 0 || cacheMisses.length > 0) {
        const exactHits = cacheHits.length - needsRefinement.length;
        console.log(
          `[cluster-cache] ${exactHits} exact hits, ${needsRefinement.length} near-matches, ${cacheMisses.length} misses`
        );
      }

      // Background refinement for near-matches
      if (needsRefinement.length > 0 && !cancelled) {
        // Fire and forget - don't await, let it update labels when done
        (async () => {
          try {
            const refinements = needsRefinement.map((hit) => ({
              id: hit.clusterId,
              oldLabel: hit.match.entry.label,
              oldKeywords: hit.match.entry.keywords,
              newKeywords: hit.keywords,
            }));

            const response = await fetch("/api/cluster-labels/refine", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ refinements }),
            });

            if (cancelled) return;

            const data = await response.json();
            if (!response.ok) {
              onErrorRef.current?.(data.error || "Failed to refine labels");
              return;
            }

            const { labels: refinedLabels } = data;

            if (!cancelled && Object.keys(refinedLabels).length > 0) {
              // Update displayed labels
              setSemanticLabels((prev) => ({ ...prev, ...refinedLabels }));

              // Update cache with refined labels
              for (const hit of needsRefinement) {
                const refinedLabel = refinedLabels[hit.clusterId];
                if (refinedLabel && refinedLabel !== hit.match.entry.label) {
                  // Update existing cache entry with new label
                  hit.match.entry.label = refinedLabel;
                  hit.match.entry.keywords = hit.keywords.slice().sort();
                }
              }
              saveCache(cache);

              console.log(
                `[cluster-cache] Refined ${Object.keys(refinedLabels).length} labels`
              );
            }
          } catch (err) {
            console.error("[cluster-labels/refine] Error:", err);
            onErrorRef.current?.(err instanceof Error ? err.message : "Failed to refine labels");
          }
        })();
      }

      // Fetch fresh labels for misses only
      if (cacheMisses.length > 0) {
        try {
          const clustersPayload = cacheMisses.map((c) => ({
            id: c.id,
            keywords: c.keywords,
          }));

          const response = await fetch("/api/cluster-labels", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clusters: clustersPayload }),
          });

          const data = await response.json();
          if (!response.ok) {
            onErrorRef.current?.(data.error || "Failed to generate labels");
            return;
          }

          const { labels } = data;

          if (!cancelled) {
            // Merge fresh labels with cached ones
            setSemanticLabels((prev) => ({ ...prev, ...labels }));

            // Update cache with fresh results
            for (const miss of cacheMisses) {
              const label = labels[miss.id];
              if (label && miss.centroid) {
                addToCache(cache, {
                  keywords: miss.keywords.slice().sort(),
                  centroid: miss.centroid,
                  label,
                });
              }
            }

            // Persist cache
            saveCache(cache);
          }
        } catch (err) {
          console.error("[cluster-labels] Error:", err);
          onErrorRef.current?.(err instanceof Error ? err.message : "Failed to generate labels");
        }
      }
    }

    // Clear previous labels and fetch new ones
    setSemanticLabels({});
    fetchLabelsWithCache();

    return () => {
      cancelled = true;
    };
  }, [clustering, embeddingsByLabel]);

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
    baseClusters: clustering.clusters,
    clusters: clustersWithLabels,
    labels: semanticLabels,
  };
}
