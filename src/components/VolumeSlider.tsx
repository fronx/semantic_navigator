"use client";

import { useCallback, useRef } from "react";

const BAR_COUNT = 8;

export function VolumeSlider({
  volume,
  onChange,
}: {
  volume: number;
  onChange: (v: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const volumeFromY = useCallback(
    (clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      onChange(Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height)));
    },
    [onChange]
  );

  return (
    <div
      ref={containerRef}
      className="music-volume-slider"
      onPointerDown={(e) => {
        draggingRef.current = true;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        volumeFromY(e.clientY);
      }}
      onPointerMove={(e) => draggingRef.current && volumeFromY(e.clientY)}
      onPointerUp={() => (draggingRef.current = false)}
    >
      {Array.from({ length: BAR_COUNT }, (_, i) => {
        const level = (BAR_COUNT - i) / BAR_COUNT;
        const active = volume >= level - 0.5 / BAR_COUNT;
        const widthPx = 8 + ((BAR_COUNT - 1 - i) / (BAR_COUNT - 1)) * 14;
        return (
          <div
            key={i}
            className="music-volume-bar"
            style={{ width: `${widthPx}px`, opacity: active ? 0.9 : 0.2 }}
          />
        );
      })}
    </div>
  );
}
