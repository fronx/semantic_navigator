import { useRef, useEffect } from "react";
import { useArticleReader } from "@/hooks/useArticleReader";

interface ReaderProps {
  chunkId: string | null;
  onClose: () => void;
}

function articleTitle(sourcePath: string | null): string {
  if (!sourcePath) return "Article";
  return sourcePath.split("/").at(-1)?.replace(/\.md$/i, "") ?? "Article";
}

export function Reader({ chunkId, onClose }: ReaderProps) {
  const { data, loading } = useArticleReader(chunkId);
  const chunkRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (!chunkId || !data) return;
    const el = chunkRefs.current.get(chunkId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [chunkId, data]);

  const isOpen = chunkId !== null;

  return (
    <div
      className={`absolute top-0 right-0 bottom-0 z-20 flex flex-col bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-700 overflow-hidden transition-[width] duration-200 ${isOpen ? "w-80" : "w-0"}`}
    >
      {/* Header */}
      <div className="flex-shrink-0 flex items-start gap-2 px-3 py-2 border-b border-zinc-200 dark:border-zinc-700">
        <button
          onClick={onClose}
          className="mt-0.5 flex-shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-lg leading-none"
          aria-label="Close reader"
        >
          ×
        </button>
        <div className="min-w-0">
          <div className="text-sm font-medium text-zinc-800 dark:text-zinc-100 truncate">
            {data ? articleTitle(data.sourcePath) : "—"}
          </div>
          {data?.articleSummary && (
            <div className="text-xs text-zinc-400 dark:text-zinc-500 line-clamp-2 mt-0.5">
              {data.articleSummary}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading && !data && (
          <div className="p-3 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse space-y-1.5">
                <div className="h-2 bg-zinc-200 dark:bg-zinc-700 rounded w-1/3" />
                <div className="h-2 bg-zinc-200 dark:bg-zinc-700 rounded w-full" />
                <div className="h-2 bg-zinc-200 dark:bg-zinc-700 rounded w-5/6" />
              </div>
            ))}
          </div>
        )}

        {data?.chunks.map((chunk) => {
          const isActive = chunk.id === chunkId;
          return (
            <div
              key={chunk.id}
              ref={(el) => {
                if (el) chunkRefs.current.set(chunk.id, el);
                else chunkRefs.current.delete(chunk.id);
              }}
              className={`px-3 py-2.5 border-b border-zinc-100 dark:border-zinc-800 ${
                isActive
                  ? "bg-blue-50 dark:bg-blue-950/30 border-l-2 border-l-blue-500"
                  : ""
              }`}
            >
              {chunk.heading_context && chunk.heading_context.length > 0 && (
                <div className="text-xs text-zinc-400 dark:text-zinc-500 mb-1">
                  {chunk.heading_context.join(" › ")}
                </div>
              )}
              {chunk.chunk_type && (
                <span className="inline-block text-xs px-1 py-0.5 mb-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 rounded">
                  {chunk.chunk_type}
                </span>
              )}
              <div className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">
                {chunk.content ?? ""}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
