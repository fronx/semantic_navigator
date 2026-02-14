import type { ReactElement } from "react";
import { CAMERA_Z_MIN, CAMERA_Z_MAX } from "@/lib/content-zoom-config";
import { CAMERA_Z_SCALE_BASE } from "@/lib/rendering-utils/camera-controller";

const LOG_Z_MIN = Math.log10(CAMERA_Z_MIN);
const LOG_Z_MAX = Math.log10(CAMERA_Z_MAX);

export function cameraZToSliderValue(z: number): number {
  const clamped = Math.max(CAMERA_Z_MIN, Math.min(CAMERA_Z_MAX, z));
  const ratio = (Math.log10(clamped) - LOG_Z_MIN) / (LOG_Z_MAX - LOG_Z_MIN);
  return Math.round(ratio * 100);
}

export function sliderValueToCameraZ(value: number): number {
  const ratio = Math.max(0, Math.min(1, value / 100));
  return Math.pow(10, LOG_Z_MIN + (LOG_Z_MAX - LOG_Z_MIN) * ratio);
}

export function formatZoomMarker(z: number): string {
  const zoomValue = Math.round(z).toLocaleString();
  const kValue = (CAMERA_Z_SCALE_BASE / z).toFixed(2);
  return `${zoomValue} (k=${kValue}x)`;
}

interface ZoomSliderProps {
  label: string;
  value: number;
  onChange: (cameraZ: number) => void;
}

export function ZoomSlider({ label, value, onChange }: ZoomSliderProps): ReactElement {
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
