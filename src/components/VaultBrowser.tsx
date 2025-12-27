"use client";

import { useState, useEffect } from "react";
import { VaultEntry } from "@/lib/types";

interface Props {
  onImport: (paths: string[]) => void;
  disabled?: boolean;
}

export function VaultBrowser({ onImport, disabled }: Props) {
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [estimate, setEstimate] = useState<{
    files: number;
    tokens: number;
    estimatedCost: number;
  } | null>(null);

  useEffect(() => {
    fetchEntries(currentPath);
  }, [currentPath]);

  useEffect(() => {
    if (selected.size > 0) {
      fetchEstimate();
    } else {
      setEstimate(null);
    }
  }, [selected]);

  async function fetchEntries(path: string) {
    setLoading(true);
    const res = await fetch(`/api/vault?path=${encodeURIComponent(path)}`);
    const data = await res.json();
    setEntries(data.entries);
    setLoading(false);
  }

  async function fetchEstimate() {
    const res = await fetch("/api/vault", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths: Array.from(selected) }),
    });
    const data = await res.json();
    setEstimate(data);
  }

  function toggleSelect(path: string) {
    const next = new Set(selected);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    setSelected(next);
  }

  function navigateUp() {
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    setCurrentPath(parts.join("/"));
  }

  return (
    <div className="border rounded-lg p-4 bg-white dark:bg-zinc-900">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-lg font-semibold">Vault Browser</h2>
        {currentPath && (
          <button
            onClick={navigateUp}
            className="text-sm text-blue-600 hover:underline"
          >
            Up
          </button>
        )}
      </div>

      <div className="text-sm text-zinc-500 mb-2">
        /{currentPath || "(root)"}
      </div>

      {loading ? (
        <div className="text-zinc-500">Loading...</div>
      ) : (
        <div className="space-y-1">
          {entries.map((entry) => (
            <div
              key={entry.path}
              className="flex items-center gap-2 p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <input
                type="checkbox"
                checked={selected.has(entry.path)}
                onChange={() => toggleSelect(entry.path)}
                className="w-4 h-4"
              />
              {entry.type === "directory" ? (
                <button
                  onClick={() => setCurrentPath(entry.path)}
                  className="text-blue-600 hover:underline"
                >
                  {entry.name}/
                </button>
              ) : (
                <span>{entry.name}</span>
              )}
              {entry.estimatedTokens && (
                <span className="text-xs text-zinc-400 ml-auto">
                  ~{entry.estimatedTokens.toLocaleString()} tokens
                </span>
              )}
            </div>
          ))}
          {entries.length === 0 && (
            <div className="text-zinc-500">No markdown files found</div>
          )}
        </div>
      )}

      {selected.size > 0 && (
        <div className="mt-4 pt-4 border-t">
          <div className="text-sm mb-2">
            {selected.size} item(s) selected
            {estimate && (
              <span className="text-zinc-500">
                {" "}
                - {estimate.files} files, ~{estimate.tokens.toLocaleString()}{" "}
                tokens, ~${estimate.estimatedCost.toFixed(3)} est. cost
              </span>
            )}
          </div>
          <button
            onClick={() => onImport(Array.from(selected))}
            disabled={disabled}
            className={`px-4 py-2 rounded text-white ${
              disabled
                ? "bg-zinc-400 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {disabled ? "Importing..." : "Import Selected"}
          </button>
        </div>
      )}
    </div>
  );
}
