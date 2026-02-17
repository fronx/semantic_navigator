import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import type { ArticleReaderData, ArticleChunk } from "@/hooks/useArticleReader";

const PAGE_SIZE = 1000;

/**
 * GET /api/reader/articles
 *
 * Returns all articles with their ordered chunks for Reader pre-caching.
 * Only text fields — no embeddings, keywords, or backlinks.
 */
export async function GET() {
  const supabase = createServerClient();

  try {
    // 1. All articles (lightweight — id, source_path, summary only)
    const articles: { id: string; source_path: string | null; summary: string | null }[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("nodes")
        .select("id, source_path, summary")
        .eq("node_type", "article")
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;
      articles.push(...data);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    if (articles.length === 0) {
      return NextResponse.json({ articles: [], _meta: { articleCount: 0, chunkCount: 0 } });
    }

    // 2. All containment edges (no .in() filter — avoids header overflow with large ID lists)
    const edges: { parent_id: string; child_id: string; position: number }[] = [];
    from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("containment_edges")
        .select("parent_id, child_id, position")
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;
      edges.push(...data);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    // 3. All chunk nodes — text fields only, no embeddings
    const chunkRows: { id: string; content: string | null; heading_context: string[] | null; chunk_type: string | null }[] = [];
    from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("nodes")
        .select("id, content, heading_context, chunk_type")
        .eq("node_type", "chunk")
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;
      chunkRows.push(...data);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    // 4. Group edges by article, sort by position
    const edgesByArticle = new Map<string, { child_id: string; position: number }[]>();
    for (const edge of edges) {
      let list = edgesByArticle.get(edge.parent_id);
      if (!list) {
        list = [];
        edgesByArticle.set(edge.parent_id, list);
      }
      list.push(edge);
    }
    for (const list of edgesByArticle.values()) {
      list.sort((a, b) => a.position - b.position);
    }

    // 5. Build chunk lookup
    const chunkById = new Map(chunkRows.map((c) => [c.id, c]));

    // 6. Assemble response
    let totalChunks = 0;
    const result: ArticleReaderData[] = articles.map((article) => {
      const orderedEdges = edgesByArticle.get(article.id) ?? [];
      const chunks: ArticleChunk[] = orderedEdges
        .map((e) => chunkById.get(e.child_id))
        .filter((c): c is NonNullable<typeof c> => c != null)
        .map((c) => ({
          id: c.id,
          content: c.content,
          heading_context: c.heading_context,
          chunk_type: c.chunk_type,
        }));
      totalChunks += chunks.length;
      return {
        articleId: article.id,
        sourcePath: article.source_path,
        articleSummary: article.summary,
        chunks,
      };
    });

    console.log(`[reader/articles] ${articles.length} articles, ${totalChunks} chunks`);

    return NextResponse.json({
      articles: result,
      _meta: { articleCount: articles.length, chunkCount: totalChunks },
    });
  } catch (error) {
    console.error("[reader/articles] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
