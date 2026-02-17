/**
 * Collapsible sidebar for ChunksView controls.
 * UMAP parameters and focus lens settings in collapsible sections.
 */

import type { ReactElement } from "react";
import type { PersistedStore } from "@/hooks/usePersistedStore";
import { CollapsibleSidebar } from "@/components/CollapsibleSidebar";
import { Section } from "@/components/Section";
import { Slider } from "@/components/Slider";
import { SelectField } from "@/components/SelectField";

export interface ChunksSettings {
  nNeighbors: number;
  minDist: number;
  spread: number;
  edgeThickness: number;
  edgeContrast: number;
  edgeMidpoint: number;
  lensCompressionStrength: number;
  lensCenterScale: number;
  lensEdgeScale: number;
  lpNormP: number;
  focusMode: "manifold" | "click";
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
          label="Contrast"
          value={values.edgeContrast}
          onChange={(v) => update("edgeContrast", v)}
          min={0}
          max={20}
          step={1}
          format={(v) => `${v}`}
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

      <Section {...sectionProps("Focus Lens")}>
        <SelectField
          label="Focus behavior"
          value={values.focusMode}
          onChange={(v) => update("focusMode", v as "manifold" | "click")}
          options={[
            { value: "click", label: "Click-based focus" },
            { value: "manifold", label: "Manifold zoom focus" },
          ]}
        />
        <div className="h-2" />
        <Slider
          label="Compression"
          value={values.lensCompressionStrength}
          onChange={(v) => update("lensCompressionStrength", v)}
          min={1.0}
          max={4.0}
          step={0.1}
          format={(v) => v.toFixed(1)}
        />
        <Slider
          label="Center scale"
          value={values.lensCenterScale}
          onChange={(v) => update("lensCenterScale", v)}
          min={1.0}
          max={5.0}
          step={0.1}
          format={(v) => v.toFixed(1)}
        />
        <Slider
          label="Edge scale"
          value={values.lensEdgeScale}
          onChange={(v) => update("lensEdgeScale", v)}
          min={0.3}
          max={1.0}
          step={0.05}
          format={(v) => v.toFixed(2)}
        />
        <Slider
          label="Horizon shape"
          value={values.lpNormP}
          onChange={(v) => update("lpNormP", v)}
          min={2}
          max={12}
          step={0.5}
          format={(v) => `p=${v.toFixed(1)}`}
        />
      </Section>
    </CollapsibleSidebar>
  );
}
