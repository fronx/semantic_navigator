/**
 * Prototype: Compute communities on the bipartite article-keyword graph.
 *
 * This is the same graph structure that the force layout uses, so communities
 * should align with visual clustering.
 *
 * Usage:
 *   npm run script lab/graph-layout/prototype-bipartite-communities.ts
 *   npm run script lab/graph-layout/prototype-bipartite-communities.ts --from-cache
 *
 * Outputs:
 *   data/bipartite-graph.json - The graph data (for iteration without DB)
 *   data/bipartite-communities.json - Louvain results at multiple resolutions
 */
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import { createServerClient } from "../../src/lib/supabase";
import { truncateEmbedding } from "../../src/lib/embeddings";
import * as fs from "fs";
import * as path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const GRAPH_FILE = path.join(DATA_DIR, "bipartite-graph.json");
const COMMUNITIES_FILE = path.join(DATA_DIR, "bipartite-communities.json");

// Resolution values for Louvain (same as current script)
const RESOLUTIONS = [0.1, 0.5, 1.5, 6, 10, 15, 25, 30];

interface GraphNode {
  id: string;
  type: "article" | "keyword";
  label: string;
}

interface GraphEdge {
  source: string;
  target: string;
  similarity?: number;
}

interface BipartiteGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface CommunityResult {
  level: number;
  resolution: number;
  communityCount: number;
  // Map from node ID to community ID
  assignments: Record<string, number>;
  // Stats
  articleCommunities: number; // How many communities contain articles
  keywordCommunities: number; // How many communities contain keywords
  mixedCommunities: number;   // How many contain both
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

async function fetchGraphFromDatabase(): Promise<BipartiteGraph> {
  const supabase = createServerClient();

  console.log("Fetching article-keyword graph from database...");

  // Use same RPC as the map API
  // Default density=6 matches UI default
  const maxEdges = parseInt(process.env.DENSITY || "6", 10);
  console.log(`Using density (maxEdges): ${maxEdges}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pairs, error } = await (supabase.rpc as any)("get_article_keyword_graph", {
    max_edges_per_article: maxEdges,
    min_similarity: 0.3,
  });

  if (error) {
    throw new Error(`Error fetching graph: ${error.message}`);
  }

  if (!pairs || pairs.length === 0) {
    throw new Error("No pairs found");
  }

  console.log(`Fetched ${pairs.length} similarity pairs`);

  // Collect unique articles and keywords
  const articleMap = new Map<string, { path: string; size: number }>();
  const keywordSet = new Set<string>();
  const keywordIdToText = new Map<string, string>();

  for (const pair of pairs) {
    articleMap.set(pair.article_id, { path: pair.article_path, size: pair.article_size });
    articleMap.set(pair.similar_article_id, { path: pair.similar_article_path, size: pair.similar_article_size });
    keywordSet.add(pair.keyword_text);
    keywordSet.add(pair.similar_keyword_text);
    keywordIdToText.set(pair.keyword_id, pair.keyword_text);
    keywordIdToText.set(pair.similar_keyword_id, pair.similar_keyword_text);
  }

  console.log(`Found ${articleMap.size} articles, ${keywordSet.size} keywords`);

  // Fetch embeddings for similarity computation
  const BATCH_SIZE = 100;

  // Keyword embeddings (256-dim)
  const keywordEmbeddings = new Map<string, number[]>();
  const keywordIds = [...keywordIdToText.keys()];
  for (let i = 0; i < keywordIds.length; i += BATCH_SIZE) {
    const batch = keywordIds.slice(i, i + BATCH_SIZE);
    const { data } = await supabase
      .from("keywords")
      .select("id, keyword, embedding_256")
      .in("id", batch);

    for (const kw of data || []) {
      if (kw.embedding_256) {
        const emb = typeof kw.embedding_256 === "string"
          ? JSON.parse(kw.embedding_256)
          : kw.embedding_256;
        keywordEmbeddings.set(kw.keyword, emb);
      }
    }
  }

  // Article embeddings (truncate 1536 -> 256)
  const articleEmbeddings = new Map<string, number[]>();
  const articleIds = [...articleMap.keys()];
  for (let i = 0; i < articleIds.length; i += BATCH_SIZE) {
    const batch = articleIds.slice(i, i + BATCH_SIZE);
    const { data } = await supabase
      .from("nodes")
      .select("id, embedding")
      .in("id", batch);

    for (const art of data || []) {
      if (art.embedding) {
        const fullEmb = typeof art.embedding === "string"
          ? JSON.parse(art.embedding)
          : art.embedding;
        articleEmbeddings.set(art.id, truncateEmbedding(fullEmb, 256));
      }
    }
  }

  // Build nodes
  const nodes: GraphNode[] = [];
  for (const [id, info] of articleMap) {
    const label = info.path.split("/").pop()?.replace(".md", "") || info.path;
    nodes.push({ id: `art:${id}`, type: "article", label });
  }
  for (const keyword of keywordSet) {
    nodes.push({ id: `kw:${keyword}`, type: "keyword", label: keyword });
  }

  // Build edges
  const edges: GraphEdge[] = [];
  const edgeSet = new Set<string>();

  function addEdge(source: string, target: string, similarity?: number) {
    const key = [source, target].sort().join("-");
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      edges.push({ source, target, similarity });
    }
  }

  for (const pair of pairs) {
    const art1 = `art:${pair.article_id}`;
    const art2 = `art:${pair.similar_article_id}`;
    const kw1 = `kw:${pair.keyword_text}`;
    const kw2 = `kw:${pair.similar_keyword_text}`;

    // Article-keyword edges with computed similarity
    const artEmb1 = articleEmbeddings.get(pair.article_id);
    const kwEmb1 = keywordEmbeddings.get(pair.keyword_text);
    if (artEmb1 && kwEmb1) {
      addEdge(art1, kw1, cosineSimilarity(artEmb1, kwEmb1));
    } else {
      addEdge(art1, kw1);
    }

    const artEmb2 = articleEmbeddings.get(pair.similar_article_id);
    const kwEmb2 = keywordEmbeddings.get(pair.similar_keyword_text);
    if (artEmb2 && kwEmb2) {
      addEdge(art2, kw2, cosineSimilarity(artEmb2, kwEmb2));
    } else {
      addEdge(art2, kw2);
    }

    // Keyword-keyword edge
    if (kw1 !== kw2) {
      addEdge(kw1, kw2, pair.similarity);
    }
  }

  console.log(`Built graph: ${nodes.length} nodes, ${edges.length} edges`);

  return { nodes, edges };
}

function runLouvain(graph: BipartiteGraph): CommunityResult[] {
  // Build graphology graph
  const g = new Graph({ type: "undirected" });

  for (const node of graph.nodes) {
    g.addNode(node.id, { type: node.type, label: node.label });
  }

  for (const edge of graph.edges) {
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      g.addEdge(edge.source, edge.target, {
        weight: edge.similarity ?? 0.5, // Default weight for edges without similarity
      });
    }
  }

  console.log(`\nRunning Louvain at ${RESOLUTIONS.length} resolution levels...`);
  console.log("Level | Resolution | Communities | Articles | Keywords | Mixed");
  console.log("------|------------|-------------|----------|----------|------");

  const results: CommunityResult[] = [];

  for (let level = 0; level < RESOLUTIONS.length; level++) {
    const resolution = RESOLUTIONS[level];
    const result = louvain.detailed(g, {
      resolution,
      getEdgeWeight: "weight",
    });

    // Analyze community composition
    const communityTypes = new Map<number, { articles: number; keywords: number }>();
    for (const [nodeId, communityId] of Object.entries(result.communities)) {
      if (!communityTypes.has(communityId)) {
        communityTypes.set(communityId, { articles: 0, keywords: 0 });
      }
      const stats = communityTypes.get(communityId)!;
      if (nodeId.startsWith("art:")) {
        stats.articles++;
      } else {
        stats.keywords++;
      }
    }

    let articleOnly = 0, keywordOnly = 0, mixed = 0;
    for (const stats of communityTypes.values()) {
      if (stats.articles > 0 && stats.keywords > 0) mixed++;
      else if (stats.articles > 0) articleOnly++;
      else keywordOnly++;
    }

    console.log(
      `${level.toString().padStart(5)} | ${resolution.toString().padStart(10)} | ` +
      `${result.count.toString().padStart(11)} | ${articleOnly.toString().padStart(8)} | ` +
      `${keywordOnly.toString().padStart(8)} | ${mixed.toString().padStart(5)}`
    );

    results.push({
      level,
      resolution,
      communityCount: result.count,
      assignments: result.communities,
      articleCommunities: articleOnly,
      keywordCommunities: keywordOnly,
      mixedCommunities: mixed,
    });
  }

  return results;
}

async function main() {
  const fromCache = process.argv.includes("--from-cache");

  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  let graph: BipartiteGraph;

  if (fromCache && fs.existsSync(GRAPH_FILE)) {
    console.log("Loading graph from cache...");
    graph = JSON.parse(fs.readFileSync(GRAPH_FILE, "utf-8"));
    console.log(`Loaded ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
  } else {
    graph = await fetchGraphFromDatabase();

    // Save graph for future iterations
    fs.writeFileSync(GRAPH_FILE, JSON.stringify(graph, null, 2));
    console.log(`Saved graph to ${GRAPH_FILE}`);
  }

  // Run Louvain
  const communities = runLouvain(graph);

  // Save results
  fs.writeFileSync(COMMUNITIES_FILE, JSON.stringify(communities, null, 2));
  console.log(`\nSaved communities to ${COMMUNITIES_FILE}`);

  // Show sample communities at level 3 (mid-resolution)
  const level3 = communities[3];
  console.log(`\n--- Sample communities at level 3 (resolution ${level3.resolution}) ---`);

  // Group nodes by community
  const communityMembers = new Map<number, { articles: string[]; keywords: string[] }>();
  for (const [nodeId, communityId] of Object.entries(level3.assignments)) {
    if (!communityMembers.has(communityId)) {
      communityMembers.set(communityId, { articles: [], keywords: [] });
    }
    const node = graph.nodes.find(n => n.id === nodeId);
    if (node) {
      if (node.type === "article") {
        communityMembers.get(communityId)!.articles.push(node.label);
      } else {
        communityMembers.get(communityId)!.keywords.push(node.label);
      }
    }
  }

  // Show top 5 mixed communities by size
  const sortedCommunities = [...communityMembers.entries()]
    .filter(([, m]) => m.articles.length > 0 && m.keywords.length > 0)
    .sort((a, b) => (b[1].articles.length + b[1].keywords.length) - (a[1].articles.length + a[1].keywords.length))
    .slice(0, 5);

  for (const [id, members] of sortedCommunities) {
    console.log(`\nCommunity ${id}:`);
    console.log(`  Articles (${members.articles.length}): ${members.articles.slice(0, 5).join(", ")}${members.articles.length > 5 ? "..." : ""}`);
    console.log(`  Keywords (${members.keywords.length}): ${members.keywords.slice(0, 10).join(", ")}${members.keywords.length > 10 ? "..." : ""}`);
  }
}

main().catch(console.error);
