import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export interface MapNode {
  id: string;
  type: "keyword" | "article";
  label: string;
  size?: number; // Content size (summary length) for scaling node radius
}

export interface MapEdge {
  source: string;
  target: string;
  // For keyword-keyword edges, indicates semantic similarity (0-1)
  similarity?: number;
}

export interface MapData {
  nodes: MapNode[];
  edges: MapEdge[];
}

interface SimilarityPair {
  keyword_id: string;
  keyword_text: string;
  article_id: string;
  article_path: string;
  article_size: number;
  similar_keyword_id: string;
  similar_keyword_text: string;
  similar_article_id: string;
  similar_article_path: string;
  similar_article_size: number;
  similarity: number;
}

/**
 * Build a semantic map of articles connected through similar keywords.
 *
 * Graph structure:
 *   Article A ──→ keyword "agency" ←──┐
 *                                     │ similarity edge
 *   Article B ──→ keyword "agents"  ←─┘
 *
 * Articles cluster together because their keywords are connected through
 * semantic similarity edges. Additionally, each keyword is connected to its
 * 2 nearest semantic neighbors (using 256-dim truncated embeddings).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const includeNeighbors = searchParams.get("neighbors") !== "false";

  const supabase = createServerClient();

  // Get semantically similar keyword pairs across articles
  const { data: pairs, error } = await supabase.rpc("get_article_keyword_graph", {
    similarity_threshold: 0.75,
  });

  if (error) {
    console.error("[map] Error fetching keyword graph:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!pairs || pairs.length === 0) {
    console.log("[map] No similar keyword pairs found");
    return NextResponse.json({ nodes: [], edges: [] });
  }

  const typedPairs = pairs as SimilarityPair[];

  // Collect unique keyword texts and one representative ID per text
  const keywordTextToId = new Map<string, string>();
  for (const pair of typedPairs) {
    if (!keywordTextToId.has(pair.keyword_text)) {
      keywordTextToId.set(pair.keyword_text, pair.keyword_id);
    }
    if (!keywordTextToId.has(pair.similar_keyword_text)) {
      keywordTextToId.set(pair.similar_keyword_text, pair.similar_keyword_id);
    }
  }

  // Fetch 256-dim embeddings for these keywords
  const keywordIds = [...keywordTextToId.values()];
  const { data: keywordEmbeddings, error: embError } = await supabase
    .from("keywords")
    .select("id, keyword, embedding_256")
    .in("id", keywordIds);

  if (embError) {
    console.error("[map] Error fetching keyword embeddings:", embError);
    return NextResponse.json({ error: embError.message }, { status: 500 });
  }

  // Build text → embedding map
  const keywordTextToEmbedding = new Map<string, number[]>();
  for (const kw of keywordEmbeddings || []) {
    if (kw.embedding_256) {
      // Supabase returns vectors as strings
      const emb = typeof kw.embedding_256 === "string"
        ? JSON.parse(kw.embedding_256)
        : kw.embedding_256;
      keywordTextToEmbedding.set(kw.keyword, emb);
    }
  }

  return buildSemanticMap(typedPairs, keywordTextToEmbedding, includeNeighbors);
}

/**
 * Compute cosine similarity between two unit vectors (just dot product).
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * For each keyword, find its top-K nearest neighbors from the embedding map.
 */
function computeKNearestNeighbors(
  embeddings: Map<string, number[]>,
  k: number
): Array<{ source: string; target: string; similarity: number }> {
  const keywords = [...embeddings.keys()];
  const results: Array<{ source: string; target: string; similarity: number }> = [];

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
      results.push({
        source: `kw:${kwA}`,
        target: `kw:${neighbors[i].keyword}`,
        similarity: neighbors[i].similarity,
      });
    }
  }

  return results;
}

function buildSemanticMap(
  pairs: SimilarityPair[],
  keywordEmbeddings: Map<string, number[]>,
  includeNeighbors: boolean
) {
  const articleNodes = new Map<string, MapNode>();
  const keywordNodes = new Map<string, MapNode>();
  const edges: MapEdge[] = [];
  const edgeSet = new Set<string>();

  function addArticleNode(id: string, path: string, size: number) {
    const artNodeId = `art:${id}`;
    if (!articleNodes.has(artNodeId)) {
      const label = path.split("/").pop()?.replace(".md", "") || path;
      articleNodes.set(artNodeId, { id: artNodeId, type: "article", label, size });
    }
    return artNodeId;
  }

  function addKeywordNode(text: string) {
    // Key by text to deduplicate identical keywords across articles
    const kwNodeId = `kw:${text}`;
    if (!keywordNodes.has(kwNodeId)) {
      keywordNodes.set(kwNodeId, { id: kwNodeId, type: "keyword", label: text });
    }
    return kwNodeId;
  }

  function addEdge(source: string, target: string, similarity?: number) {
    const edgeKey = [source, target].sort().join("-");
    if (!edgeSet.has(edgeKey)) {
      edgeSet.add(edgeKey);
      edges.push(similarity !== undefined ? { source, target, similarity } : { source, target });
    }
  }

  for (const pair of pairs) {
    // Create nodes for both articles and keywords
    const art1Id = addArticleNode(pair.article_id, pair.article_path, pair.article_size);
    const art2Id = addArticleNode(pair.similar_article_id, pair.similar_article_path, pair.similar_article_size);
    const kw1Id = addKeywordNode(pair.keyword_text);
    const kw2Id = addKeywordNode(pair.similar_keyword_text);

    // Create edges: article → keyword (ownership)
    addEdge(art1Id, kw1Id);
    addEdge(art2Id, kw2Id);

    // Create edge: keyword ↔ keyword (semantic similarity)
    // Skip if same keyword text (would be a self-loop after deduplication)
    if (kw1Id !== kw2Id) {
      addEdge(kw1Id, kw2Id, pair.similarity);
    }
  }

  // Optionally compute 2-nearest neighbors for each keyword and add those edges
  // Scale similarity by 0.5 so these secondary connections are weaker than primary cross-article ones
  let newNeighborEdges = 0;
  if (includeNeighbors) {
    const NEIGHBOR_EDGE_WEIGHT = 0.5;
    const neighborEdges = computeKNearestNeighbors(keywordEmbeddings, 2);
    for (const edge of neighborEdges) {
      const beforeSize = edgeSet.size;
      addEdge(edge.source, edge.target, edge.similarity * NEIGHBOR_EDGE_WEIGHT);
      if (edgeSet.size > beforeSize) newNeighborEdges++;
    }
  }

  const nodes = [...articleNodes.values(), ...keywordNodes.values()];

  console.log(
    "[map] Loaded",
    articleNodes.size,
    "articles,",
    keywordNodes.size,
    "keywords,",
    edges.length,
    "edges (" + newNeighborEdges + " new from 2-NN)"
  );

  return NextResponse.json({ nodes, edges });
}
