"use client";

import { useCallback, useRef } from "react";

const BAR_COUNT = 8;

export function VolumeSlider({
  volume,
  onChange,
  horizontal = false,
}: {
  volume: number;
  onChange: (v: number) => void;
  horizontal?: boolean;
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

  const volumeFromX = useCallback(
    (clientX: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      onChange(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)));
    },
    [onChange]
  );

  if (horizontal) {
    return (
      <div
        ref={containerRef}
        className="music-volume-slider-h"
        onPointerDown={(e) => {
          draggingRef.current = true;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          volumeFromX(e.clientX);
        }}
        onPointerMove={(e) => draggingRef.current && volumeFromX(e.clientX)}
        onPointerUp={() => (draggingRef.current = false)}
      >
        {Array.from({ length: BAR_COUNT }, (_, i) => {
          // i=0 is leftmost (quiet), i=BAR_COUNT-1 is rightmost (loud)
          const level = (i + 1) / BAR_COUNT;
          const active = volume >= level - 0.5 / BAR_COUNT;
          const heightPx = 8 + (i / (BAR_COUNT - 1)) * 14;
          return (
            <div
              key={i}
              className="music-volume-bar-h"
              style={{ height: `${heightPx}px`, opacity: active ? 0.9 : 0.2 }}
            />
          );
        })}
      </div>
    );
  }

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
