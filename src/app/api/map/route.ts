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
 * semantic similarity edges.
 */
export async function GET() {
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

  return buildSemanticMap(pairs as SimilarityPair[]);
}

function buildSemanticMap(pairs: SimilarityPair[]) {
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
      edges.push(similarity ? { source, target, similarity } : { source, target });
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

  const nodes = [...articleNodes.values(), ...keywordNodes.values()];

  console.log(
    "[map] Loaded",
    articleNodes.size,
    "articles,",
    keywordNodes.size,
    "keywords,",
    edges.length,
    "edges (including",
    pairs.length,
    "similarity edges)"
  );

  return NextResponse.json({ nodes, edges });
}
