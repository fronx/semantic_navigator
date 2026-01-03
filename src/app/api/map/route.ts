import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { generateEmbedding, truncateEmbedding } from "@/lib/embeddings";

export interface MapNode {
  id: string;
  type: "keyword" | "article" | "section" | "paragraph";
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
  searchMeta?: {
    query: string;
    synonymThreshold: number;
    filteredKeywordCount: number;
    premiseKeywords: string[];  // keywords that matched the query (filtered out as synonyms)
  };
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
  const query = searchParams.get("query");
  // synonymThreshold: keywords MORE similar than this to the query are filtered out
  // The query acts as a "premise" - we remove it and its synonyms to see remaining structure
  const synonymThreshold = parseFloat(searchParams.get("synonymThreshold") || "0.85");

  const supabase = createServerClient();

  // If query provided, return filtered map (excludes synonyms of the query)
  if (query && query.trim()) {
    return getFilteredMap(supabase, query.trim(), synonymThreshold, includeNeighbors);
  }

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

function buildSemanticMapData(
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
  if (includeNeighbors) {
    const NEIGHBOR_EDGE_WEIGHT = 0.5;
    const neighborEdges = computeKNearestNeighbors(keywordEmbeddings, 2);
    for (const edge of neighborEdges) {
      addEdge(edge.source, edge.target, edge.similarity * NEIGHBOR_EDGE_WEIGHT);
    }
  }

  const nodes = [...articleNodes.values(), ...keywordNodes.values()];

  return {
    nodes,
    edges,
    articleCount: articleNodes.size,
    keywordCount: keywordNodes.size,
  };
}

function buildSemanticMap(
  pairs: SimilarityPair[],
  keywordEmbeddings: Map<string, number[]>,
  includeNeighbors: boolean
) {
  const result = buildSemanticMapData(pairs, keywordEmbeddings, includeNeighbors);

  console.log(
    "[map] Loaded",
    result.articleCount,
    "articles,",
    result.keywordCount,
    "keywords,",
    result.edges.length,
    "edges"
  );

  return NextResponse.json({ nodes: result.nodes, edges: result.edges });
}

/**
 * Fallback when no cross-article keyword pairs exist: show matching articles
 * with their non-synonym keywords, connected only by article→keyword edges.
 */
async function getFallbackFilteredMap(
  supabase: ReturnType<typeof createServerClient>,
  embedding256: number[],
  synonymThreshold: number,
  premiseKeywords: string[],
  query: string
) {
  // Query for matching articles and their non-synonym keywords
  const { data: articleKeywords, error } = await supabase
    .from("keywords")
    .select(`
      id,
      keyword,
      embedding_256,
      node_id,
      nodes!inner (
        id,
        source_path,
        summary,
        node_type
      )
    `)
    .eq("nodes.node_type", "article")
    .not("embedding_256", "is", null);

  if (error) {
    console.error("[map] Error fetching fallback keywords:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Collect article info and keywords by similarity
  const articleInfo = new Map<string, { path: string; size: number; hasMatch: boolean }>();
  const keywordsByArticle = new Map<string, Array<{ keyword: string; similarity: number }>>();

  for (const kw of articleKeywords || []) {
    if (!kw.embedding_256 || !kw.nodes) continue;
    const node = kw.nodes as { id: string; source_path: string; summary: string | null };
    const emb = typeof kw.embedding_256 === "string" ? JSON.parse(kw.embedding_256) : kw.embedding_256;
    const sim = cosineSimilarity(embedding256, emb);

    // Track article info
    if (!articleInfo.has(node.id)) {
      articleInfo.set(node.id, {
        path: node.source_path,
        size: node.summary?.length || 0,
        hasMatch: false,
      });
    }

    // Mark as matching if any keyword >= threshold
    if (sim >= synonymThreshold) {
      articleInfo.get(node.id)!.hasMatch = true;
    }

    // Collect all keywords per article (we'll filter later)
    if (!keywordsByArticle.has(node.id)) {
      keywordsByArticle.set(node.id, []);
    }
    keywordsByArticle.get(node.id)!.push({ keyword: kw.keyword, similarity: sim });
  }

  // Build nodes and edges for matching articles
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  const addedKeywords = new Set<string>();

  for (const [articleId, info] of articleInfo) {
    if (!info.hasMatch) continue; // Skip articles that don't match

    const artNodeId = `art:${articleId}`;
    const label = info.path.split("/").pop()?.replace(".md", "") || info.path;
    nodes.push({ id: artNodeId, type: "article", label, size: info.size });

    // Add non-synonym keywords for this article
    const keywords = keywordsByArticle.get(articleId) || [];
    const nonSynonymKeywords = keywords.filter(kw => kw.similarity < synonymThreshold);

    for (const kw of nonSynonymKeywords) {
      const kwNodeId = `kw:${kw.keyword}`;
      if (!addedKeywords.has(kw.keyword)) {
        addedKeywords.add(kw.keyword);
        nodes.push({ id: kwNodeId, type: "keyword", label: kw.keyword });
      }
      edges.push({ source: artNodeId, target: kwNodeId });
    }
  }

  const articleCount = nodes.filter(n => n.type === "article").length;
  const keywordCount = addedKeywords.size;

  console.log(
    "[map] Fallback filtered map for query:",
    query,
    "-",
    articleCount,
    "articles,",
    keywordCount,
    "keywords (no cross-article edges)"
  );

  return NextResponse.json({
    nodes,
    edges,
    searchMeta: {
      query,
      synonymThreshold,
      filteredKeywordCount: keywordCount,
      premiseKeywords,
    },
  });
}

/**
 * Build a filtered map by excluding keywords that are synonyms of the query.
 * The query acts as a "premise" - we factor it out to see the remaining structure.
 */
async function getFilteredMap(
  supabase: ReturnType<typeof createServerClient>,
  query: string,
  synonymThreshold: number,
  includeNeighbors: boolean
) {
  // Generate embedding for query and truncate to 256 dims
  const fullEmbedding = await generateEmbedding(query);
  const embedding256 = truncateEmbedding(fullEmbedding, 256);

  // Call RPC to get keyword pairs from matching articles, excluding synonyms
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pairs, error } = await (supabase.rpc as any)("get_filtered_map", {
    query_embedding_256: JSON.stringify(embedding256),
    match_threshold: synonymThreshold,  // slider controls article match threshold
    keyword_similarity_threshold: 0.75,
  });

  if (error) {
    console.error("[map] Error fetching filtered map:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const typedPairs = (pairs || []) as SimilarityPair[];

  // Fetch premise keywords (those that matched the query, i.e. >= threshold)
  // These are the "synonyms" that got filtered out
  const { data: premiseData } = await supabase
    .from("keywords")
    .select("keyword, embedding_256")
    .not("embedding_256", "is", null);

  const premiseKeywords: string[] = [];
  if (premiseData) {
    for (const kw of premiseData) {
      if (kw.embedding_256) {
        const emb = typeof kw.embedding_256 === "string"
          ? JSON.parse(kw.embedding_256)
          : kw.embedding_256;
        const sim = cosineSimilarity(embedding256, emb);
        if (sim >= synonymThreshold) {
          premiseKeywords.push(kw.keyword);
        }
      }
    }
  }
  // Deduplicate and sort by relevance (we only have unique keywords anyway)
  const uniquePremiseKeywords = [...new Set(premiseKeywords)];

  // If no cross-article keyword pairs, fall back to showing articles with their keywords
  // (just without keyword↔keyword similarity edges)
  if (typedPairs.length === 0) {
    console.log("[map] No keyword pairs found, falling back to article-keyword graph");
    return getFallbackFilteredMap(supabase, embedding256, synonymThreshold, uniquePremiseKeywords, query);
  }

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

  // Fetch 256-dim embeddings for neighbor computation
  let keywordTextToEmbedding = new Map<string, number[]>();
  if (includeNeighbors) {
    const keywordIds = [...keywordTextToId.values()];
    const { data: keywordEmbeddings, error: embError } = await supabase
      .from("keywords")
      .select("id, keyword, embedding_256")
      .in("id", keywordIds);

    if (!embError && keywordEmbeddings) {
      for (const kw of keywordEmbeddings || []) {
        if (kw.embedding_256) {
          const emb = typeof kw.embedding_256 === "string"
            ? JSON.parse(kw.embedding_256)
            : kw.embedding_256;
          keywordTextToEmbedding.set(kw.keyword, emb);
        }
      }
    }
  }

  // Reuse the same graph building logic
  const result = buildSemanticMapData(typedPairs, keywordTextToEmbedding, includeNeighbors);

  console.log(
    "[map] Filtered map for query:",
    query,
    "- excluded synonyms above",
    synonymThreshold,
    "-",
    result.articleCount,
    "articles,",
    result.keywordCount,
    "keywords"
  );

  return NextResponse.json({
    nodes: result.nodes,
    edges: result.edges,
    searchMeta: {
      query,
      synonymThreshold,
      filteredKeywordCount: result.keywordCount,
      premiseKeywords: uniquePremiseKeywords,
    },
  });
}
