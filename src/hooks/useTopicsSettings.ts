/**
 * Consolidated settings hook for TopicsView.
 * Persists all settings to localStorage as a single object.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import type { RendererType } from "@/components/TopicsView";
import { DEFAULT_ZOOM_PHASE_CONFIG, sanitizeZoomPhaseConfig, type ZoomPhaseConfig } from "@/lib/zoom-phase-config";

export interface TopicsSettings {
  // Graph layout
  knnStrength: number;
  contrast: number;
  clusterSensitivity: number;

  // Hover behavior
  hoverSimilarity: number;
  baseDim: number;
  colorMixRatio: number;

  // Display options
  rendererType: RendererType;
  nodeType: 'article' | 'chunk';
  blurEnabled: boolean;
  showKNNEdges: boolean;
  /** Desaturation multiplier: 0.5x to 2x applied to zoom-based desaturation (1.0 = neutral) */
  colorDesaturation: number;
  chunkZOffset: number;
  contentTextDepthScale: number;
  /** Size multiplier for keyword nodes (default 1.0) */
  keywordSizeMultiplier: number;
  /** Enable degree-based node sizing (default true) */
  scaleNodesByDegree: boolean;
  /** What to count for degree-based sizing: keyword-keyword connections or keyword-content connections */
  degreeSizeMode: 'keyword-connections' | 'content-connections';
  /** Minimum size multiplier for degree-based sizing (default 0.5) */
  degreeSizeMin: number;
  /** Maximum size multiplier for degree-based sizing (default 2.0) */
  degreeSizeMax: number;
  contentSizeMultiplier: number;
  contentTextContrast: number;
  /** Global color contrast: push colors away from background (0 = no change, 1 = max contrast) */
  globalContrast: number;
  /** Spring force strength for content node tethering to keywords (0.01-100, default 0.1, logarithmic scale) */
  contentSpringStrength: number;
  /** Transmission panel roughness (0 = smooth/clear, 1 = rough/frosted) */
  panelRoughness: number;
  /** Transmission panel transparency (0 = opaque, 1 = fully transparent) */
  panelTransmission: number;
  /** Transmission panel anisotropic blur strength */
  panelAnisotropicBlur: number;
  /** Transmission panel thickness multiplier (scales auto-computed thickness) */
  panelThicknessMultiplier: number;
  /** Charge force strength for node repulsion (negative = repel, default -200) */
  chargeStrength: number;
  dynamicClustering: boolean;
  /** Use unified simulation (keywords + content in single simulation) vs separate simulations */
  unifiedSimulation: boolean;
  /** Cluster label shadow strength (0 = no shadow, 2 = extra strong) */
  clusterLabelShadowStrength: number;
  /** Focus mode strategy: 'direct' uses keyword-keyword edges, 'content-aware' hops through content nodes */
  focusStrategy: 'direct' | 'content-aware';
  /** Maximum number of hops in focus mode (1-3) */
  focusMaxHops: number;
  /** Use semantically-matched fonts for cluster labels */
  useSemanticFontsForClusters: boolean;
  /** Use semantically-matched fonts for keyword labels */
  useSemanticFontsForKeywords: boolean;

  // UI state
  sidebarCollapsed: boolean;
  sectionStates: Record<string, boolean>;

  // Zoom phases (complex object, handled separately for sanitization)
  zoomPhaseConfig: ZoomPhaseConfig;
}

const DEFAULT_SETTINGS: TopicsSettings = {
  knnStrength: 4.0,
  contrast: 5.0,
  clusterSensitivity: 1.5,
  hoverSimilarity: 0.7,
  baseDim: 0.7,
  colorMixRatio: 0.3,
  rendererType: "d3",
  nodeType: "article",
  blurEnabled: true,
  showKNNEdges: true,
  colorDesaturation: 1.0,
  chunkZOffset: 0.5,
  contentTextDepthScale: -15.0,
  keywordSizeMultiplier: 1.0,
  scaleNodesByDegree: true,
  degreeSizeMode: 'keyword-connections',
  degreeSizeMin: 0.5,
  degreeSizeMax: 2.0,
  contentSizeMultiplier: 1.5,
  contentTextContrast: 0.7,
  globalContrast: 0.5,
  contentSpringStrength: 0.1,
  chargeStrength: -200,
  panelRoughness: 1.0,
  panelTransmission: 0.97,
  panelAnisotropicBlur: 5.0,
  panelThicknessMultiplier: 1.0,
  dynamicClustering: true,
  unifiedSimulation: false,
  clusterLabelShadowStrength: 0.8,
  focusStrategy: 'direct',
  focusMaxHops: 3,
  useSemanticFontsForClusters: true,
  useSemanticFontsForKeywords: true,
  sidebarCollapsed: false,
  sectionStates: {
    Renderer: true,
    Appearance: true,
    "Graph Structure": true,
    "Node Sizing": true,
    Physics: true,
    Hover: true,
    "Zoom Phases": false,
    Debug: false,
  },
  zoomPhaseConfig: DEFAULT_ZOOM_PHASE_CONFIG,
};

const STORAGE_KEY = "topics-settings-v2";

export interface UseTopicsSettingsResult {
  settings: TopicsSettings;
  isReady: boolean;
  update: <K extends keyof TopicsSettings>(key: K, value: TopicsSettings[K]) => void;
  updateZoomPhaseConfig: (mutator: (prev: ZoomPhaseConfig) => ZoomPhaseConfig) => void;
  toggleSection: (section: string) => void;
}

export function useTopicsSettings(): UseTopicsSettingsResult {
  const [settings, setSettings] = useState<TopicsSettings>(DEFAULT_SETTINGS);
  const [isReady, setIsReady] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Partial<TopicsSettings>;
        // Merge with defaults to handle new settings added over time
        const merged = { ...DEFAULT_SETTINGS, ...parsed };
        // Sanitize zoom phase config
        merged.zoomPhaseConfig = sanitizeZoomPhaseConfig(merged.zoomPhaseConfig);
        setSettings(merged);
      } catch {
        // Keep defaults
      }
    }
    setIsReady(true);
  }, []);

  // Save to localStorage when settings change (after initial load)
  useEffect(() => {
    if (isReady) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }
  }, [settings, isReady]);

  // Type-safe updater for individual settings
  const update = useCallback(<K extends keyof TopicsSettings>(key: K, value: TopicsSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Special updater for zoom phase config with sanitization
  const updateZoomPhaseConfig = useCallback((mutator: (prev: ZoomPhaseConfig) => ZoomPhaseConfig) => {
    setSettings((prev) => ({
      ...prev,
      zoomPhaseConfig: sanitizeZoomPhaseConfig(mutator(prev.zoomPhaseConfig)),
    }));
  }, []);

  // Convenience method for toggling sections
  const toggleSection = useCallback((section: string) => {
    setSettings((prev) => ({
      ...prev,
      sectionStates: {
        ...prev.sectionStates,
        [section]: !prev.sectionStates[section],
      },
    }));
  }, []);

  return useMemo(
    () => ({ settings, isReady, update, updateZoomPhaseConfig, toggleSection }),
    [settings, isReady, update, updateZoomPhaseConfig, toggleSection]
  );
}
