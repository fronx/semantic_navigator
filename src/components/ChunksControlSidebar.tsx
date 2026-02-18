/**
 * Collapsible sidebar for ChunksView controls.
 * UMAP parameters and display settings in collapsible sections.
 */

import type { ReactElement } from "react";
import type { PersistedStore } from "@/hooks/usePersistedStore";
import { CollapsibleSidebar } from "@/components/CollapsibleSidebar";
import { Section } from "@/components/Section";
import { Slider } from "@/components/Slider";

export interface ChunksSettings {
  nNeighbors: number;
  minDist: number;
  spread: number;
  colorSaturation: number;
  minSaturation: number;
  chunkColorMix: number;
  edgeThickness: number;
  edgeMidpoint: number;
  nodeSizeMin: number;
  nodeSizeMax: number;
  nodeSizePivot: number;
  sidebarCollapsed: boolean;
  sectionStates: Record<string, boolean>;
}

interface ChunksControlSidebarProps {
  store: PersistedStore<ChunksSettings>;
}

export function ChunksControlSidebar({ store }: ChunksControlSidebarProps): ReactElement {
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
    </CollapsibleSidebar>
  );
}
