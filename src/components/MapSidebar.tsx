"use client";

import type { LayoutMode } from "@/lib/map-layout";

interface Props {
  open: boolean;
  onToggle: () => void;

  // Legend counts
  articleCount: number;
  chunkCount: number;
  keywordCount: number;

  // Filter context
  filterKeywords?: string[];
  onClearFilter?: () => void;

  // Data settings
  level: number;
  onLevelChange: (value: number) => void;
  onLevelCommit: () => void;
  density: number;
  onDensityChange: (value: number) => void;
  onDensityCommit: () => void;
  clustered: boolean;
  onClusteredChange: (value: boolean) => void;
  showNeighbors: boolean;
  onShowNeighborsChange: (value: boolean) => void;

  // Layout settings
  layoutMode: LayoutMode;
  onLayoutModeChange: (value: LayoutMode) => void;
  umapProgress: number | null;
  fitMode: boolean;
  onFitModeChange: (value: boolean) => void;

  // Visual settings
  dotSize: number;
  dotSlider: number;
  onDotSizeChange: (value: number) => void;
  edgeOpacity: number;
  onEdgeOpacityChange: (value: number) => void;
  hullOpacity: number;
  onHullOpacityChange: (value: number) => void;
}

export function MapSidebar({
  open,
  onToggle,
  articleCount,
  chunkCount,
  keywordCount,
  filterKeywords,
  onClearFilter,
  level,
  onLevelChange,
  onLevelCommit,
  density,
  onDensityChange,
  onDensityCommit,
  clustered,
  onClusteredChange,
  showNeighbors,
  onShowNeighborsChange,
  layoutMode,
  onLayoutModeChange,
  umapProgress,
  fitMode,
  onFitModeChange,
  dotSize,
  dotSlider,
  onDotSizeChange,
  edgeOpacity,
  onEdgeOpacityChange,
  hullOpacity,
  onHullOpacityChange,
}: Props) {
  return (
    <>
      {/* Sidebar */}
      <div
        className={`shrink-0 border-r dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 transition-all duration-200 ${
          open ? "w-56" : "w-0"
        } overflow-hidden`}
      >
        <div className="w-56 p-3 flex flex-col gap-4 h-full overflow-y-auto text-xs">
          {/* Legend */}
          <div className="space-y-1.5">
            <h3 className="font-medium text-zinc-700 dark:text-zinc-300 uppercase tracking-wide text-[10px]">Legend</h3>
            <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              <span>Articles ({articleCount})</span>
            </div>
            {chunkCount > 0 && (
              <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
                <span className="w-2.5 h-2.5 rounded-full bg-violet-500" />
                <span>Chunks ({chunkCount})</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <span>Keywords ({keywordCount})</span>
            </div>
          </div>

          {/* Filter context */}
          {filterKeywords && filterKeywords.length > 0 && (
            <div className="space-y-1.5">
              <h3 className="font-medium text-zinc-700 dark:text-zinc-300 uppercase tracking-wide text-[10px]">Filter Context</h3>
              <div className="flex flex-wrap gap-1">
                {filterKeywords.slice(0, 5).map((kw, i) => (
                  <span key={i} className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 rounded">
                    {kw}
                  </span>
                ))}
                {filterKeywords.length > 5 && (
                  <span className="text-zinc-500">+{filterKeywords.length - 5}</span>
                )}
              </div>
              {onClearFilter && (
                <button
                  onClick={onClearFilter}
                  className="px-2 py-1 bg-zinc-200 dark:bg-zinc-700 rounded hover:bg-zinc-300 dark:hover:bg-zinc-600 w-full"
                >
                  Clear filter
                </button>
              )}
            </div>
          )}

          {/* Data Settings */}
          <div className="space-y-2">
            <h3 className="font-medium text-zinc-700 dark:text-zinc-300 uppercase tracking-wide text-[10px]">Data</h3>

            <div className="space-y-1">
              <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                <span>Resolution</span>
                <span className="text-zinc-500">{level}</span>
              </div>
              <input
                type="range"
                min="0"
                max="7"
                value={level}
                onChange={(e) => onLevelChange(parseInt(e.target.value, 10))}
                onPointerUp={onLevelCommit}
                className="w-full h-1.5 accent-blue-500"
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                <span>Density</span>
                <span className="text-zinc-500">{density}</span>
              </div>
              <input
                type="range"
                min="1"
                max="10"
                value={density}
                onChange={(e) => onDensityChange(parseInt(e.target.value, 10))}
                onPointerUp={onDensityCommit}
                className="w-full h-1.5 accent-blue-500"
              />
            </div>

            <label className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                checked={clustered}
                onChange={(e) => onClusteredChange(e.target.checked)}
                className="w-3.5 h-3.5 accent-blue-500"
              />
              <span>Cluster synonyms</span>
            </label>

            <label className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showNeighbors}
                onChange={(e) => onShowNeighborsChange(e.target.checked)}
                className="w-3.5 h-3.5 accent-blue-500"
              />
              <span>Neighbor links</span>
            </label>
          </div>

          {/* Layout Settings */}
          <div className="space-y-2">
            <h3 className="font-medium text-zinc-700 dark:text-zinc-300 uppercase tracking-wide text-[10px]">Layout</h3>

            <div className="space-y-1">
              <span className="text-zinc-600 dark:text-zinc-400">Algorithm</span>
              <select
                value={layoutMode}
                onChange={(e) => onLayoutModeChange(e.target.value as LayoutMode)}
                className="w-full bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 text-zinc-700 dark:text-zinc-300"
              >
                <option value="force">Force-directed</option>
                <option value="umap">UMAP</option>
              </select>
              {umapProgress !== null && (
                <div className="flex items-center gap-2 text-blue-500">
                  <div className="flex-1 h-1 bg-zinc-200 dark:bg-zinc-700 rounded overflow-hidden">
                    <div className="h-full bg-blue-500 transition-all" style={{ width: `${umapProgress}%` }} />
                  </div>
                  <span>{Math.round(umapProgress)}%</span>
                </div>
              )}
            </div>

            <label className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                checked={fitMode}
                onChange={(e) => onFitModeChange(e.target.checked)}
                className="w-3.5 h-3.5 accent-blue-500"
              />
              <span>Fit to canvas</span>
            </label>
          </div>

          {/* Visual Settings */}
          <div className="space-y-2">
            <h3 className="font-medium text-zinc-700 dark:text-zinc-300 uppercase tracking-wide text-[10px]">Visual</h3>

            <div className="space-y-1">
              <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                <span>Node size</span>
                <span className="text-zinc-500">{dotSize.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="-1"
                max="1"
                step="0.1"
                value={dotSlider}
                onChange={(e) => onDotSizeChange(parseFloat(e.target.value))}
                className="w-full h-1.5 accent-blue-500"
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                <span>Edge opacity</span>
                <span className="text-zinc-500">{Math.round(edgeOpacity * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={edgeOpacity}
                onChange={(e) => onEdgeOpacityChange(parseFloat(e.target.value))}
                className="w-full h-1.5 accent-blue-500"
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                <span>Hull opacity</span>
                <span className="text-zinc-500">{Math.round(hullOpacity * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={hullOpacity}
                onChange={(e) => onHullOpacityChange(parseFloat(e.target.value))}
                className="w-full h-1.5 accent-blue-500"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Toggle button */}
      <button
        onClick={onToggle}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 px-1 py-4 rounded-r text-zinc-600 dark:text-zinc-400"
        style={{ left: open ? "224px" : "0" }}
      >
        {open ? "<" : ">"}
      </button>
    </>
  );
}
