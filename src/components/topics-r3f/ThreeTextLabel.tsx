import { useCallback, useMemo, useState } from "react";
import { Text as ThreeText, type ThreeTextGeometryInfo } from "three-text/three/react";
import type { BufferGeometry } from "three";
import type { ThreeTextProps } from "three-text/three/react";
import { ensureThreeTextInitialized } from "@/lib/three-text-config";

const DEFAULT_FONT_URL = "/fonts/source-code-pro-regular.woff2";
const DEFAULT_ALIGNMENT: ThreeTextProps["layout"]["align"] = "center";

interface ColorRange {
  start: number;
  end: number;
  color?: string | [number, number, number];
}

function hexToRgbArray(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  const chunkSize = normalized.length === 3 ? 1 : 2;
  const components: number[] = [];

  for (let i = 0; i < normalized.length; i += chunkSize) {
    const part = normalized.slice(i, i + chunkSize);
    const expanded = chunkSize === 1 ? part + part : part;
    const value = Number.parseInt(expanded, 16);
    components.push(Number.isNaN(value) ? 255 : value);
  }

  while (components.length < 3) {
    components.push(255);
  }

  return [
    components[0] / 255,
    components[1] / 255,
    components[2] / 255,
  ];
}

function resolveColor(color?: string | [number, number, number]): [number, number, number] {
  if (Array.isArray(color)) {
    return color;
  }
  if (typeof color === "string") {
    return hexToRgbArray(color);
  }
  return hexToRgbArray("#fefce8");
}

export interface ThreeTextLabelProps {
  text: string;
  fontUrl?: string;
  fontSize?: number;
  color?: string | [number, number, number];
  colorRanges?: ColorRange[];
  lineHeight?: number;
  maxWidth?: number;
  align?: ThreeTextProps["layout"]["align"];
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  depth?: number;
  onBoundsChange?: (bounds: ThreeTextGeometryInfo["planeBounds"], info: ThreeTextGeometryInfo) => void;
}

export function ThreeTextLabel({
  text,
  fontUrl = DEFAULT_FONT_URL,
  fontSize = 42,
  color,
  colorRanges,
  lineHeight = 1.3,
  maxWidth,
  align = DEFAULT_ALIGNMENT,
  position = [0, 0, 0],
  rotation,
  scale,
  depth = 0,
  onBoundsChange,
}: ThreeTextLabelProps) {
  ensureThreeTextInitialized();

  const [anchorOffset, setAnchorOffset] = useState<[number, number]>([0, 0]);

  const layout = useMemo(() => {
    const base: NonNullable<ThreeTextProps["layout"]> = {
      align,
      patternsPath: "/patterns/",
      hyphenate: true,
    };
    if (maxWidth !== undefined) {
      base.width = maxWidth;
    }
    return base;
  }, [align, maxWidth]);

  const rgbColor = useMemo(() => resolveColor(color), [color]);

  const colorOption = useMemo(() => {
    if (!colorRanges || colorRanges.length === 0) {
      return rgbColor;
    }
    return {
      default: rgbColor,
      byCharRange: colorRanges.map((range) => ({
        start: range.start,
        end: range.end,
        color: resolveColor(range.color ?? color),
      })),
    };
  }, [rgbColor, colorRanges, color]);

  const handleLoad = useCallback(
    (_geometry: BufferGeometry, info: ThreeTextGeometryInfo) => {
      const { min, max } = info.planeBounds;
      const centerX = (min.x + max.x) / 2;
      const centerY = (min.y + max.y) / 2;
      setAnchorOffset([centerX, centerY]);
      onBoundsChange?.(info.planeBounds, info);
    },
    [onBoundsChange]
  );

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <ThreeText
        font={fontUrl}
        size={fontSize}
        lineHeight={lineHeight}
        layout={layout}
        color={colorOption}
        position={[-anchorOffset[0], -anchorOffset[1], 0]}
        onLoad={handleLoad}
        vertexColors={false}
        depth={depth}
      >
        {text}
      </ThreeText>
    </group>
  );
}
