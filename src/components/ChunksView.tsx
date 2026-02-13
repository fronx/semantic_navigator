/**
 * Orchestrator for the chunks UMAP visualization.
 * Extracts embeddings from chunk data, runs UMAP, and renders the canvas.
 */

import { useMemo } from "react";
import type { ChunkEmbeddingData } from "@/app/api/chunks/embeddings/route";
import { useUmapLayout } from "@/hooks/useUmapLayout";
import { ChunksCanvas } from "./chunks-r3f/ChunksCanvas";

interface ChunksViewProps {
  chunks: ChunkEmbeddingData[];
}

export function ChunksView({ chunks }: ChunksViewProps) {
  const embeddings = useMemo(
    () => chunks.map((c) => c.embedding),
    [chunks]
  );

  const { positions, progress, isRunning } = useUmapLayout(embeddings);

  const progressPercent = Math.round(progress * 100);

  return (
    <div className="flex flex-col h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Header bar */}
      <header className="flex-shrink-0 px-3 py-1.5 flex items-center gap-4 border-b bg-white dark:bg-zinc-900 dark:border-zinc-800">
        <span className="text-sm text-zinc-600 dark:text-zinc-400">
          {chunks.length} chunks
        </span>
        {isRunning && (
          <div className="flex items-center gap-2 flex-1 max-w-xs">
            <div className="flex-1 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-500 transition-[width] duration-100 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-xs text-zinc-400">
              UMAP {progressPercent}%
            </span>
          </div>
        )}
      </header>

      {/* Canvas area */}
      <main className="flex-1 relative overflow-hidden">
        <ChunksCanvas chunks={chunks} positions={positions} isRunning={isRunning} />
      </main>
    </div>
  );
}
