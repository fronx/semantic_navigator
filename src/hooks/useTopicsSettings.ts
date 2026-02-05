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
  blurEnabled: boolean;
  showKNNEdges: boolean;
  chunkZOffset: number;
  dynamicClustering: boolean;

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
  blurEnabled: true,
  showKNNEdges: true,
  chunkZOffset: 0.5,
  dynamicClustering: true,
  sidebarCollapsed: false,
  sectionStates: {
    Renderer: true,
    Display: true,
    Graph: true,
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
