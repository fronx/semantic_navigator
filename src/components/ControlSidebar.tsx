/**
 * Collapsible sidebar for TopicsView controls.
 * Groups controls into collapsible sections.
 */

import type { ZoomPhaseConfig } from "@/lib/zoom-phase-config";
import type { RendererType } from "@/components/TopicsView";
import type { TopicsSettings } from "@/hooks/useTopicsSettings";
import type { SemanticFilter } from "@/lib/topics-filter";
import type { KeywordNode } from "@/lib/graph-queries";
import { CAMERA_Z_MIN, CAMERA_Z_MAX } from "@/lib/content-zoom-config";
import { CAMERA_Z_SCALE_BASE } from "@/lib/three/camera-controller";

const LOG_Z_MIN = Math.log10(CAMERA_Z_MIN);
const LOG_Z_MAX = Math.log10(CAMERA_Z_MAX);

function cameraZToSliderValue(z: number): number {
  const clamped = Math.max(CAMERA_Z_MIN, Math.min(CAMERA_Z_MAX, z));
  const ratio = (Math.log10(clamped) - LOG_Z_MIN) / (LOG_Z_MAX - LOG_Z_MIN);
  return Math.round(ratio * 100);
}

function sliderValueToCameraZ(value: number): number {
  const ratio = Math.max(0, Math.min(1, value / 100));
  return Math.pow(10, LOG_Z_MIN + (LOG_Z_MAX - LOG_Z_MIN) * ratio);
}

function formatZoomMarker(z: number): string {
  const zoomValue = Math.round(z).toLocaleString();
  const kValue = (CAMERA_Z_SCALE_BASE / z).toFixed(2);
  return `${zoomValue} (k=${kValue}x)`;
}

function sliderToStrength(value: number): number {
  if (value === 0) return 0;
  return Math.pow(10, (value - 50) / 50);
}

function strengthToSlider(strength: number): number {
  if (strength === 0) return 0;
  return Math.log10(strength) * 50 + 50;
}

interface SectionProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function Section({ title, isOpen, onToggle, children }: SectionProps) {
  return (
    <div className="border-b border-zinc-200 dark:border-zinc-700">
      <button
        onClick={onToggle}
        className="w-full px-3 py-2 text-left text-[11px] uppercase tracking-wider font-semibold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-between"
      >
        <span>{title}</span>
        <span className="text-[10px]">{isOpen ? "−" : "+"}</span>
      </button>
      {isOpen && <div className="px-3 pb-3 space-y-2">{children}</div>}
    </div>
  );
}

interface SliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
}

function Slider({ label, value, onChange, min, max, step, format }: SliderProps) {
  return (
    <label className="flex items-center gap-2 text-[11px]">
      <span className="w-20 text-zinc-500 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 h-2"
      />
      <span className="w-16 text-right tabular-nums text-zinc-500">
        {format ? format(value) : value.toFixed(2)}
      </span>
    </label>
  );
}

interface ZoomSliderProps {
  label: string;
  value: number;
  onChange: (cameraZ: number) => void;
}

function ZoomSlider({ label, value, onChange }: ZoomSliderProps) {
  return (
    <label className="flex items-center gap-2 text-[11px]">
      <span className="w-16 text-zinc-500 shrink-0">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={cameraZToSliderValue(value)}
        onChange={(e) => onChange(sliderValueToCameraZ(parseFloat(e.target.value)))}
        className="flex-1 h-2"
      />
      <span className="w-28 text-right tabular-nums text-zinc-500 text-[10px]">
        {formatZoomMarker(value)}
      </span>
    </label>
  );
}

interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function Checkbox({ label, checked, onChange }: CheckboxProps) {
  return (
    <label className="flex items-center gap-2 text-[11px] cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="cursor-pointer"
      />
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
    </label>
  );
}

export interface ControlSidebarProps {
  settings: TopicsSettings;
  update: <K extends keyof TopicsSettings>(key: K, value: TopicsSettings[K]) => void;
  updateZoomPhaseConfig: (mutator: (prev: ZoomPhaseConfig) => ZoomPhaseConfig) => void;
  toggleSection: (section: string) => void;
  cameraZ?: number;
  clusterResolutionDebug?: {
    zoomScale: number;
    effectiveResolution: number;
    debouncedResolution: number;
    nodeCount: number;
    clusterCount: number;
  };
  // Hover debug info
  hoveredChunkId?: string | null;
  hoveredChunkContent?: string | null;
  keywordChunksDebug?: string;
  // Search filter context
  searchFilterKeywords?: string[];
  onClearSearchFilter?: () => void;
  // Semantic filter navigation
  semanticFilter?: SemanticFilter | null;
  filterHistory?: string[];
  keywordNodes?: KeywordNode[];
  clearSemanticFilter?: () => void;
  goBackInHistory?: () => void;
  goToHistoryIndex?: (index: number) => void;
}

export function ControlSidebar({
  settings,
  update,
  updateZoomPhaseConfig,
  toggleSection,
  cameraZ,
  searchFilterKeywords = [],
  onClearSearchFilter,
  semanticFilter,
  filterHistory = [],
  keywordNodes = [],
  clearSemanticFilter,
  goBackInHistory,
  goToHistoryIndex,
  clusterResolutionDebug,
  hoveredChunkId,
  hoveredChunkContent,
  keywordChunksDebug,
}: ControlSidebarProps) {
  const section = (title: string) => ({
    title,
    isOpen: settings.sectionStates[title] ?? true,
    onToggle: () => toggleSection(title),
  });

  return (
    <div
      className={`
        flex-shrink-0 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-700
        transition-all duration-200 ease-in-out overflow-hidden
        ${settings.sidebarCollapsed ? "w-10" : "w-72"}
      `}
    >
      {/* Collapse toggle */}
      <button
        onClick={() => update("sidebarCollapsed", !settings.sidebarCollapsed)}
        className="w-full h-10 flex items-center justify-center border-b border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        title={settings.sidebarCollapsed ? "Expand controls" : "Collapse controls"}
      >
        <span className="text-zinc-500 text-sm">{settings.sidebarCollapsed ? "»" : "«"}</span>
      </button>

      {!settings.sidebarCollapsed && (
        <div className="overflow-y-auto h-[calc(100%-40px)]">
          {/* Semantic Filter Navigation */}
          {semanticFilter && (
            <div className="filter-navigation">
              {/* Breadcrumb trail */}
              <div className="breadcrumb-trail">
                {filterHistory.map((keywordId, index) => {
                  const keyword = keywordNodes.find((n) => n.id === keywordId);
                  const isLast = index === filterHistory.length - 1;
                  return (
                    <span key={keywordId}>
                      <button
                        onClick={() => goToHistoryIndex?.(index)}
                        disabled={isLast}
                        className={isLast ? "breadcrumb-current" : "breadcrumb-link"}
                      >
                        {keyword?.label || keywordId}
                      </button>
                      {!isLast && <span className="breadcrumb-separator"> → </span>}
                    </span>
                  );
                })}
              </div>

              {/* Navigation buttons */}
              <div className="filter-controls">
                <button
                  onClick={goBackInHistory}
                  disabled={filterHistory.length === 0}
                  title="Go back one level"
                >
                  ← Back
                </button>
                <button
                  onClick={clearSemanticFilter}
                  title="Clear filter and return to full view"
                >
                  Clear Filter
                </button>
              </div>
            </div>
          )}

          {/* Search Filter Context */}
          {searchFilterKeywords.length > 0 && (
            <div className="border-b border-zinc-200 dark:border-zinc-700 px-3 py-2">
              <div className="flex items-center justify-between mb-1.5">
                <h3 className="font-medium text-xs text-zinc-600 dark:text-zinc-400">Search Filter</h3>
                <button
                  onClick={onClearSearchFilter}
                  className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  Clear
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                {searchFilterKeywords.slice(0, 5).map((kw, i) => (
                  <span
                    key={i}
                    className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 rounded text-xs"
                  >
                    {kw}
                  </span>
                ))}
                {searchFilterKeywords.length > 5 && (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    +{searchFilterKeywords.length - 5} more
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Renderer */}
          <Section {...section("Renderer")}>
            <select
              value={settings.rendererType}
              onChange={(e) => update("rendererType", e.target.value as RendererType)}
              className="w-full text-[11px] bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded px-2 py-1"
            >
              <option value="d3">D3/SVG</option>
              <option value="three">Three.js</option>
              <option value="r3f">R3F/drei</option>
            </select>
          </Section>

          {/* Display */}
          <Section {...section("Display")}>
            <Checkbox
              label="Enable blur layer"
              checked={settings.blurEnabled}
              onChange={(v) => update("blurEnabled", v)}
            />
            <Slider
              label="Roughness"
              value={settings.panelRoughness}
              onChange={(v) => update("panelRoughness", v)}
              min={0}
              max={1}
              step={0.05}
            />
            <Slider
              label="Transmission"
              value={settings.panelTransmission}
              onChange={(v) => update("panelTransmission", v)}
              min={0}
              max={1}
              step={0.01}
            />
            <Slider
              label="Blur strength"
              value={settings.panelAnisotropicBlur}
              onChange={(v) => update("panelAnisotropicBlur", v)}
              min={0}
              max={20}
              step={0.5}
            />
            <Slider
              label="Thickness"
              value={settings.panelThicknessMultiplier}
              onChange={(v) => update("panelThicknessMultiplier", v)}
              min={0}
              max={3}
              step={0.1}
              format={(v) => `${v.toFixed(1)}x`}
            />
            <Checkbox
              label="Show k-NN edges"
              checked={settings.showKNNEdges}
              onChange={(v) => update("showKNNEdges", v)}
            />
            <Checkbox
              label="Dynamic clustering"
              checked={settings.dynamicClustering ?? true}
              onChange={(v) => update("dynamicClustering", v)}
            />
            <Slider
              label="Desaturate"
              value={settings.colorDesaturation}
              onChange={(v) => update("colorDesaturation", v)}
              min={0}
              max={1}
              step={0.05}
              format={(v) => `${(v * 100).toFixed(0)}%`}
            />
            <Slider
              label="Text contrast"
              value={settings.contentTextContrast}
              onChange={(v) => update("contentTextContrast", v)}
              min={0}
              max={1}
              step={0.05}
              format={(v) => `${(v * 100).toFixed(0)}%`}
            />
            <Slider
              label="Focus radius"
              value={settings.focusRadius}
              onChange={(v) => update("focusRadius", v)}
              min={0}
              max={200}
              step={5}
              format={(v) => v === 0 ? "Off" : `${v}`}
            />
          </Section>

          {/* Graph */}
          <Section {...section("Graph")}>
            <Slider
              label="Cluster sens"
              value={settings.clusterSensitivity}
              onChange={(v) => update("clusterSensitivity", v)}
              min={0.5}
              max={5}
              step={0.1}
              format={(v) => v.toFixed(1)}
            />
            <Slider
              label="Contrast"
              value={settings.contrast}
              onChange={(v) => update("contrast", v)}
              min={1}
              max={5}
              step={0.1}
              format={(v) => v.toFixed(1)}
            />
            <Slider
              label="k-NN"
              value={strengthToSlider(settings.knnStrength)}
              onChange={(v) => update("knnStrength", sliderToStrength(v))}
              min={0}
              max={100}
              step={1}
              format={() => settings.knnStrength.toFixed(2)}
            />
          </Section>

          {/* Hover */}
          <Section {...section("Hover")}>
            <Slider
              label="Similarity"
              value={settings.hoverSimilarity}
              onChange={(v) => update("hoverSimilarity", v)}
              min={0.3}
              max={0.95}
              step={0.05}
            />
            <Slider
              label="Base dim"
              value={settings.baseDim}
              onChange={(v) => update("baseDim", v)}
              min={0}
              max={0.5}
              step={0.05}
              format={(v) => `${(v * 100).toFixed(0)}%`}
            />
            <Slider
              label="Color mix"
              value={settings.colorMixRatio}
              onChange={(v) => update("colorMixRatio", v)}
              min={0}
              max={1}
              step={0.05}
              format={(v) => `${(v * 100).toFixed(0)}%`}
            />
          </Section>

          {/* Zoom Phases */}
          <Section {...section("Zoom Phases")}>
            <div className="space-y-3">
              {/* Keyword labels */}
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium">
                  Keyword labels
                </div>
                <ZoomSlider
                  label="Start"
                  value={settings.zoomPhaseConfig.keywordLabels.start}
                  onChange={(z) =>
                    updateZoomPhaseConfig((prev) => ({
                      ...prev,
                      keywordLabels: { ...prev.keywordLabels, start: z },
                    }))
                  }
                />
                <ZoomSlider
                  label="Full"
                  value={settings.zoomPhaseConfig.keywordLabels.full}
                  onChange={(z) =>
                    updateZoomPhaseConfig((prev) => ({
                      ...prev,
                      keywordLabels: { ...prev.keywordLabels, full: z },
                    }))
                  }
                />
              </div>

              {/* Chunk crossfade */}
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium">
                  Chunk crossfade
                </div>
                <ZoomSlider
                  label="Fade out"
                  value={settings.zoomPhaseConfig.chunkCrossfade.far}
                  onChange={(z) =>
                    updateZoomPhaseConfig((prev) => ({
                      ...prev,
                      chunkCrossfade: { ...prev.chunkCrossfade, far: z },
                    }))
                  }
                />
                <ZoomSlider
                  label="Full"
                  value={settings.zoomPhaseConfig.chunkCrossfade.near}
                  onChange={(z) =>
                    updateZoomPhaseConfig((prev) => ({
                      ...prev,
                      chunkCrossfade: { ...prev.chunkCrossfade, near: z },
                    }))
                  }
                />
                <Slider
                  label="Depth"
                  value={settings.chunkZOffset}
                  onChange={(value) => update("chunkZOffset", value)}
                  min={-0.1}
                  max={0.1}
                  step={0.01}
                  format={(value) => value.toFixed(2)}
                />
                <Slider
                  label="Text depth"
                  value={settings.contentTextDepthScale}
                  onChange={(value) => update("contentTextDepthScale", value)}
                  min={-20}
                  max={20}
                  step={0.5}
                  format={(value) => value.toFixed(1)}
                />
                <Slider
                  label="Max size"
                  value={settings.contentSizeMultiplier}
                  onChange={(value) => update("contentSizeMultiplier", value)}
                  min={1.0}
                  max={3.0}
                  step={0.1}
                  format={(value) => `${value.toFixed(1)}x`}
                />
              </div>

            </div>
          </Section>

          {/* Debug */}
          <Section {...section("Debug")}>
            <div className="text-[11px] font-mono text-zinc-500 space-y-1">
              <div>Camera Z: {cameraZ !== undefined ? cameraZ.toFixed(0) : "—"}</div>
              <div>
                Zoom: {cameraZ !== undefined ? `${(CAMERA_Z_SCALE_BASE / cameraZ).toFixed(2)}x` : "—"}
              </div>
              {clusterResolutionDebug && (
                <>
                  <div className="pt-1 border-t border-zinc-300 dark:border-zinc-600 mt-1" />
                  <div>Zoom scale: {clusterResolutionDebug.zoomScale.toFixed(2)}</div>
                  <div>Nodes: {clusterResolutionDebug.nodeCount}</div>
                  <div>Effective res: {clusterResolutionDebug.effectiveResolution.toFixed(2)}</div>
                  <div>Debounced res: {clusterResolutionDebug.debouncedResolution.toFixed(2)}</div>
                  <div>Clusters: {clusterResolutionDebug.clusterCount}</div>
                </>
              )}
              {hoveredChunkId && (
                <>
                  <div className="pt-1 border-t border-zinc-300 dark:border-zinc-600 mt-1" />
                  <div className="text-zinc-600 dark:text-zinc-400">Hovered chunk:</div>
                  <div className="text-[10px] break-all">{hoveredChunkId}</div>
                  {hoveredChunkContent && (
                    <div className="text-[10px] text-zinc-600 dark:text-zinc-400 line-clamp-3">
                      {hoveredChunkContent.slice(0, 100)}
                      {hoveredChunkContent.length > 100 ? "..." : ""}
                    </div>
                  )}
                </>
              )}
              {keywordChunksDebug && (
                <>
                  <div className="pt-1 border-t border-zinc-300 dark:border-zinc-600 mt-1" />
                  <div className="text-zinc-600 dark:text-zinc-400">Hovered keyword chunks:</div>
                  <pre className="text-[10px] text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap max-h-60 overflow-y-auto">
                    {keywordChunksDebug}
                  </pre>
                </>
              )}
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}
