import { useRef, useEffect, useState } from "react";
import { useArticleReader, type ArticleReaderData } from "@/hooks/useArticleReader";
import { getChunkColor } from "@/lib/chunk-color-registry";
import ReactMarkdown from "react-markdown";

const READER_WIDTH_KEY = "reader-width";
const DEFAULT_WIDTH = 384; // w-96
const MIN_WIDTH = 260;
const MAX_WIDTH = 720;

interface ReaderProps {
  chunkId: string | null;
  onClose: () => void;
}

interface HistoryEntry {
  articleId: string;
  sourcePath: string | null;
  chunkId: string;
  data: ArticleReaderData;
}

function articleTitle(sourcePath: string | null): string {
  if (!sourcePath) return "Article";
  return sourcePath.split("/").at(-1)?.replace(/\.md$/i, "") ?? "Article";
}


export function Reader({ chunkId, onClose }: ReaderProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [activeArticleId, setActiveArticleId] = useState<string | null>(null);
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem(READER_WIDTH_KEY);
    return saved ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parseInt(saved))) : DEFAULT_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);
  const widthRef = useRef(width);
  widthRef.current = width;

  // Hook only fetches when the external chunkId changes (canvas clicks)
  const { data, loading } = useArticleReader(chunkId);
  const chunkRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // When hook data arrives, cache it in history
  useEffect(() => {
    if (!data || !chunkId) return;
    if (!data.chunks.some((c) => c.id === chunkId)) return;

    setHistory((prev) => {
      const idx = prev.findIndex((e) => e.articleId === data.articleId);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], chunkId, data };
        return updated;
      }
      return [
        { articleId: data.articleId, sourcePath: data.sourcePath, chunkId, data },
        ...prev,
      ].slice(0, 5);
    });
    setActiveArticleId(data.articleId);
  }, [data, chunkId]);

  // Display state derived from cached history — instant on tab switch
  const activeEntry = history.find((e) => e.articleId === activeArticleId);
  const displayData = activeEntry?.data ?? null;
  const displayChunkId = activeEntry?.chunkId ?? chunkId;

  // Scroll to active chunk
  useEffect(() => {
    if (!displayChunkId || !displayData) return;
    const el = chunkRefs.current.get(displayChunkId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [displayChunkId, displayData]);

  const handleTabClick = (entry: HistoryEntry) => {
    if (entry.articleId === activeArticleId) return;
    setActiveArticleId(entry.articleId);
  };

  const handleTabClose = (articleId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const filtered = history.filter((h) => h.articleId !== articleId);
    if (filtered.length === 0) {
      setHistory([]);
      onClose();
      return;
    }
    setHistory(filtered);
    if (articleId === activeArticleId) {
      setActiveArticleId(filtered[0].articleId);
    }
  };

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;
    setIsResizing(true);

    const onMouseMove = (e: MouseEvent) => {
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + startX - e.clientX));
      setWidth(newWidth);
    };

    const onMouseUp = () => {
      setIsResizing(false);
      localStorage.setItem(READER_WIDTH_KEY, String(widthRef.current));
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const isOpen = chunkId !== null;

  return (
    <div
      className={`flex-shrink-0 relative flex flex-col bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-700 overflow-hidden ${isResizing ? "" : "transition-[width] duration-200"}`}
      style={{ width: isOpen ? width : 0 }}
    >
      {/* Resize handle */}
      {isOpen && (
        <div
          className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
          onMouseDown={handleResizeStart}
        />
      )}

      {/* Tab stack */}
      <div className="flex-shrink-0 border-b border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center px-3 py-1">
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-lg leading-none"
            aria-label="Close reader"
          >
            ×
          </button>
        </div>
        {history.map((entry) => {
          const isActive = entry.articleId === activeArticleId;
          return (
            <button
              key={entry.articleId}
              onClick={() => handleTabClick(entry)}
              className={`group w-full flex items-center gap-2 px-3 py-1.5 text-left cursor-pointer transition-opacity ${
                isActive ? "opacity-100" : "opacity-50 hover:opacity-100"
              }`}
            >
              <div
                className="w-1 self-stretch rounded-full flex-shrink-0"
                style={{ backgroundColor: getChunkColor(entry.chunkId) ?? "#9ca3af" }}
              />
              <div className="min-w-0 flex-1">
                <div
                  className={`text-sm truncate ${
                    isActive
                      ? "font-medium text-zinc-800 dark:text-zinc-100"
                      : "text-zinc-600 dark:text-zinc-400"
                  }`}
                >
                  {articleTitle(entry.sourcePath)}
                </div>
                {isActive && displayData?.articleSummary && (
                  <div className="text-xs text-zinc-400 dark:text-zinc-500 line-clamp-2 mt-0.5">
                    {displayData.articleSummary}
                  </div>
                )}
              </div>
              <span
                onClick={(e) => handleTabClose(entry.articleId, e)}
                className="flex-shrink-0 text-zinc-300 hover:text-zinc-500 dark:text-zinc-600 dark:hover:text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity text-xs leading-none cursor-pointer"
                role="button"
                aria-label="Close tab"
              >
                ×
              </span>
            </button>
          );
        })}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading && !displayData && (
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

        {displayData?.chunks.map((chunk) => {
          const isActiveChunk = chunk.id === displayChunkId;
          return (
            <div
              key={chunk.id}
              ref={(el) => {
                if (el) chunkRefs.current.set(chunk.id, el);
                else chunkRefs.current.delete(chunk.id);
              }}
              className={`pl-10 pr-6 py-6 ${isActiveChunk ? "border-l-[5px]" : ""}`}
              style={isActiveChunk ? { borderLeftColor: getChunkColor(chunk.id) ?? "#9ca3af" } : undefined}
            >
              <div className="reader-markdown">
                <ReactMarkdown>
                  {chunk.content ?? ""}
                </ReactMarkdown>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
