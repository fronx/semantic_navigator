import type { ReactElement } from "react";

interface SliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
}

export function Slider({ label, value, onChange, min, max, step, format }: SliderProps): ReactElement {
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
