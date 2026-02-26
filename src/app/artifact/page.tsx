"use client";

import { useEffect } from "react";
import type { ChunkEmbeddingData } from "@/app/api/chunks/embeddings/route";
import { ChunksView } from "@/components/ChunksView";
import { useOfflineCache } from "@/hooks/useOfflineCache";
import { setApiBase } from "@/lib/article-reader-cache";
import { setGlobalContrast } from "@/lib/rendering-utils/node-renderer";
import { isDarkMode, watchThemeChanges } from "@/lib/theme";

// Configure article reader cache to use artifact-specific endpoints
// before any component mounts and triggers loadAll().
setApiBase("/artifact");

const API_BASE = "/artifact";

export default function ArtifactPage() {
  if (typeof window !== "undefined") {
    setGlobalContrast(0, isDarkMode());
  }
  useEffect(() => {
    return watchThemeChanges((d) => setGlobalContrast(0, d));
  }, []);

  const { data: chunks, loading, error } = useOfflineCache<ChunkEmbeddingData[]>({
    fetcher: async () => {
      const res = await fetch(`${API_BASE}/api/chunks/embeddings`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-white dark:bg-zinc-900">
        <span className="text-red-500">Failed to load: {error}</span>
      </div>
    );
  }

  if (loading || !chunks) {
    return (
      <div className="h-screen flex items-center justify-center bg-white dark:bg-zinc-900">
        <span className="text-zinc-500">Loading...</span>
      </div>
    );
  }

  return <ChunksView chunks={chunks} apiBase={API_BASE} hideSearch />;
}
