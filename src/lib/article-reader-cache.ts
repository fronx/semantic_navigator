import type { ArticleReaderData } from "@/hooks/useArticleReader";

let byChunkId: Map<string, ArticleReaderData> | null = null;
let loadPromise: Promise<void> | null = null;

export function getArticleByChunkId(chunkId: string): ArticleReaderData | undefined {
  return byChunkId?.get(chunkId);
}

export function isLoaded(): boolean {
  return byChunkId !== null;
}

/** Eagerly load all article reader data. Idempotent — safe to call multiple times. */
export function loadAll(): Promise<void> {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const t0 = performance.now();
    try {
      const res = await fetch("/api/reader/articles");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const { articles, _meta } = await res.json() as {
        articles: ArticleReaderData[];
        _meta: { articleCount: number; chunkCount: number };
      };

      const index = new Map<string, ArticleReaderData>();
      for (const article of articles) {
        for (const chunk of article.chunks) {
          index.set(chunk.id, article);
        }
      }
      byChunkId = index;

      const ms = (performance.now() - t0).toFixed(0);
      console.log(`[article-cache] ${_meta.articleCount} articles, ${_meta.chunkCount} chunks loaded in ${ms}ms`);
    } catch (err) {
      // Allow retry on failure
      loadPromise = null;
      console.error("[article-cache] Failed to load:", err);
    }
  })();

  return loadPromise;
}
