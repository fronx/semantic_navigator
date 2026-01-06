"use client";

import { useEffect, useState } from "react";
import { TopicsView } from "@/components/TopicsView";
import type { KeywordNode, SimilarityEdge } from "@/lib/graph-queries";

interface TopicsData {
  nodes: KeywordNode[];
  edges: SimilarityEdge[];
}

// Convert linear slider (0-100) to logarithmic scale (0.01 to 10)
function sliderToStrength(value: number): number {
  if (value === 0) return 0;
  return Math.pow(10, (value - 50) / 50);
}

function strengthToSlider(strength: number): number {
  if (strength === 0) return 0;
  return Math.log10(strength) * 50 + 50;
}

export default function TopicsPage() {
  const [data, setData] = useState<TopicsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Layout controls
  const [knnStrength, setKnnStrength] = useState(4.0);
  const [contrast, setContrast] = useState(5.0);
  const [clusterResolution, setClusterResolution] = useState(1.5);

  // Hover highlighting controls
  const [hoverSimilarity, setHoverSimilarity] = useState(0.7);
  const [baseDim, setBaseDim] = useState(0.7);

  // Fetch data
  useEffect(() => {
    setLoading(true);
    fetch("/api/topics")
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          setData(null);
        } else {
          setData(data);
          setError(null);
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-white dark:bg-zinc-900">
        <span className="text-zinc-500">Loading topics...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-white dark:bg-zinc-900">
        <span className="text-red-500">Error: {error}</span>
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className="h-screen flex items-center justify-center bg-white dark:bg-zinc-900">
        <span className="text-zinc-500">No topics found. Import some articles first.</span>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="flex-shrink-0 border-b bg-white dark:bg-zinc-900 dark:border-zinc-800">
        <div className="px-3 py-1.5 flex items-center gap-3">
          <h1 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            Topics ({data.nodes.length} keywords, {data.edges.length} edges)
          </h1>

          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <label className="flex items-center gap-1">
              <span>Clusters:</span>
              <input
                type="range"
                min="0.1"
                max="10"
                step="0.1"
                value={clusterResolution}
                onChange={(e) => setClusterResolution(parseFloat(e.target.value))}
                className="w-20 h-3"
              />
              <span className="w-8 tabular-nums">{clusterResolution.toFixed(1)}</span>
            </label>

            <label className="flex items-center gap-1">
              <span>Contrast:</span>
              <input
                type="range"
                min="1"
                max="5"
                step="0.1"
                value={contrast}
                onChange={(e) => setContrast(parseFloat(e.target.value))}
                className="w-20 h-3"
              />
              <span className="w-8 tabular-nums">{contrast.toFixed(1)}</span>
            </label>

            <label className="flex items-center gap-1">
              <span>k-NN:</span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={strengthToSlider(knnStrength)}
                onChange={(e) => setKnnStrength(sliderToStrength(parseFloat(e.target.value)))}
                className="w-20 h-3"
              />
              <span className="w-12 tabular-nums">{knnStrength.toFixed(2)}</span>
            </label>

            <span className="text-zinc-300 dark:text-zinc-600">|</span>

            <label className="flex items-center gap-1">
              <span>Hover sim:</span>
              <input
                type="range"
                min="0.3"
                max="0.95"
                step="0.05"
                value={hoverSimilarity}
                onChange={(e) => setHoverSimilarity(parseFloat(e.target.value))}
                className="w-20 h-3"
              />
              <span className="w-8 tabular-nums">{hoverSimilarity.toFixed(2)}</span>
            </label>

            <label className="flex items-center gap-1">
              <span>Base dim:</span>
              <input
                type="range"
                min="0"
                max="0.5"
                step="0.05"
                value={baseDim}
                onChange={(e) => setBaseDim(parseFloat(e.target.value))}
                className="w-20 h-3"
              />
              <span className="w-8 tabular-nums">{(baseDim * 100).toFixed(0)}%</span>
            </label>
          </div>

          <a
            href="/"
            className="text-xs text-blue-500 hover:text-blue-600 ml-auto"
          >
            Back to Map
          </a>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden bg-white dark:bg-zinc-900">
        <TopicsView
          nodes={data.nodes}
          edges={data.edges}
          knnStrength={knnStrength}
          contrast={contrast}
          clusterResolution={clusterResolution}
          hoverConfig={{
            similarityThreshold: hoverSimilarity,
            baseDim,
          }}
          onKeywordClick={(keyword) => {
            console.log("Clicked keyword:", keyword);
          }}
        />
      </main>
    </div>
  );
}
