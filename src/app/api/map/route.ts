import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export interface MapNode {
  id: string;
  type: "keyword" | "article";
  label: string;
}

export interface MapEdge {
  source: string;
  target: string;
}

export interface MapData {
  nodes: MapNode[];
  edges: MapEdge[];
}

export async function GET() {
  const supabase = createServerClient();

  // Get keyword → article relationships by walking up containment tree
  const { data: relationships, error: relError } = await supabase.rpc(
    "get_keyword_article_relationships"
  );

  if (relError) {
    // If the function doesn't exist yet, fall back to a direct query approach
    console.log("[map] RPC not found, using direct query");
    return await getMapDataDirect(supabase);
  }

  return buildMapResponse(relationships);
}

async function getMapDataDirect(
  supabase: ReturnType<typeof createServerClient>
) {
  // Get all keywords with their node_ids
  const { data: keywords, error: kwError } = await supabase
    .from("keywords")
    .select("keyword, node_id");

  if (kwError) {
    return NextResponse.json({ error: kwError.message }, { status: 500 });
  }

  if (!keywords || keywords.length === 0) {
    return NextResponse.json({ nodes: [], edges: [] });
  }

  // Get all paragraph → article mappings by traversing containment_edges
  // We need to recursively walk up from each paragraph to find its article
  const paragraphIds = [...new Set(keywords.map((k) => k.node_id))];

  // Get the ancestor chain for each paragraph
  const { data: ancestorData, error: ancestorError } = await supabase
    .from("containment_edges")
    .select(
      `
      child_id,
      parent:nodes!containment_edges_parent_id_fkey(id, node_type, source_path)
    `
    )
    .in("child_id", paragraphIds);

  if (ancestorError) {
    return NextResponse.json({ error: ancestorError.message }, { status: 500 });
  }

  // Build paragraph → article mapping by walking up the tree
  // This is a simplified approach - for deep hierarchies we'd need recursion
  const paragraphToArticle = new Map<
    string,
    { id: string; source_path: string }
  >();

  // First pass: direct parents that are articles
  type ParentNode = { id: string; node_type: string; source_path: string };
  const needsParent = new Set<string>();
  for (const edge of ancestorData || []) {
    // Supabase returns single object for FK joins, but TS may infer array
    const parent = edge.parent as unknown as ParentNode | null;
    if (parent?.node_type === "article") {
      paragraphToArticle.set(edge.child_id, {
        id: parent.id,
        source_path: parent.source_path,
      });
    } else if (parent) {
      needsParent.add(parent.id);
    }
  }

  // Second pass: get parents of sections
  if (needsParent.size > 0) {
    const { data: sectionParents } = await supabase
      .from("containment_edges")
      .select(
        `
        child_id,
        parent:nodes!containment_edges_parent_id_fkey(id, node_type, source_path)
      `
      )
      .in("child_id", [...needsParent]);

    const sectionToArticle = new Map<
      string,
      { id: string; source_path: string }
    >();
    for (const edge of sectionParents || []) {
      const parent = edge.parent as unknown as ParentNode | null;
      if (parent?.node_type === "article") {
        sectionToArticle.set(edge.child_id, {
          id: parent.id,
          source_path: parent.source_path,
        });
      }
    }

    // Map paragraphs through their section parents
    for (const edge of ancestorData || []) {
      const parent = edge.parent as unknown as ParentNode | null;
      if (parent && !paragraphToArticle.has(edge.child_id)) {
        const article = sectionToArticle.get(parent.id);
        if (article) {
          paragraphToArticle.set(edge.child_id, article);
        }
      }
    }
  }

  // Build keyword → articles mapping to count articles per keyword
  const keywordToArticles = new Map<string, Set<string>>();

  for (const kw of keywords) {
    const article = paragraphToArticle.get(kw.node_id);
    if (article) {
      if (!keywordToArticles.has(kw.keyword)) {
        keywordToArticles.set(kw.keyword, new Set());
      }
      keywordToArticles.get(kw.keyword)!.add(article.id);
    }
  }

  // Filter to keywords used by at least 2 articles
  const multiArticleKeywords = new Set<string>();
  for (const [keyword, articles] of keywordToArticles) {
    if (articles.size >= 2) {
      multiArticleKeywords.add(keyword);
    }
  }

  // Build the graph with filtered keywords
  const keywordNodes = new Map<string, MapNode>();
  const articleNodes = new Map<string, MapNode>();
  const edges: MapEdge[] = [];
  const edgeSet = new Set<string>();

  for (const kw of keywords) {
    if (!multiArticleKeywords.has(kw.keyword)) continue;

    const article = paragraphToArticle.get(kw.node_id);
    if (!article) continue;

    const keywordId = `kw:${kw.keyword}`;
    if (!keywordNodes.has(keywordId)) {
      keywordNodes.set(keywordId, {
        id: keywordId,
        type: "keyword",
        label: kw.keyword,
      });
    }

    const articleId = `art:${article.id}`;
    if (!articleNodes.has(articleId)) {
      const label = article.source_path.split("/").pop()?.replace(".md", "") || article.source_path;
      articleNodes.set(articleId, {
        id: articleId,
        type: "article",
        label,
      });
    }

    const edgeKey = `${articleId}-${keywordId}`;
    if (!edgeSet.has(edgeKey)) {
      edgeSet.add(edgeKey);
      edges.push({ source: articleId, target: keywordId });
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
    "edges"
  );

  return NextResponse.json({ nodes, edges });
}

function buildMapResponse(
  relationships: { keyword: string; article_id: string; source_path: string }[]
) {
  // Count articles per keyword
  const keywordToArticles = new Map<string, Set<string>>();
  for (const rel of relationships) {
    if (!keywordToArticles.has(rel.keyword)) {
      keywordToArticles.set(rel.keyword, new Set());
    }
    keywordToArticles.get(rel.keyword)!.add(rel.article_id);
  }

  // Filter to keywords used by at least 2 articles
  const multiArticleKeywords = new Set<string>();
  for (const [keyword, articles] of keywordToArticles) {
    if (articles.size >= 2) {
      multiArticleKeywords.add(keyword);
    }
  }

  const keywordNodes = new Map<string, MapNode>();
  const articleNodes = new Map<string, MapNode>();
  const edges: MapEdge[] = [];
  const edgeSet = new Set<string>();

  for (const rel of relationships) {
    if (!multiArticleKeywords.has(rel.keyword)) continue;

    const keywordId = `kw:${rel.keyword}`;
    if (!keywordNodes.has(keywordId)) {
      keywordNodes.set(keywordId, {
        id: keywordId,
        type: "keyword",
        label: rel.keyword,
      });
    }

    const articleId = `art:${rel.article_id}`;
    if (!articleNodes.has(articleId)) {
      const label = rel.source_path.split("/").pop()?.replace(".md", "") || rel.source_path;
      articleNodes.set(articleId, {
        id: articleId,
        type: "article",
        label,
      });
    }

    const edgeKey = `${articleId}-${keywordId}`;
    if (!edgeSet.has(edgeKey)) {
      edgeSet.add(edgeKey);
      edges.push({ source: articleId, target: keywordId });
    }
  }

  const nodes = [...articleNodes.values(), ...keywordNodes.values()];

  return NextResponse.json({ nodes, edges });
}
