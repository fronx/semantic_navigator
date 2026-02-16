/**
 * Collapsible sidebar for TopicsView controls.
 * Groups controls into collapsible sections.
 */

import type { ZoomPhaseConfig } from "@/lib/zoom-phase-config";
import type { RendererType } from "@/components/TopicsView";
import type { TopicsSettings } from "@/hooks/useTopicsSettings";
import type { SemanticFilter } from "@/lib/topics-filter";
import type { KeywordNode } from "@/lib/graph-queries";
import { CAMERA_Z_SCALE_BASE } from "@/lib/rendering-utils/camera-controller";
import { BackupManager } from "@/components/BackupManager";
import { CollapsibleSidebar } from "@/components/CollapsibleSidebar";
import { Section } from "@/components/Section";
import { Slider } from "@/components/Slider";
import { Checkbox } from "@/components/Checkbox";
import { ZoomSlider } from "@/components/ZoomSlider";
import { SelectField } from "@/components/SelectField";

function sliderToStrength(value: number): number {
  if (value === 0) return 0;
  return Math.pow(10, (value - 50) / 50);
}

function strengthToSlider(strength: number): number {
  if (strength === 0) return 0;
  return Math.log10(strength) * 50 + 50;
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
    <CollapsibleSidebar
      collapsed={settings.sidebarCollapsed}
      onToggle={() => update("sidebarCollapsed", !settings.sidebarCollapsed)}
    >
          {/* Backup Controls */}
          <BackupManager />

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

          {/* Renderer */}
          <Section {...section("Renderer")}>
            <SelectField
              value={settings.rendererType}
              onChange={(v) => update("rendererType", v as RendererType)}
              options={[
                { value: "d3", label: "D3/SVG" },
                { value: "r3f", label: "R3F/drei" },
              ]}
            />

            <div className="mt-2">
              <SelectField
                label="Focus Mode Strategy"
                value={settings.focusStrategy}
                onChange={(v) => update("focusStrategy", v as 'direct' | 'content-aware')}
                options={[
                  { value: "direct", label: "Direct (keyword\u2192keyword)" },
                  { value: "content-aware", label: "Content-aware (keyword\u2192content\u2192keyword)" },
                ]}
              />
            </div>

            <Slider
              label="Max Hops"
              value={settings.focusMaxHops}
              onChange={(v) => update("focusMaxHops", Math.round(v))}
              min={1}
              max={3}
              step={1}
              format={(v) => `${Math.round(v)}`}
            />
          </Section>

          {/* Appearance */}
          <Section {...section("Appearance")}>
            {/* Blur Layer subsection */}
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-400 dark:text-zinc-500">
                Blur Layer
              </div>
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
            </div>

            {/* Colors subsection */}
            <div className="pt-2 mt-2 border-t border-zinc-200 dark:border-zinc-700 space-y-2">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-400 dark:text-zinc-500">
                Colors
              </div>
              <Slider
                label="Desaturate"
                value={settings.colorDesaturation}
                onChange={(v) => update("colorDesaturation", v)}
                min={0.5}
                max={2}
                step={0.1}
                format={(v) => `${v.toFixed(1)}x`}
              />
              <Slider
                label="Color contrast"
                value={settings.globalContrast}
                onChange={(v) => update("globalContrast", v)}
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
            </div>

            {/* Labels subsection */}
            <div className="pt-2 mt-2 border-t border-zinc-200 dark:border-zinc-700 space-y-2">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-400 dark:text-zinc-500">
                Labels
              </div>
              <Slider
                label="Cluster shadow"
                value={settings.clusterLabelShadowStrength}
                onChange={(v) => update("clusterLabelShadowStrength", v)}
                min={0}
                max={2.0}
                step={0.1}
                format={(v) => v.toFixed(1)}
              />
              <Checkbox
                label="Semantic fonts (clusters)"
                checked={settings.useSemanticFontsForClusters}
                onChange={(v) => update("useSemanticFontsForClusters", v)}
              />
              <Checkbox
                label="Semantic fonts (keywords)"
                checked={settings.useSemanticFontsForKeywords}
                onChange={(v) => update("useSemanticFontsForKeywords", v)}
              />
            </div>
          </Section>

          {/* Graph Structure */}
          <Section {...section("Graph Structure")}>
            {/* Clustering subsection */}
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-400 dark:text-zinc-500">
                Clustering
              </div>
              <Checkbox
                label="Dynamic clustering"
                checked={settings.dynamicClustering}
                onChange={(v) => update("dynamicClustering", v)}
              />
              <Slider
                label="Sensitivity"
                value={settings.clusterSensitivity}
                onChange={(v) => update("clusterSensitivity", v)}
                min={0.5}
                max={5}
                step={0.1}
                format={(v) => v.toFixed(1)}
              />
            </div>

            {/* Edges subsection */}
            <div className="pt-2 mt-2 border-t border-zinc-200 dark:border-zinc-700 space-y-2">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-400 dark:text-zinc-500">
                Edges
              </div>
              <Checkbox
                label="Show k-NN edges"
                checked={settings.showKNNEdges}
                onChange={(v) => update("showKNNEdges", v)}
              />
              <Slider
                label="k-NN (D3)"
                value={strengthToSlider(settings.knnStrength)}
                onChange={(v) => update("knnStrength", sliderToStrength(v))}
                min={0}
                max={100}
                step={1}
                format={() => settings.knnStrength.toFixed(2)}
              />
              <Slider
                label="Contrast (D3)"
                value={settings.contrast}
                onChange={(v) => update("contrast", v)}
                min={1}
                max={5}
                step={0.1}
                format={(v) => v.toFixed(1)}
              />
            </div>
          </Section>

          {/* Node Sizing */}
          <Section {...section("Node Sizing")}>
            <Slider
              label="Keyword size"
              value={settings.keywordSizeMultiplier}
              onChange={(v) => update("keywordSizeMultiplier", v)}
              min={0.1}
              max={5}
              step={0.1}
              format={(v) => `${v.toFixed(1)}x`}
            />
            <Checkbox
              label="Scale by degree"
              checked={settings.scaleNodesByDegree}
              onChange={(v) => update("scaleNodesByDegree", v)}
            />
            {settings.scaleNodesByDegree && (
              <>
                <div className="mt-2">
                  <SelectField
                    label="Degree Mode"
                    value={settings.degreeSizeMode}
                    onChange={(v) => update("degreeSizeMode", v as 'keyword-connections' | 'content-connections')}
                    options={[
                      { value: "keyword-connections", label: "Keyword connections" },
                      { value: "content-connections", label: "Content connections" },
                    ]}
                  />
                </div>
                <Slider
                  label="Degree min"
                  value={settings.degreeSizeMin}
                  onChange={(v) => update("degreeSizeMin", v)}
                  min={0.1}
                  max={1.0}
                  step={0.05}
                  format={(v) => `${v.toFixed(2)}x`}
                />
                <Slider
                  label="Degree max"
                  value={settings.degreeSizeMax}
                  onChange={(v) => update("degreeSizeMax", v)}
                  min={1.0}
                  max={5.0}
                  step={0.1}
                  format={(v) => `${v.toFixed(1)}x`}
                />
              </>
            )}
          </Section>

          {/* Physics */}
          <Section {...section("Physics")}>
            <Checkbox
              label="Unified simulation"
              checked={settings.unifiedSimulation}
              onChange={(v) => update("unifiedSimulation", v)}
            />
            <Slider
              label="Charge"
              value={settings.chargeStrength}
              onChange={(v) => update("chargeStrength", v)}
              min={-500}
              max={0}
              step={10}
              format={(v) => `${v}`}
            />
            <Slider
              label="Spring force"
              value={Math.log10(settings.contentSpringStrength)}
              onChange={(logV) => update("contentSpringStrength", Math.pow(10, logV))}
              min={-2}
              max={2}
              step={0.01}
              format={(logV) => Math.pow(10, logV).toFixed(Math.pow(10, logV) < 1 ? 3 : 1)}
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
                  Keyword Labels
                </div>
                <ZoomSlider
                  label="Start fade"
                  value={settings.zoomPhaseConfig.keywordLabels.start}
                  onChange={(z) =>
                    updateZoomPhaseConfig((prev) => ({
                      ...prev,
                      keywordLabels: { ...prev.keywordLabels, start: z },
                    }))
                  }
                />
                <ZoomSlider
                  label="Full opacity"
                  value={settings.zoomPhaseConfig.keywordLabels.full}
                  onChange={(z) =>
                    updateZoomPhaseConfig((prev) => ({
                      ...prev,
                      keywordLabels: { ...prev.keywordLabels, full: z },
                    }))
                  }
                />
              </div>

              {/* Content fade-in */}
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium">
                  Content Fade-In
                </div>
                <ZoomSlider
                  label="Start fade"
                  value={settings.zoomPhaseConfig.chunkCrossfade.far}
                  onChange={(z) =>
                    updateZoomPhaseConfig((prev) => ({
                      ...prev,
                      chunkCrossfade: { ...prev.chunkCrossfade, far: z },
                    }))
                  }
                />
                <ZoomSlider
                  label="Full opacity"
                  value={settings.zoomPhaseConfig.chunkCrossfade.near}
                  onChange={(z) =>
                    updateZoomPhaseConfig((prev) => ({
                      ...prev,
                      chunkCrossfade: { ...prev.chunkCrossfade, near: z },
                    }))
                  }
                />
              </div>

              {/* Content geometry */}
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium">
                  Content Geometry
                </div>
                <Slider
                  label="Card depth"
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
    </CollapsibleSidebar>
  );
}
