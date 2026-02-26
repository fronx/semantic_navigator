import type { ArticleReaderData, ArticleChunk } from "@/hooks/useArticleReader";
import { loadNodes, missingDataResponse } from "@/app/artifact/artifact-data";

let cached: { articles: ArticleReaderData[]; _meta: { articleCount: number; chunkCount: number } } | null = null;

export async function GET() {
  if (cached) return Response.json(cached);

  const nodes = await loadNodes();
  if (!nodes) return missingDataResponse();
  const { chunkNodes, articleNodes } = nodes;

  // Group chunks by source_path (order preserved from JSON — approximate article order)
  const chunksByPath = new Map<string, typeof chunkNodes>();
  for (const chunk of chunkNodes) {
    const key = chunk.source_path ?? "";
    let list = chunksByPath.get(key);
    if (!list) { list = []; chunksByPath.set(key, list); }
    list.push(chunk);
  }

  let totalChunks = 0;
  const articles: ArticleReaderData[] = articleNodes.map((article) => {
    const chunks: ArticleChunk[] = (chunksByPath.get(article.source_path ?? "") ?? []).map((c) => ({
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

  cached = { articles, _meta: { articleCount: articles.length, chunkCount: totalChunks } };
  return Response.json(cached);
}
