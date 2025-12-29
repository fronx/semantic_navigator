"use client";

import { useState } from "react";
import { VaultBrowser } from "@/components/VaultBrowser";
import { ImportProgress, ImportProgressState } from "@/components/ImportProgress";
import { MapView } from "@/components/MapView";

const initialProgressState: ImportProgressState = {
  phase: "idle",
  completed: 0,
  total: 0,
  activeFiles: [],
};

export default function Home() {
  const [searchQuery, setSearchQuery] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgressState>(initialProgressState);

  async function handleImport(paths: string[]) {
    setShowImport(false);
    setImportProgress({
      ...initialProgressState,
      phase: "importing",
    });

    try {
      const response = await fetch("/api/import/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Failed to start import");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7);
          } else if (line.startsWith("data: ") && eventType) {
            const data = JSON.parse(line.slice(6));
            handleSSEEvent(eventType, data);
            eventType = "";
          }
        }
      }
    } catch (error) {
      setImportProgress((prev) => ({
        ...prev,
        phase: "complete",
        error: error instanceof Error ? error.message : "Unknown error",
      }));
    }
  }

  function handleSSEEvent(event: string, data: Record<string, unknown>) {
    setImportProgress((prev) => {
      switch (event) {
        case "start":
          return {
            ...prev,
            total: data.totalFiles as number,
          };

        case "progress":
          return {
            ...prev,
            completed: data.completed as number,
            total: data.total as number,
            activeFiles: data.activeFiles as string[],
          };

        case "complete":
          return {
            ...prev,
            phase: "complete",
            successful: data.successful as number,
            failed: data.failed as number,
            activeFiles: [],
          };

        default:
          return prev;
      }
    });
  }

  return (
    <div className="h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="flex-shrink-0 border-b bg-white dark:bg-zinc-900 dark:border-zinc-800">
        <div className="px-3 py-1.5 flex items-center gap-3">
          <h1 className="text-sm font-medium text-zinc-600 dark:text-zinc-400 whitespace-nowrap">Semantic Navigator</h1>

          <div className="flex-1 max-w-md mx-auto">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              autoFocus
              className="w-full px-3 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-zinc-800 dark:border-zinc-700"
            />
          </div>

          <button
            onClick={() => setShowImport(true)}
            className="px-3 py-1 rounded text-xs bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700"
          >
            Import
          </button>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden">
        {/* Import Progress */}
        {importProgress.phase !== "idle" && (
          <div className="absolute top-4 left-4 right-4 z-10">
            <ImportProgress
              progress={importProgress}
              onDismiss={() => setImportProgress(initialProgressState)}
            />
          </div>
        )}

        {/* Import Modal */}
        {showImport && (
          <div className="absolute inset-0 z-20 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-auto">
              <div className="p-4 border-b dark:border-zinc-800 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Import Files</h2>
                <button
                  onClick={() => setShowImport(false)}
                  className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  Close
                </button>
              </div>
              <div className="p-4">
                <VaultBrowser
                  onImport={handleImport}
                  disabled={importProgress.phase === "importing"}
                />
              </div>
            </div>
          </div>
        )}

        {/* Map View */}
        <MapView searchQuery={searchQuery} />
      </main>
    </div>
  );
}
