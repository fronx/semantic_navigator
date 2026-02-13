"use client";

import { useState, useEffect } from "react";
import type { ChunkEmbeddingData } from "@/app/api/chunks/embeddings/route";
import { ChunksView } from "@/components/ChunksView";

export default function ChunksPage() {
  const [chunks, setChunks] = useState<ChunkEmbeddingData[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/chunks/embeddings")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: ChunkEmbeddingData[]) => setChunks(data))
      .catch((err) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-white dark:bg-zinc-900">
        <span className="text-red-500">Failed to load chunks: {error}</span>
      </div>
    );
  }

  if (!chunks) {
    return (
      <div className="h-screen flex items-center justify-center bg-white dark:bg-zinc-900">
        <span className="text-zinc-500">Loading chunks...</span>
      </div>
    );
  }

  return <ChunksView chunks={chunks} />;
}
