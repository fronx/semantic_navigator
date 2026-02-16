/**
 * Button to download cached data for offline use.
 * Provides feedback on cache status and allows manual export.
 */

import { useState, useCallback } from "react";

interface OfflineCacheButtonProps {
  /** Cache key to check */
  cacheKey: string;
  /** Display label for the button */
  label?: string;
  /** Whether cache is currently stale (using offline data) */
  isStale?: boolean;
}

export function OfflineCacheButton({
  cacheKey,
  label = "Cache Data",
  isStale = false,
}: OfflineCacheButtonProps) {
  const [status, setStatus] = useState<"idle" | "checking" | "success" | "no-cache">("idle");

  const handleDownloadCache = useCallback(() => {
    setStatus("checking");

    const cached = localStorage.getItem(cacheKey);
    if (!cached) {
      setStatus("no-cache");
      setTimeout(() => setStatus("idle"), 2000);
      return;
    }

    try {
      // Create download link
      const blob = new Blob([cached], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${cacheKey}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      setStatus("success");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (err) {
      console.error("Failed to download cache:", err);
      setStatus("idle");
    }
  }, [cacheKey]);

  const getCacheSizeKB = useCallback(() => {
    const cached = localStorage.getItem(cacheKey);
    if (!cached) return 0;
    return Math.round(new Blob([cached]).size / 1024);
  }, [cacheKey]);

  const cacheSize = getCacheSizeKB();

  return (
    <button
      onClick={handleDownloadCache}
      disabled={status === "checking"}
      className="px-2 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
      title={
        isStale
          ? "Download cached data (currently offline)"
          : cacheSize > 0
          ? `Download cached data (${cacheSize} KB)`
          : "No cache available"
      }
    >
      {status === "checking" && "Downloading..."}
      {status === "success" && "Downloaded"}
      {status === "no-cache" && "No cache"}
      {status === "idle" && (
        <>
          {label}
          {cacheSize > 0 && ` (${cacheSize} KB)`}
          {isStale && " ✓"}
        </>
      )}
    </button>
  );
}
