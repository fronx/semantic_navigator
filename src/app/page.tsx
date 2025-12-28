"use client";

import { useState } from "react";
import { VaultBrowser } from "@/components/VaultBrowser";
import { SearchBar } from "@/components/SearchBar";
import { NodeViewer } from "@/components/NodeViewer";
import { ImportProgress, ImportProgressState } from "@/components/ImportProgress";
import { MapView } from "@/components/MapView";

type Tab = "search" | "import" | "map";

const initialProgressState: ImportProgressState = {
  phase: "idle",
  completed: 0,
  total: 0,
  activeFiles: [],
};

export default function Home() {
  const [tab, setTab] = useState<Tab>("search");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgressState>(initialProgressState);

  async function handleImport(paths: string[]) {
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
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b bg-white dark:bg-zinc-900 dark:border-zinc-800">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Semantic Navigator</h1>
          <div className="flex gap-2">
            <button
              onClick={() => setTab("search")}
              className={`px-4 py-1.5 rounded-lg text-sm ${
                tab === "search"
                  ? "bg-blue-600 text-white"
                  : "bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              }`}
            >
              Search
            </button>
            <button
              onClick={() => setTab("import")}
              className={`px-4 py-1.5 rounded-lg text-sm ${
                tab === "import"
                  ? "bg-blue-600 text-white"
                  : "bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              }`}
            >
              Import
            </button>
            <button
              onClick={() => setTab("map")}
              className={`px-4 py-1.5 rounded-lg text-sm ${
                tab === "map"
                  ? "bg-blue-600 text-white"
                  : "bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              }`}
            >
              Map
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-4">

        {/* Import Progress */}
        {importProgress.phase !== "idle" && (
          <div className="mb-4">
            <ImportProgress
              progress={importProgress}
              onDismiss={() => setImportProgress(initialProgressState)}
            />
          </div>
        )}

        {/* Content */}
        {tab === "map" ? (
          <MapView />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              {tab === "search" ? (
                <SearchBar onSelectNode={setSelectedNode} />
              ) : (
                <VaultBrowser
                  onImport={handleImport}
                  disabled={importProgress.phase === "importing"}
                />
              )}
            </div>
            <div>
              <NodeViewer nodeId={selectedNode} onNavigate={setSelectedNode} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
