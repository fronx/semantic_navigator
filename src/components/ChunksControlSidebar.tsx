/**
 * Collapsible sidebar for ChunksView controls.
 * UMAP parameters and display settings in collapsible sections.
 */

import type { ReactElement } from "react";
import type { PersistedStore } from "@/hooks/usePersistedStore";
import type { LabelFadeRange } from "@/lib/label-fade-coordinator";
import { CollapsibleSidebar } from "@/components/CollapsibleSidebar";
import { Section } from "@/components/Section";
import { Slider } from "@/components/Slider";
import { ZoomSlider } from "@/components/ZoomSlider";

/** Bundled fade-in/out ranges for coarse and fine cluster labels. */
export interface LabelFadeConfig {
  coarseFadeIn: LabelFadeRange;
  coarseFadeOut: LabelFadeRange;
  fineFadeIn: LabelFadeRange;
  fineFadeOut: LabelFadeRange;
}

export interface ChunksSettings {
  nNeighbors: number;
  minDist: number;
  spread: number;
  colorSaturation: number;
  minSaturation: number;
  brightness: number;
  chunkColorMix: number;
  edgeThickness: number;
  edgeMidpoint: number;
  edgeCountPivot: number;
  edgeCountFloor: number;
  nodeSizeMin: number;
  nodeSizeMax: number;
  nodeSizePivot: number;
  hoverRadius: number;
  shapeMorphNear: number;
  shapeMorphFar: number;
  coarseResolution: number;
  fineResolution: number;
  coarseFadeIn: LabelFadeRange;
  coarseFadeOut: LabelFadeRange;
  fineFadeIn: LabelFadeRange;
  fineFadeOut: LabelFadeRange;
  sidebarCollapsed: boolean;
  sectionStates: Record<string, boolean>;
}

interface ChunksControlSidebarProps {
  store: PersistedStore<ChunksSettings>;
  onRedoUmap?: () => void;
  cameraZ?: number;
}

export function ChunksControlSidebar({ store, onRedoUmap, cameraZ }: ChunksControlSidebarProps): ReactElement {
  const { values, update } = store;

  function sectionProps(title: string) {
    return {
      title,
      isOpen: values.sectionStates[title] ?? true,
      onToggle: () =>
        update("sectionStates", {
          ...values.sectionStates,
          [title]: !(values.sectionStates[title] ?? true),
        }),
    };
  }

  return (
    <CollapsibleSidebar
      collapsed={values.sidebarCollapsed}
      onToggle={() => update("sidebarCollapsed", !values.sidebarCollapsed)}
    >
      <Section {...sectionProps("Colors")}>
        <Slider
          label="Saturation"
          value={values.colorSaturation}
          onChange={(v) => update("colorSaturation", v)}
          min={0}
          max={1}
          step={0.05}
        />
        <Slider
          label="Min saturation"
          value={values.minSaturation}
          onChange={(v) => update("minSaturation", v)}
          min={0}
          max={1}
          step={0.05}
        />
        <Slider
          label="Brightness"
          value={values.brightness}
          onChange={(v) => update("brightness", v)}
          min={0.5}
          max={3}
          step={0.05}
        />
        <Slider
          label="Article vs. chunks"
          value={values.chunkColorMix}
          onChange={(v) => update("chunkColorMix", v)}
          min={0}
          max={1}
          step={0.05}
        />
      </Section>

      <Section {...sectionProps("UMAP")}>
        <Slider
          label="Neighbors"
          value={values.nNeighbors}
          onChange={(v) => update("nNeighbors", v)}
          min={2}
          max={100}
          step={1}
          format={(v) => `${v}`}
        />
        <Slider
          label="Min dist"
          value={values.minDist}
          onChange={(v) => update("minDist", v)}
          min={0}
          max={1}
          step={0.01}
        />
        <Slider
          label="Spread"
          value={values.spread}
          onChange={(v) => update("spread", v)}
          min={0.1}
          max={5}
          step={0.1}
          format={(v) => v.toFixed(1)}
        />
      </Section>

      <Section {...sectionProps("Edges")}>
        <Slider
          label="Thickness"
          value={values.edgeThickness}
          onChange={(v) => update("edgeThickness", v)}
          min={0.5}
          max={5}
          step={0.5}
          format={(v) => v.toFixed(1)}
        />
        <Slider
          label="Midpoint"
          value={values.edgeMidpoint}
          onChange={(v) => update("edgeMidpoint", v)}
          min={0.1}
          max={0.9}
          step={0.05}
        />
        <Slider
          label="Count pivot"
          value={values.edgeCountPivot}
          onChange={(v) => update("edgeCountPivot", v)}
          min={10}
          max={500}
          step={10}
          format={(v) => `${v}`}
        />
        <Slider
          label="Min scale"
          value={values.edgeCountFloor}
          onChange={(v) => update("edgeCountFloor", v)}
          min={0}
          max={1}
          step={0.05}
        />
      </Section>

      <Section {...sectionProps("Node Shape")}>
        <ZoomSlider
          label="Circle above"
          value={values.shapeMorphFar}
          onChange={(z) => update("shapeMorphFar", z)}
        />
        <ZoomSlider
          label="Rect below"
          value={values.shapeMorphNear}
          onChange={(z) => update("shapeMorphNear", z)}
        />
      </Section>

      <Section {...sectionProps("Node Size")}>
        <Slider
          label="Min size"
          value={values.nodeSizeMin}
          onChange={(v) => update("nodeSizeMin", v)}
          min={0.1}
          max={2.0}
          step={0.05}
          format={(v) => v.toFixed(2)}
        />
        <Slider
          label="Max size"
          value={values.nodeSizeMax}
          onChange={(v) => update("nodeSizeMax", v)}
          min={1.0}
          max={50.0}
          step={1}
          format={(v) => v.toFixed(1)}
        />
        <Slider
          label="Pivot count"
          value={values.nodeSizePivot}
          onChange={(v) => update("nodeSizePivot", v)}
          min={5}
          max={300}
          step={5}
          format={(v) => `${v}`}
        />
      </Section>

      <Section {...sectionProps("Interaction")}>
        <Slider
          label="Hover radius"
          value={values.hoverRadius}
          onChange={(v) => update("hoverRadius", v)}
          min={0}
          max={500}
          step={10}
          format={(v) => `${v}`}
        />
      </Section>

      <Section {...sectionProps("Cluster Labels")}>
        <Slider
          label="Coarse resolution"
          value={values.coarseResolution}
          onChange={(v) => update("coarseResolution", v)}
          min={0.1}
          max={2.0}
          step={0.1}
          format={(v) => v.toFixed(1)}
        />
        <Slider
          label="Fine resolution"
          value={values.fineResolution}
          onChange={(v) => update("fineResolution", v)}
          min={0.5}
          max={4.0}
          step={0.1}
          format={(v) => v.toFixed(1)}
        />
        {cameraZ != null && (
          <div className="flex items-center justify-between text-[11px] text-zinc-500 py-0.5">
            <span>Camera Z</span>
            <span className="tabular-nums">{Math.round(cameraZ)}</span>
          </div>
        )}
        <div className="space-y-3 mt-1">
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium">Coarse Labels</div>
            <ZoomSlider
              label="Fade in"
              value={values.coarseFadeIn.start}
              onChange={(z) => update("coarseFadeIn", { ...values.coarseFadeIn, start: z })}
            />
            <ZoomSlider
              label="Full"
              value={values.coarseFadeIn.full}
              onChange={(z) => update("coarseFadeIn", { ...values.coarseFadeIn, full: z })}
            />
            <ZoomSlider
              label="Fade out"
              value={values.coarseFadeOut.start}
              onChange={(z) => update("coarseFadeOut", { ...values.coarseFadeOut, start: z })}
            />
            <ZoomSlider
              label="Gone"
              value={values.coarseFadeOut.full}
              onChange={(z) => update("coarseFadeOut", { ...values.coarseFadeOut, full: z })}
            />
          </div>
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium">Fine Labels</div>
            <ZoomSlider
              label="Fade in"
              value={values.fineFadeIn.start}
              onChange={(z) => update("fineFadeIn", { ...values.fineFadeIn, start: z })}
            />
            <ZoomSlider
              label="Full"
              value={values.fineFadeIn.full}
              onChange={(z) => update("fineFadeIn", { ...values.fineFadeIn, full: z })}
            />
            <ZoomSlider
              label="Fade out"
              value={values.fineFadeOut.start}
              onChange={(z) => update("fineFadeOut", { ...values.fineFadeOut, start: z })}
            />
            <ZoomSlider
              label="Gone"
              value={values.fineFadeOut.full}
              onChange={(z) => update("fineFadeOut", { ...values.fineFadeOut, full: z })}
            />
          </div>
        </div>
        {onRedoUmap && (
          <button
            onClick={onRedoUmap}
            className="mt-2 w-full px-2 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700"
          >
            Redo UMAP
          </button>
        )}
      </Section>
    </CollapsibleSidebar>
  );
}
