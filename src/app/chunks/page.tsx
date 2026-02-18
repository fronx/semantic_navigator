"use client";

import { useEffect } from "react";
import type { ChunkEmbeddingData } from "@/app/api/chunks/embeddings/route";
import { ChunksView } from "@/components/ChunksView";
import { useOfflineCache } from "@/hooks/useOfflineCache";
import { setGlobalContrast } from "@/lib/rendering-utils/node-renderer";
import { isDarkMode, watchThemeChanges } from "@/lib/theme";

export default function ChunksPage() {
  // Sync dark mode to module-level state so ClusterLabels3D desaturates toward white, not black
  if (typeof window !== "undefined") {
    setGlobalContrast(0, isDarkMode());
  }
  useEffect(() => {
    return watchThemeChanges((d) => setGlobalContrast(0, d));
  }, []);
  const { data: chunks, loading, error, isStale } = useOfflineCache<ChunkEmbeddingData[]>({
    fetcher: async () => {
      const res = await fetch("/api/chunks/embeddings");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-white dark:bg-zinc-900">
        <span className="text-red-500">Failed to load chunks: {error}</span>
      </div>
    );
  }

  if (loading || !chunks) {
    return (
      <div className="h-screen flex items-center justify-center bg-white dark:bg-zinc-900">
        <span className="text-zinc-500">Loading chunks...</span>
      </div>
    );
  }

  return <ChunksView chunks={chunks} isStale={isStale} />;
}
