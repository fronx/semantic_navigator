"use client";

import { useState } from "react";
import { VaultBrowser } from "@/components/VaultBrowser";
import { SearchBar } from "@/components/SearchBar";
import { NodeViewer } from "@/components/NodeViewer";

type Tab = "search" | "import";

export default function Home() {
  const [tab, setTab] = useState<Tab>("search");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<{
    loading: boolean;
    message: string;
  } | null>(null);

  async function handleImport(paths: string[]) {
    setImportStatus({ loading: true, message: "Importing..." });

    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths }),
    });

    const data = await res.json();
    setImportStatus({
      loading: false,
      message: `Imported ${data.successful}/${data.total} files`,
    });

    setTimeout(() => setImportStatus(null), 5000);
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b bg-white dark:bg-zinc-900 dark:border-zinc-800">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <h1 className="text-xl font-semibold">Semantic Navigator</h1>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Tab Navigation */}
        <div className="flex gap-4 mb-6">
          <button
            onClick={() => setTab("search")}
            className={`px-4 py-2 rounded-lg ${
              tab === "search"
                ? "bg-blue-600 text-white"
                : "bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700"
            }`}
          >
            Search
          </button>
          <button
            onClick={() => setTab("import")}
            className={`px-4 py-2 rounded-lg ${
              tab === "import"
                ? "bg-blue-600 text-white"
                : "bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700"
            }`}
          >
            Import
          </button>
        </div>

        {/* Import Status */}
        {importStatus && (
          <div
            className={`mb-4 p-3 rounded-lg ${
              importStatus.loading
                ? "bg-blue-100 dark:bg-blue-900/30"
                : "bg-green-100 dark:bg-green-900/30"
            }`}
          >
            {importStatus.message}
          </div>
        )}

        {/* Content */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            {tab === "search" ? (
              <SearchBar onSelectNode={setSelectedNode} />
            ) : (
              <VaultBrowser onImport={handleImport} />
            )}
          </div>
          <div>
            <NodeViewer nodeId={selectedNode} onNavigate={setSelectedNode} />
          </div>
        </div>
      </main>
    </div>
  );
}
