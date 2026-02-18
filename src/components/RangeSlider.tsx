import type { ReactElement } from "react";
import "./RangeSlider.css";

interface RangeSliderProps {
  label: string;
  low: number;
  high: number;
  onChangeLow: (value: number) => void;
  onChangeHigh: (value: number) => void;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
  /** Optional marker value shown as a vertical line on the track. */
  marker?: number;
}

export function RangeSlider({
  label,
  low,
  high,
  onChangeLow,
  onChangeHigh,
  min,
  max,
  step,
  format,
  marker,
}: RangeSliderProps): ReactElement {
  const fmt = format ?? ((v: number) => v.toFixed(0));
  const pctLow = ((low - min) / (max - min)) * 100;
  const pctHigh = ((high - min) / (max - min)) * 100;
  const pctMarker = marker != null ? ((marker - min) / (max - min)) * 100 : undefined;

  return (
    <div className="flex flex-col gap-0.5 text-[11px]">
      <div className="flex items-center justify-between">
        <span className="text-zinc-500">{label}</span>
        <span className="tabular-nums text-zinc-500">
          {fmt(low)} – {fmt(high)}
        </span>
      </div>
      <div className="range-slider-track">
        <div
          className="range-slider-fill"
          style={{ left: `${pctLow}%`, width: `${pctHigh - pctLow}%` }}
        />
        {pctMarker != null && (
          <div
            className="range-slider-marker"
            style={{ left: `${Math.min(100, Math.max(0, pctMarker))}%` }}
          />
        )}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={low}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            onChangeLow(Math.min(v, high - step));
          }}
          className="range-slider-input"
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={high}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            onChangeHigh(Math.max(v, low + step));
          }}
          className="range-slider-input"
        />
      </div>
    </div>
  );
}
