/**
 * Reusable database queries for building graph visualizations.
 *
 * These functions fetch and transform data from Supabase into graph structures.
 * They receive the Supabase client as a parameter and return typed results.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { cosineSimilarity } from "./math-utils";

// ============================================================================
// Types
// ============================================================================

export interface KeywordNode {
  id: string;
  label: string;
  communityId?: number;
  /** 256-dim embedding for semantic operations */
  embedding?: number[];
  /** Number of backbone edges (non-k-NN) connected to this keyword */
  degree?: number;
}

/** Project node for user-created organizational nodes in the graph */
export interface ProjectNode {
  id: string;
  title: string;
  content: string | null;
  /** Graph position (world coordinates) */
  position_x: number | null;
  position_y: number | null;
  /** 256-dim embedding for semantic operations */
  embedding?: number[];
}

export interface SimilarityEdge {
  source: string;
  target: string;
  /** Semantic similarity between keywords (0-1) */
  similarity: number;
  /** True if this is a k-NN connectivity edge (not from cross-article match) */
  isKNN?: boolean;
}

export interface KeywordBackboneResult {
  nodes: KeywordNode[];
  edges: SimilarityEdge[];
}

export interface KeywordBackboneOptions {
  /** Maximum edges per article in the underlying query (default: 10) */
  maxEdgesPerArticle?: number;
  /** Minimum similarity threshold (default: 0.3) */
  minSimilarity?: number;
  /** Community level for coloring (0-7, default: 3) */
  communityLevel?: number;
  /** Number of nearest neighbors to connect each keyword to (default: 1) */
  nearestNeighbors?: number;
  /** Node type to query ('article' or 'chunk', default: 'chunk') */
  nodeType?: 'article' | 'chunk';
}

/** Default options for getKeywordBackbone */
export const DEFAULT_BACKBONE_OPTIONS: Required<KeywordBackboneOptions> = {
  maxEdgesPerArticle: 10,
  minSimilarity: 0.3,
  communityLevel: 3,
  nearestNeighbors: 1,
  nodeType: 'article', // Default to article-level view (can be 'article' or 'chunk')
};

/** Supabase query batch size to avoid payload limits */
const QUERY_BATCH_SIZE = 100;

// ============================================================================
// Queries
// ============================================================================

/**
 * Get keyword backbone graph: keywords connected by cross-article semantic similarity.
 *
 * Projects the existing article-keyword graph to show only keywords.
 * Two keywords are connected if they bridge different articles via semantic similarity.
 * Additionally, each keyword is connected to its K nearest semantic neighbors
 * to ensure graph connectivity (no orphans or disconnected subgraphs).
 */
export async function getKeywordBackbone(
  supabase: SupabaseClient,
  options: KeywordBackboneOptions = {}
): Promise<KeywordBackboneResult> {
  const {
    maxEdgesPerArticle,
    minSimilarity,
    communityLevel,
    nearestNeighbors,
    nodeType,
  } = { ...DEFAULT_BACKBONE_OPTIONS, ...options };

  // Use parameterized RPC that finds keyword connections (articles or chunks)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("get_keyword_graph", {
    filter_node_type: nodeType,
    max_edges_per_node: maxEdgesPerArticle,
    min_similarity: minSimilarity,
  });

  if (error) {
    console.error("[graph-queries] Error fetching keyword graph:", error);
    throw new Error(`Failed to fetch keyword backbone: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Project to keywords only: extract unique keywords and keyword↔keyword edges
  // Track keyword IDs for embedding lookup
  const keywordSet = new Set<string>();
  const keywordTextToId = new Map<string, string>();
  const edgeMap = new Map<string, { similarity: number; count: number }>();

  for (const row of data) {
    const kw1 = row.keyword_text as string;
    const kw2 = row.similar_keyword_text as string;
    const kw1Id = row.keyword_id as string;
    const kw2Id = row.similar_keyword_id as string;
    const similarity = row.similarity as number;

    // Always add keywords (even from self-loops)
    keywordSet.add(kw1);
    keywordSet.add(kw2);
    if (!keywordTextToId.has(kw1)) keywordTextToId.set(kw1, kw1Id);
    if (!keywordTextToId.has(kw2)) keywordTextToId.set(kw2, kw2Id);

    // Skip self-loops for edges (same keyword appearing in different articles)
    if (kw1 === kw2) continue;

    // Canonical edge key (alphabetical order)
    const edgeKey = kw1 < kw2 ? `${kw1}|${kw2}` : `${kw2}|${kw1}`;

    // Track max similarity and count for each edge
    const existing = edgeMap.get(edgeKey);
    if (!existing || similarity > existing.similarity) {
      edgeMap.set(edgeKey, {
        similarity,
        count: (existing?.count || 0) + 1,
      });
    } else {
      existing.count++;
    }
  }

  // Build nodes
  const nodes: KeywordNode[] = [...keywordSet].map((kw) => ({
    id: `kw:${kw}`,
    label: kw,
  }));

  // Build edges from cross-article connections
  const edges: SimilarityEdge[] = [...edgeMap.entries()].map(([key, { similarity }]) => {
    const [kw1, kw2] = key.split("|");
    return {
      source: `kw:${kw1}`,
      target: `kw:${kw2}`,
      similarity,
    };
  });

  // Add k-nearest-neighbor edges for connectivity and get embeddings
  let embeddingsMap = new Map<string, number[]>();
  if (nearestNeighbors > 0 && keywordTextToId.size > 0) {
    const { edges: neighborEdges, embeddings } = await computeNearestNeighborEdges(
      supabase,
      keywordTextToId,
      nearestNeighbors,
      edgeMap
    );
    edges.push(...neighborEdges);
    embeddingsMap = embeddings;
  }

  // Add embeddings to nodes
  for (const node of nodes) {
    const embedding = embeddingsMap.get(node.label);
    if (embedding) {
      node.embedding = embedding;
    }
  }

  // Add community colors
  if (communityLevel >= 0 && nodes.length > 0) {
    await addCommunityIds(supabase, nodes, communityLevel);
  }

  return { nodes, edges };
}

interface NearestNeighborResult {
  edges: SimilarityEdge[];
  embeddings: Map<string, number[]>;
}

/**
 * Compute k-nearest-neighbor edges to ensure graph connectivity.
 * Each keyword gets connected to its K nearest semantic neighbors.
 * Skips edges that already exist in the edge map.
 * Also returns the embeddings map for use in the result.
 */
async function computeNearestNeighborEdges(
  supabase: SupabaseClient,
  keywordTextToId: Map<string, string>,
  k: number,
  existingEdges: Map<string, { similarity: number; count: number }>
): Promise<NearestNeighborResult> {
    const keywordIds = [...keywordTextToId.values()];
  const embeddings = new Map<string, number[]>();

  // Fetch embeddings in batches
  for (let i = 0; i < keywordIds.length; i += QUERY_BATCH_SIZE) {
    const batch = keywordIds.slice(i, i + QUERY_BATCH_SIZE);
    const { data: kwData } = await supabase
      .from("keywords")
      .select("id, keyword, embedding_256")
      .in("id", batch);

    for (const kw of kwData || []) {
      if (kw.embedding_256) {
        const emb = typeof kw.embedding_256 === "string"
          ? JSON.parse(kw.embedding_256)
          : kw.embedding_256;
        embeddings.set(kw.keyword, emb);
      }
    }
  }

  // Compute k-NN for each keyword
  const keywords = [...embeddings.keys()];
  const results: SimilarityEdge[] = [];
  const addedEdges = new Set<string>();

  for (const kwA of keywords) {
    const embA = embeddings.get(kwA)!;
    const neighbors: Array<{ keyword: string; similarity: number }> = [];

    for (const kwB of keywords) {
      if (kwA === kwB) continue;
      const embB = embeddings.get(kwB)!;
      const sim = cosineSimilarity(embA, embB);
      neighbors.push({ keyword: kwB, similarity: sim });
    }

    // Sort by similarity descending and take top K
    neighbors.sort((a, b) => b.similarity - a.similarity);
    for (let i = 0; i < Math.min(k, neighbors.length); i++) {
      const kwB = neighbors[i].keyword;
      const edgeKey = kwA < kwB ? `${kwA}|${kwB}` : `${kwB}|${kwA}`;

      // Skip if edge already exists from cross-article connections or already added
      if (existingEdges.has(edgeKey) || addedEdges.has(edgeKey)) continue;

      addedEdges.add(edgeKey);
      results.push({
        source: `kw:${kwA}`,
        target: `kw:${kwB}`,
        similarity: neighbors[i].similarity,
        isKNN: true,
      });
    }
  }

  return { edges: results, embeddings };
}


/**
 * Add community IDs to keyword nodes for coloring.
 * Mutates the nodes array in place.
 */
async function addCommunityIds(
  supabase: SupabaseClient,
  nodes: KeywordNode[],
  level: number
): Promise<void> {
  const labels = nodes.map((n) => n.label);
    const communityByKeyword = new Map<string, number>();

  for (let i = 0; i < labels.length; i += QUERY_BATCH_SIZE) {
    const batch = labels.slice(i, i + QUERY_BATCH_SIZE);

    // Get keyword IDs for these labels (keywords are canonical - one per text)
    const { data: kwData } = await supabase
      .from("keywords")
      .select("id, keyword")
      .in("keyword", batch);

    if (!kwData || kwData.length === 0) continue;

    const keywordIds = kwData.map((k) => k.id);
    const keywordById = new Map(kwData.map((k) => [k.id, k.keyword]));

    // Get community assignments at specified level
    const { data: communities } = await supabase
      .from("keyword_communities")
      .select("keyword_id, community_id")
      .eq("level", level)
      .in("keyword_id", keywordIds);

    for (const c of communities || []) {
      const keyword = keywordById.get(c.keyword_id);
      if (keyword) {
        communityByKeyword.set(keyword, c.community_id);
      }
    }
  }

  // Apply community IDs to nodes
  for (const node of nodes) {
    const communityId = communityByKeyword.get(node.label);
    if (communityId !== undefined) {
      node.communityId = communityId;
    }
  }
}

/**
 * Get articles connected to a specific keyword.
 * Used for expanding a keyword node to show its articles.
 */
export async function getArticlesForKeyword(
  supabase: SupabaseClient,
  keyword: string
): Promise<Array<{ id: string; label: string; size: number }>> {
  const { data, error } = await supabase
    .from("keywords")
    .select(`
      id,
      keyword,
      keyword_occurrences!inner (
        node_id,
        node_type,
        nodes!inner (
          id,
          source_path,
          summary
        )
      )
    `)
    .eq("keyword_occurrences.node_type", "article")
    .eq("keyword", keyword) as any;

  if (error) {
    console.error("[graph-queries] Error fetching articles for keyword:", error);
    throw new Error(`Failed to fetch articles: ${error.message}`);
  }

  // Flatten keyword_occurrences array (keyword can occur in multiple articles)
  interface KeywordWithOccurrences {
    keyword_occurrences: Array<{
      nodes: { id: string; source_path: string; summary: string | null };
    }>;
  }

  return ((data || []) as KeywordWithOccurrences[]).flatMap((row) =>
    row.keyword_occurrences.map((occ) => ({
      id: `art:${occ.nodes.id}`,
      label: occ.nodes.source_path.split("/").pop()?.replace(".md", "") || occ.nodes.source_path,
      size: occ.nodes.summary?.length || 100,
    }))
  );
}
