import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { generateEmbedding, truncateEmbedding } from "@/lib/embeddings";

export interface MapNode {
  id: string;
  type: "keyword" | "article" | "chunk";
  label: string;
  size?: number; // Content size (summary length) for scaling node radius
  // Community info for hub keywords (when clustered=true)
  communityId?: number;
  communityMembers?: string[]; // Labels of other keywords in the community
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
  const clustered = searchParams.get("clustered") === "true";
  const query = searchParams.get("query");
  // synonymThreshold: keywords MORE similar than this to the query are filtered out
  // The query acts as a "premise" - we remove it and its synonyms to see remaining structure
  const synonymThreshold = parseFloat(searchParams.get("synonymThreshold") || "0.85");
  // maxEdgesPerArticle: controls graph density (top-K similar connections per article)
  const maxEdgesPerArticle = parseInt(searchParams.get("maxEdges") || "5", 10);

  const supabase = createServerClient();

  // If query provided, return filtered map (excludes synonyms of the query)
  if (query && query.trim()) {
    return getFilteredMap(supabase, query.trim(), synonymThreshold, includeNeighbors);
  }

  // Get top-K semantically similar keyword pairs per article
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pairs, error } = await (supabase.rpc as any)("get_article_keyword_graph", {
    max_edges_per_article: maxEdgesPerArticle,
    min_similarity: 0.3,
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

  // Only fetch embeddings if we need them for neighbor computation
  let keywordTextToEmbedding = new Map<string, number[]>();

  if (includeNeighbors) {
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

    // Fetch 256-dim embeddings in batches (Supabase has limits on .in() size)
    const keywordIds = [...keywordTextToId.values()];
    const BATCH_SIZE = 100; // Keep small to avoid headers overflow with UUIDs

    for (let i = 0; i < keywordIds.length; i += BATCH_SIZE) {
      const batch = keywordIds.slice(i, i + BATCH_SIZE);
      const { data: keywordEmbeddings, error: embError } = await supabase
        .from("keywords")
        .select("id, keyword, embedding_256")
        .in("id", batch);

      if (embError) {
        console.error("[map] Error fetching keyword embeddings:", embError);
        return NextResponse.json({ error: embError.message }, { status: 500 });
      }

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

  return buildSemanticMap(supabase, typedPairs, keywordTextToEmbedding, includeNeighbors, clustered);
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

async function buildSemanticMap(
  supabase: ReturnType<typeof createServerClient>,
  pairs: SimilarityPair[],
  keywordEmbeddings: Map<string, number[]>,
  includeNeighbors: boolean,
  clustered: boolean
) {
  let result = buildSemanticMapData(pairs, keywordEmbeddings, includeNeighbors);

  if (clustered) {
    result = await collapseCommunitiesToHubs(supabase, result);
  } else {
    // Fetch community IDs for coloring (not collapsing)
    result = await addCommunityColors(supabase, result);
  }

  console.log(
    "[map] Loaded",
    result.articleCount,
    "articles,",
    result.keywordCount,
    "keywords,",
    result.edges.length,
    "edges",
    clustered ? "(clustered)" : ""
  );

  return NextResponse.json({ nodes: result.nodes, edges: result.edges });
}

/**
 * Add community IDs to keyword nodes for coloring (without collapsing).
 */
async function addCommunityColors(
  supabase: ReturnType<typeof createServerClient>,
  mapData: { nodes: MapNode[]; edges: MapEdge[]; articleCount: number; keywordCount: number }
) {
  const keywordLabels = mapData.nodes
    .filter(n => n.type === "keyword")
    .map(n => n.label);

  if (keywordLabels.length === 0) return mapData;

  // Fetch community IDs in batches
  const BATCH_SIZE = 100;
  const communityByKeyword = new Map<string, number | null>();

  for (let i = 0; i < keywordLabels.length; i += BATCH_SIZE) {
    const batch = keywordLabels.slice(i, i + BATCH_SIZE);
    const { data } = await supabase
      .from("keywords")
      .select("keyword, community_id")
      .eq("node_type", "article")
      .in("keyword", batch);

    for (const kw of data || []) {
      communityByKeyword.set(kw.keyword, kw.community_id);
    }
  }

  // Add communityId to keyword nodes
  const nodes = mapData.nodes.map(node => {
    if (node.type !== "keyword") return node;
    const communityId = communityByKeyword.get(node.label);
    return communityId !== undefined && communityId !== null
      ? { ...node, communityId }
      : node;
  });

  return { ...mapData, nodes };
}

/**
 * Collapse keyword communities to their hub representatives.
 * Member keywords are merged into their hub, and edges are remapped.
 */
async function collapseCommunitiesToHubs(
  supabase: ReturnType<typeof createServerClient>,
  mapData: { nodes: MapNode[]; edges: MapEdge[]; articleCount: number; keywordCount: number }
) {
  // Get all keyword labels in the graph
  const keywordLabels = mapData.nodes
    .filter(n => n.type === "keyword")
    .map(n => n.label);

  if (keywordLabels.length === 0) {
    return mapData;
  }

  // Fetch community info for these keywords (batch to avoid .in() limit)
  const BATCH_SIZE = 100;
  const keywords: Array<{ keyword: string; community_id: number | null; is_community_hub: boolean | null }> = [];

  for (let i = 0; i < keywordLabels.length; i += BATCH_SIZE) {
    const batch = keywordLabels.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase
      .from("keywords")
      .select("keyword, community_id, is_community_hub")
      .eq("node_type", "article")
      .in("keyword", batch);

    if (error) {
      console.error("[map] Error fetching community info batch:", error);
      continue;
    }
    if (data) keywords.push(...data);
  }

  if (keywords.length === 0) {
    return mapData;
  }

  // Build lookup: keyword label -> { communityId, isHub }
  const keywordInfo = new Map<string, { communityId: number | null; isHub: boolean }>();
  for (const kw of keywords) {
    keywordInfo.set(kw.keyword, {
      communityId: kw.community_id,
      isHub: kw.is_community_hub || false,
    });
  }

  // Group keywords by community
  const communities = new Map<number, string[]>();
  const hubByKeyword = new Map<string, string>(); // member keyword -> hub keyword

  for (const [label, info] of keywordInfo) {
    if (info.communityId === null) {
      // Isolated keyword - maps to itself
      hubByKeyword.set(label, label);
      continue;
    }

    if (!communities.has(info.communityId)) {
      communities.set(info.communityId, []);
    }
    communities.get(info.communityId)!.push(label);
  }

  // Fetch actual hubs for all communities we found (hub might not be in visible graph)
  const communityIds = [...communities.keys()];
  const { data: hubData } = await supabase
    .from("keywords")
    .select("keyword, community_id")
    .eq("node_type", "article")
    .eq("is_community_hub", true)
    .in("community_id", communityIds);

  const hubByCommunity = new Map<number, string>();
  for (const h of hubData || []) {
    if (h.community_id !== null) {
      hubByCommunity.set(h.community_id, h.keyword);
    }
  }

  // For each community, map members to the actual hub
  const communityMembers = new Map<string, string[]>(); // hub label -> member labels

  for (const [communityId, members] of communities) {
    const hub = hubByCommunity.get(communityId);
    if (!hub) {
      // No hub found - each keyword maps to itself
      for (const m of members) hubByKeyword.set(m, m);
      continue;
    }

    // Collect all visible members (excluding hub if it's visible)
    const visibleMembers = members.filter(m => m !== hub);
    communityMembers.set(hub, visibleMembers);
    for (const m of members) {
      hubByKeyword.set(m, hub);
    }
  }

  // Build new node list: keep articles, replace keywords with hubs
  const newNodes: MapNode[] = [];
  const addedHubs = new Set<string>();

  for (const node of mapData.nodes) {
    if (node.type !== "keyword") {
      newNodes.push(node);
      continue;
    }

    const hubLabel = hubByKeyword.get(node.label) || node.label;
    const hubNodeId = `kw:${hubLabel}`;

    if (!addedHubs.has(hubLabel)) {
      addedHubs.add(hubLabel);
      const members = communityMembers.get(hubLabel) || [];
      newNodes.push({
        id: hubNodeId,
        type: "keyword",
        label: hubLabel,
        communityId: keywordInfo.get(hubLabel)?.communityId ?? undefined,
        communityMembers: members.length > 0 ? members : undefined,
      });
    }
  }

  // Remap edges to use hub keywords
  const newEdges: MapEdge[] = [];
  const edgeSet = new Set<string>();

  for (const edge of mapData.edges) {
    let source = edge.source;
    let target = edge.target;

    // Remap keyword nodes to their hubs
    if (source.startsWith("kw:")) {
      const label = source.slice(3);
      const hubLabel = hubByKeyword.get(label) || label;
      source = `kw:${hubLabel}`;
    }
    if (target.startsWith("kw:")) {
      const label = target.slice(3);
      const hubLabel = hubByKeyword.get(label) || label;
      target = `kw:${hubLabel}`;
    }

    // Skip self-loops (can happen when members of same community were connected)
    if (source === target) continue;

    // Deduplicate
    const edgeKey = [source, target].sort().join("-");
    if (!edgeSet.has(edgeKey)) {
      edgeSet.add(edgeKey);
      newEdges.push({ source, target, similarity: edge.similarity });
    }
  }

  return {
    nodes: newNodes,
    edges: newEdges,
    articleCount: mapData.articleCount,
    keywordCount: addedHubs.size,
  };
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
 * Check if query matches a hub keyword and expand to include all community members.
 * Returns the list of all keywords to search for (hub + members), or null if not a hub.
 */
async function expandHubKeyword(
  supabase: ReturnType<typeof createServerClient>,
  query: string
): Promise<string[] | null> {
  // Check if query is an exact match for a hub keyword
  const { data: hubMatch } = await supabase
    .from("keywords")
    .select("keyword, community_id, is_community_hub")
    .eq("node_type", "article")
    .eq("keyword", query)
    .eq("is_community_hub", true)
    .single();

  if (!hubMatch || hubMatch.community_id === null) {
    return null;
  }

  // Get all community members
  const { data: members } = await supabase
    .from("keywords")
    .select("keyword")
    .eq("node_type", "article")
    .eq("community_id", hubMatch.community_id);

  if (!members || members.length === 0) {
    return [query];
  }

  return members.map((m) => m.keyword);
}

/**
 * Build a filtered map for a hub keyword by finding articles with any community member keyword.
 * Shows all articles containing any of the community keywords, with those keywords excluded.
 */
async function getHubFilteredMap(
  supabase: ReturnType<typeof createServerClient>,
  hubLabel: string,
  communityKeywords: string[],
  _includeNeighbors: boolean // TODO: add neighbor computation if needed
) {
  // Find articles that have any of the community keywords
  // We need to batch this query to avoid .in() limits
  const BATCH_SIZE = 50;
  const articleIds = new Set<string>();
  const articleInfo = new Map<string, { path: string; size: number }>();

  for (let i = 0; i < communityKeywords.length; i += BATCH_SIZE) {
    const batch = communityKeywords.slice(i, i + BATCH_SIZE);
    const { data: keywordsWithArticles } = await supabase
      .from("keywords")
      .select(`
        keyword,
        node_id,
        nodes!inner (
          id,
          source_path,
          summary,
          node_type
        )
      `)
      .eq("nodes.node_type", "article")
      .in("keyword", batch);

    for (const kw of keywordsWithArticles || []) {
      if (!kw.nodes) continue;
      const node = kw.nodes as { id: string; source_path: string; summary: string | null };
      articleIds.add(node.id);
      if (!articleInfo.has(node.id)) {
        articleInfo.set(node.id, {
          path: node.source_path,
          size: node.summary?.length || 0,
        });
      }
    }
  }

  if (articleIds.size === 0) {
    console.log(`[map] No articles found for hub "${hubLabel}"`);
    return NextResponse.json({
      nodes: [],
      edges: [],
      searchMeta: { query: hubLabel, synonymThreshold: 0, filteredKeywordCount: 0, premiseKeywords: communityKeywords },
    });
  }

  // Fetch all keywords for these articles (include community keywords - don't hide them)
  const communitySet = new Set(communityKeywords);
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  const addedKeywords = new Set<string>();

  // Add article nodes
  for (const [articleId, info] of articleInfo) {
    const artNodeId = `art:${articleId}`;
    const label = info.path.split("/").pop()?.replace(".md", "") || info.path;
    nodes.push({ id: artNodeId, type: "article", label, size: info.size });
  }

  // Fetch all keywords for these articles (batch the article IDs)
  const articleIdArray = [...articleIds];
  for (let i = 0; i < articleIdArray.length; i += BATCH_SIZE) {
    const batch = articleIdArray.slice(i, i + BATCH_SIZE);
    const { data: articleKeywords } = await supabase
      .from("keywords")
      .select("keyword, node_id")
      .eq("node_type", "article")
      .in("node_id", batch);

    for (const kw of articleKeywords || []) {
      const kwNodeId = `kw:${kw.keyword}`;
      const artNodeId = `art:${kw.node_id}`;

      // Add keyword node if not already added
      // Mark community keywords so they can be styled differently if desired
      if (!addedKeywords.has(kw.keyword)) {
        addedKeywords.add(kw.keyword);
        nodes.push({
          id: kwNodeId,
          type: "keyword",
          label: kw.keyword,
          // Mark as part of the filter community for potential styling
          communityId: communitySet.has(kw.keyword) ? -1 : undefined,
        });
      }

      // Add edge from article to keyword
      edges.push({ source: artNodeId, target: kwNodeId });
    }
  }

  const articleCount = articleInfo.size;
  const keywordCount = addedKeywords.size;

  console.log(
    `[map] Hub filtered map for "${hubLabel}":`,
    articleCount,
    "articles,",
    keywordCount,
    "keywords (community has",
    communityKeywords.length,
    "members)"
  );

  return NextResponse.json({
    nodes,
    edges,
    searchMeta: {
      query: hubLabel,
      synonymThreshold: 0,
      filteredKeywordCount: keywordCount,
      premiseKeywords: [], // Community keywords are shown, not hidden
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
  // Check if query is a hub keyword - if so, expand to include all community members
  const expandedKeywords = await expandHubKeyword(supabase, query);

  // For hub keywords, use exact keyword matching instead of semantic similarity
  if (expandedKeywords && expandedKeywords.length > 0) {
    console.log(`[map] Hub keyword "${query}" expanded to ${expandedKeywords.length} community members`);
    return getHubFilteredMap(supabase, query, expandedKeywords, includeNeighbors);
  }

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

  // Fetch 256-dim embeddings for neighbor computation (batch to avoid headers overflow)
  let keywordTextToEmbedding = new Map<string, number[]>();
  if (includeNeighbors) {
    const keywordIds = [...keywordTextToId.values()];
    const BATCH_SIZE = 100;

    for (let i = 0; i < keywordIds.length; i += BATCH_SIZE) {
      const batch = keywordIds.slice(i, i + BATCH_SIZE);
      const { data: keywordEmbeddings, error: embError } = await supabase
        .from("keywords")
        .select("id, keyword, embedding_256")
        .in("id", batch);

      if (embError) {
        console.error("[map] Error fetching keyword embeddings batch:", embError);
        continue;
      }

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
