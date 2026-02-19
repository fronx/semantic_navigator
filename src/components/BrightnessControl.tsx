"use client";

import { useCallback, useRef } from "react";

const BAR_COUNT = 9;
const MIN = 0.5;
const MAX = 2.0;
const RANGE = MAX - MIN;

export function BrightnessControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const lastPointerDownRef = useRef(0);

  const valueFromX = useCallback(
    (clientX: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const t = (clientX - rect.left) / rect.width;
      onChange(Math.max(MIN, Math.min(MAX, MIN + t * RANGE)));
    },
    [onChange]
  );

  return (
    <div
      ref={containerRef}
      className="brightness-control"
      onPointerDown={(e) => {
        const now = Date.now();
        if (now - lastPointerDownRef.current < 300) {
          onChange(1.0);
          lastPointerDownRef.current = 0;
          return;
        }
        lastPointerDownRef.current = now;
        draggingRef.current = true;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        valueFromX(e.clientX);
      }}
      onPointerMove={(e) => draggingRef.current && valueFromX(e.clientX)}
      onPointerUp={() => (draggingRef.current = false)}
    >
      <span className="brightness-icon">☀</span>
      {Array.from({ length: BAR_COUNT }, (_, i) => {
        const level = MIN + ((i + 1) / BAR_COUNT) * RANGE;
        const active = value >= level - (0.5 / BAR_COUNT) * RANGE;
        // Graduated opacity: leftmost bars are dimmer even when active, rightmost are brighter
        const activeOpacity = 0.3 + (i / (BAR_COUNT - 1)) * 0.6;
        const inactiveOpacity = 0.05 + (i / (BAR_COUNT - 1)) * 0.1;
        return (
          <div
            key={i}
            className="brightness-bar"
            style={{ opacity: active ? activeOpacity : inactiveOpacity }}
          />
        );
      })}
    </div>
  );
}
