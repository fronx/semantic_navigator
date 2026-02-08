/**
 * Minimal Markdown → Text prototype rendered fully inside R3F.
 * Uses the shared segment renderer so styling matches the cluster labels.
 */

import { useCallback, useMemo, useState } from "react";
import { Billboard } from "@react-three/drei";
import { ThreeTextLabel } from "./ThreeTextLabel";
import { renderMarkdownToSegments, type MarkdownSegment } from "@/lib/r3f-markdown";
import type { ThreeTextGeometryInfo } from "three-text/three";

const FONT_DEFAULT = "/fonts/source-code-pro-regular.woff2";
const FONT_BOLD = "/fonts/source-code-pro-bold.woff2";
const FONT_MONO = "/fonts/source-code-pro-regular.woff2";

const DEFAULT_SAMPLE = [
  "# Semantic Navigator",
  "",
  "Rendering Markdown directly in **R3F**, _no HTML overlays required_.",
  "",
  "## Features",
  "",
  "- ✅ Styled headings",
  "- ✅ Inline **bold** / _italic_ / `code`",
  "- ✅ Bullet & numbered lists",
  "",
  "> “This block lives entirely inside WebGL.”",
  "",
  "```tsx",
  "function hello() {",
  '  console.log("Markdown shaders 💡");',
  "}",
  "```",
].join("\n");

export interface MarkdownTextBillboardProps {
  markdown?: string | null;
  /** World-space Z plane for placement (keywords live near z ≈ 0) */
  targetZ?: number;
  /** Optional explicit position override (x, y, z) */
  position?: [number, number, number];
  /** Override default max width for the rendered text */
  maxWidth?: number;
  /** Override default font size for the rendered text */
  fontSize?: number;
  /** Text color fallback for segments that do not specify their own */
  color?: string;
  /** Whether to show the prototype block */
  visible?: boolean;
}

interface MarkdownBlock {
  text: string;
  fontSize: number;
  lineHeight: number;
  color: string;
  colorRanges: { start: number; end: number; color: string }[];
  fontUrl: string;
}

const DEFAULT_LINE_HEIGHT = 1.35;
const BLOCK_VERTICAL_GAP = 20;

function normalizeSegments(
  segments: MarkdownSegment[],
  defaults: { color: string; fontSize: number }
): MarkdownSegment[] {
  const normalized = [...segments];
  while (normalized.length > 0 && normalized[normalized.length - 1]?.text === "\n") {
    normalized.pop();
  }
  return normalized.map((segment) => ({
    ...segment,
    color: segment.color ?? defaults.color,
    fontSize: segment.fontSize ?? defaults.fontSize,
  }));
}

function buildColorRanges(
  segments: MarkdownSegment[],
  baseColor: string
): { start: number; end: number; color: string }[] {
  const ranges: { start: number; end: number; color: string }[] = [];
  let cursor = 0;
  for (const segment of segments) {
    const text = segment.text ?? "";
    if (text.length === 0) continue;
    const start = cursor;
    cursor += text.length;
    const segmentColor = segment.color ?? baseColor;
    if (segmentColor && segmentColor.toLowerCase() !== baseColor.toLowerCase()) {
      ranges.push({
        start,
        end: cursor,
        color: segmentColor,
      });
    }
  }
  return ranges;
}

function resolveFontUrl(segment: MarkdownSegment | undefined): string {
  if (!segment) return FONT_DEFAULT;
  if (segment.fontFamily && segment.fontFamily.toLowerCase().includes("mono")) {
    return FONT_MONO;
  }
  if (segment.fontWeight === "700") {
    return FONT_BOLD;
  }
  return FONT_DEFAULT;
}

function buildBlocks(
  segments: MarkdownSegment[],
  fallbackColor: string,
  fallbackFontSize: number
): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let current: MarkdownSegment[] = [];

  function flush() {
    if (current.length === 0) return;
    const text = current.map((segment) => segment.text ?? "").join("");
    if (text.trim().length === 0) {
      current = [];
      return;
    }
    const baseSegment =
      current.find((segment) => (segment.text ?? "").trim().length > 0) ?? current[0];
    const blockColor = baseSegment?.color ?? fallbackColor;
    const fontSize = baseSegment?.fontSize ?? fallbackFontSize;
    const lineHeight = baseSegment?.lineHeight ?? DEFAULT_LINE_HEIGHT;
    const colorRanges = buildColorRanges(current, blockColor);

    blocks.push({
      text,
      fontSize,
      lineHeight,
      color: blockColor,
      colorRanges,
      fontUrl: resolveFontUrl(baseSegment),
    });
    current = [];
  }

  for (const segment of segments) {
    if (segment.blockBoundary) {
      flush();
      continue;
    }
    current.push(segment);
  }
  flush();

  if (blocks.length === 0) {
    const fallbackText = segments.map((segment) => segment.text ?? "").join("");
    blocks.push({
      text: fallbackText,
      fontSize: fallbackFontSize,
      lineHeight: DEFAULT_LINE_HEIGHT,
      color: fallbackColor,
      colorRanges: [],
      fontUrl: FONT_DEFAULT,
    });
  }

  return blocks;
}

export function MarkdownTextBillboard({
  markdown,
  targetZ = 0,
  position,
  maxWidth = 400,
  fontSize = 42,
  color = "#fefce8",
  visible = true,
}: MarkdownTextBillboardProps) {
  const [measuredHeights, setMeasuredHeights] = useState<Record<number, number>>({});

  const textSegments = useMemo(() => {
    const source = markdown && markdown.trim().length > 0 ? markdown : DEFAULT_SAMPLE;
    const segments = renderMarkdownToSegments(source);
    return normalizeSegments(segments, { color, fontSize });
  }, [markdown, color, fontSize]);

  const blocks = useMemo(
    () => buildBlocks(textSegments, color, fontSize),
    [textSegments, color, fontSize]
  );

  const heights = useMemo(() => {
    return blocks.map(
      (block, index) => measuredHeights[index] ?? block.fontSize * block.lineHeight
    );
  }, [blocks, measuredHeights]);

  const totalHeight =
    heights.reduce((sum, heightValue) => sum + heightValue, 0) +
    BLOCK_VERTICAL_GAP * Math.max(0, blocks.length - 1);

  const positionedBlocks = useMemo(() => {
    let currentTop = totalHeight > 0 ? totalHeight / 2 : 0;
    return blocks.map((block, index) => {
      const blockHeight = heights[index];
      const centerY = currentTop - blockHeight / 2;
      currentTop -= blockHeight + BLOCK_VERTICAL_GAP;
      return {
        block,
        positionY: centerY,
        index,
      };
    });
  }, [blocks, heights, totalHeight]);

  const handleBoundsChange = useCallback(
    (index: number) =>
      (bounds: ThreeTextGeometryInfo["planeBounds"]) => {
        const height = Math.max(1, bounds.max.y - bounds.min.y);
        setMeasuredHeights((prev) => {
          if (Math.abs((prev[index] ?? 0) - height) < 0.5) {
            return prev;
          }
          return { ...prev, [index]: height };
        });
      },
    []
  );

  if (!visible) return null;

  return (
    <Billboard position={position ?? [0, 0, targetZ]} follow={false} lockZ>
      {positionedBlocks.map(({ block, positionY, index }) => (
        <ThreeTextLabel
          key={`${block.text}-${index}`}
          text={block.text}
          fontSize={block.fontSize}
          fontUrl={block.fontUrl}
          color={block.color}
          colorRanges={block.colorRanges}
          lineHeight={block.lineHeight}
          maxWidth={maxWidth}
          align="left"
          position={[0, positionY, 0]}
          onBoundsChange={(bounds) => handleBoundsChange(index)(bounds)}
        />
      ))}
    </Billboard>
  );
}
