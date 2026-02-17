import { useState, useEffect } from "react";
import { getArticleByChunkId, loadAll } from "@/lib/article-reader-cache";

export interface ArticleChunk {
  id: string;
  content: string | null;
  heading_context: string[] | null;
  chunk_type: string | null;
}

export interface ArticleReaderData {
  articleId: string;
  sourcePath: string | null;
  articleSummary: string | null;
  chunks: ArticleChunk[];
}

export function useArticleReader(chunkId: string | null): {
  data: ArticleReaderData | null;
  loading: boolean;
} {
  const [data, setData] = useState<ArticleReaderData | null>(null);
  const [loading, setLoading] = useState(false);

  // Start background loading on mount (idempotent)
  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    if (!chunkId) return;

    // Cache hit — return instantly
    const cached = getArticleByChunkId(chunkId);
    if (cached) {
      setData(cached);
      setLoading(false);
      return;
    }

    // Fallback: fetch on demand (cache not ready yet)
    let cancelled = false;
    setLoading(true);

    async function load() {
      const chunkRes = await fetch(`/api/nodes/${chunkId}?similarK=0`);
      if (cancelled) return;
      if (!chunkRes.ok) {
        setLoading(false);
        return;
      }
      const chunkJson = await chunkRes.json();
      if (cancelled) return;

      const parent = chunkJson.parent;
      if (!parent) {
        setLoading(false);
        return;
      }

      const articleRes = await fetch(`/api/nodes/${parent.id}?similarK=0`);
      if (cancelled) return;
      if (!articleRes.ok) {
        setLoading(false);
        return;
      }
      const articleJson = await articleRes.json();
      if (cancelled) return;

      const chunks: ArticleChunk[] = (articleJson.children ?? []).map(
        (c: { id: string; content: string | null; heading_context: string[] | null; chunk_type: string | null }) => ({
          id: c.id,
          content: c.content,
          heading_context: c.heading_context,
          chunk_type: c.chunk_type,
        })
      );

      setData({
        articleId: parent.id,
        sourcePath: articleJson.node?.source_path ?? parent.source_path ?? null,
        articleSummary: articleJson.node?.summary ?? parent.summary ?? null,
        chunks,
      });
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [chunkId]);

  return { data, loading };
}
