import { useCallback, useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { Mask, useMask } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { ContentSimNode } from "@/lib/content-layout";
import { calculateScales } from "@/lib/content-scale";
import { BASE_DOT_RADIUS, DOT_SCALE_FACTOR } from "@/lib/three/node-renderer";
import type { ZoomRange } from "@/lib/zoom-phase-config";
import { computeUnitsPerPixel, smoothstep } from "@/lib/three-text-utils";
import { useThreeTextGeometry } from "@/hooks/useThreeTextGeometry";
import { renderMarkdownToSegments, readContentTextColors, type MarkdownSegment, type ContentTextColors } from "@/lib/r3f-markdown";
import type { ContentScreenRect } from "./R3FLabelContext";

interface ContentLabelRegistration {
  id: string;
  node: ContentSimNode;
  billboard: THREE.Group | null;
  material: THREE.MeshBasicMaterial;
  baseFontSize: number;
  baseOpacity: number;
  geometryWidth: number;
  geometryHeight: number;
  updateLayout?: (layout: { worldWidth: number; worldHeight: number }) => void;
}

const DEFAULT_MIN_SCREEN_PX = 0.5;
const DEFAULT_BASE_FONT_SIZE = 0.3;
const FADE_START_PX = 160;
const FADE_END_PX = 320;
const PREVIEW_CHAR_LIMIT = 700;
const MIN_SCREEN_WIDTH_PX = 40;
const CONTENT_LINE_HEIGHT = 1.3;
const CONTENT_FONT_DEFAULT = "/fonts/source-code-pro-regular.woff2";
const CONTENT_FONT_BOLD = "/fonts/source-code-pro-bold.woff2";
const CONTENT_FONT_MONO = "/fonts/source-code-pro-regular.woff2";
const CARD_HEIGHT_SCALE = 5;
const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;
const H_MARGIN_RATIO = 0.06;
const V_MARGIN_RATIO = 0.1;
const CARD_CORNER_RATIO = 0.08;
const TEXT_FILL_X = 0.9;
const TEXT_FILL_Y = 0.85;

interface LabelPreview {
  text: string;
  fontSize: number;
  lineHeight: number;
  fontUrl: string;
  baseColor: string;
  colorRanges: { start: number; end: number; color: string }[];
}

export interface ContentTextLabels3DProps {
  nodes: ContentSimNode[];
  visibleContentIdsRef?: MutableRefObject<Set<string>>;
  pulledContentPositionsRef?: MutableRefObject<Map<string, { x: number; y: number; connectedPrimaryIds: string[] }>>;
  searchOpacities?: Map<string, number>;
  zoomRange: ZoomRange;
  contentZDepth: number;
  panelThickness: number;
  contentTextDepthScale: number;
  contentSizeMultiplier: number;
  minScreenPx?: number;
  baseFontSize?: number;
  contentScreenRectsRef?: MutableRefObject<Map<string, ContentScreenRect>>;
}

export function ContentTextLabels3D({
  nodes,
  visibleContentIdsRef,
  pulledContentPositionsRef,
  searchOpacities,
  zoomRange,
  contentZDepth,
  panelThickness,
  contentTextDepthScale,
  contentSizeMultiplier,
  minScreenPx = DEFAULT_MIN_SCREEN_PX,
  baseFontSize = DEFAULT_BASE_FONT_SIZE,
  contentScreenRectsRef,
}: ContentTextLabels3DProps) {
  const { camera, size } = useThree();
  const labelRegistry = useRef(new Map<string, ContentLabelRegistration>());
  const tempVec = useMemo(() => new THREE.Vector3(), []);
  const cameraPos = useMemo(() => new THREE.Vector3(), []);
  const scaleVec = useMemo(() => new THREE.Vector3(), []);
  const contentColors = useMemo(() => readContentTextColors(), []);
  const defaultTextColor = contentColors.text;

  const textFrontZ = useMemo(() => {
    const physicalThickness = panelThickness * contentTextDepthScale;
    return contentZDepth - physicalThickness;
  }, [contentZDepth, panelThickness, contentTextDepthScale]);

  const contentRadius = useMemo(
    () => BASE_DOT_RADIUS * DOT_SCALE_FACTOR * contentSizeMultiplier,
    [contentSizeMultiplier]
  );
  const cardHeight = contentRadius * 2 * CARD_HEIGHT_SCALE;
  const cardWidth = cardHeight * GOLDEN_RATIO;
  const innerWidth = cardWidth * (1 - 2 * H_MARGIN_RATIO);

  const labelMeta = useMemo(() => {
    return nodes
      .map((node) => {
        const preview = buildStyledPreview(node.content, baseFontSize, defaultTextColor, contentColors);
        if (!preview) return null;
        return {
          node,
          preview,
          maxWidth: innerWidth,
        };
      })
      .filter((entry): entry is { node: ContentSimNode; preview: LabelPreview; maxWidth: number } => entry !== null);
  }, [nodes, baseFontSize, defaultTextColor, contentColors, innerWidth]);

  const registerLabel = useCallback((id: string, registration: ContentLabelRegistration | null) => {
    if (registration) {
      labelRegistry.current.set(id, registration);
    } else {
      labelRegistry.current.delete(id);
    }
  }, []);

  useFrame(() => {
    const visibleContentIds = visibleContentIdsRef?.current;
    const contentScales = calculateScales(camera.position.z, zoomRange);
    const contentScale = contentScales.contentScale;

    labelRegistry.current.forEach((entry) => {
      const { id, node, billboard, material, baseFontSize: fontSize, baseOpacity } = entry;
      if (!billboard) return;

      const isVisible = visibleContentIds ? visibleContentIds.has(id) : true;
      const screenRect = contentScreenRectsRef?.current.get(id);
      const meetsScreenSize = !!screenRect && screenRect.width >= MIN_SCREEN_WIDTH_PX;
      const meetsScreenBounds =
        !!screenRect &&
        screenRect.x >= -150 &&
        screenRect.x <= size.width + 150 &&
        screenRect.y >= -150 &&
        screenRect.y <= size.height + 150;
      if (!isVisible || !meetsScreenSize || !meetsScreenBounds) {
        billboard.visible = false;
        return;
      }

      const pulledPosition = pulledContentPositionsRef?.current.get(id);
      const x = pulledPosition?.x ?? node.x ?? 0;
      const y = pulledPosition?.y ?? node.y ?? 0;
      billboard.position.set(x, y, textFrontZ);

      const worldPosition = billboard.getWorldPosition(tempVec);
      const unitsPerPixel = computeUnitsPerPixel(camera, size, worldPosition, cameraPos);

      const geometryWidth = entry.geometryWidth > 0 ? entry.geometryWidth : fontSize;
      const geometryHeight = entry.geometryHeight > 0 ? entry.geometryHeight : fontSize * CONTENT_LINE_HEIGHT;
      const usableScreenWidth = Math.max(1, screenRect.width * (1 - 2 * H_MARGIN_RATIO) * TEXT_FILL_X);
      const usableScreenHeight = Math.max(1, screenRect.height * (1 - 2 * V_MARGIN_RATIO) * TEXT_FILL_Y);
      const targetPixelWidth = Math.max(minScreenPx, usableScreenWidth);
      const targetPixelHeight = Math.max(minScreenPx, usableScreenHeight);
      const scaleFromWidth = (targetPixelWidth * unitsPerPixel) / geometryWidth;
      const scaleFromHeight = (targetPixelHeight * unitsPerPixel) / geometryHeight;
      const targetScale = Math.min(scaleFromWidth, scaleFromHeight);
      const minScale = contentScale * 0.05;
      const maxScale = contentScale * 2;
      const desiredScale = THREE.MathUtils.clamp(targetScale, minScale, maxScale);

      scaleVec.setScalar(desiredScale);
      if (!billboard.scale.equals(scaleVec)) {
        billboard.scale.copy(scaleVec);
      }

      // Convert world-space card size to the group's local space
      const worldWidth = Math.max(1e-3, screenRect.width * unitsPerPixel);
      const worldHeight = Math.max(1e-3, screenRect.height * unitsPerPixel);
      entry.updateLayout?.({ worldWidth: worldWidth / desiredScale, worldHeight: worldHeight / desiredScale });

      const pixelSize = (fontSize * desiredScale) / unitsPerPixel;
      const fadeFactor = smoothstep((pixelSize - FADE_START_PX) / (FADE_END_PX - FADE_START_PX));

      // Search opacity is based on parent keywords (max)
      let searchOpacity = searchOpacities?.get(node.id) ?? 1;
      if (node.parentIds && node.parentIds.length > 0 && searchOpacities && searchOpacities.size > 0) {
        let parentMax = 0;
        for (const parentId of node.parentIds) {
          const parentOpacity = searchOpacities.get(parentId) ?? 1;
          parentMax = Math.max(parentMax, parentOpacity);
        }
        searchOpacity *= parentMax;
      }

      const finalOpacity = baseOpacity * (1 - fadeFactor) * searchOpacity;
      const clamped = THREE.MathUtils.clamp(finalOpacity, 0, 1);
      if (Math.abs(material.opacity - clamped) > 0.01) {
        material.opacity = clamped;
        material.needsUpdate = true;
      }
      billboard.visible = clamped > 0.02;
    });
  });

  if (labelMeta.length === 0) {
    return null;
  }

  return (
    <>
      {labelMeta.map(({ node, preview, maxWidth }) => (
        <ContentTextLabel
          key={node.id}
          node={node}
          preview={preview}
          maxWidth={maxWidth}
          baseCardWidth={cardWidth}
          baseCardHeight={cardHeight}
          labelZ={textFrontZ}
          registerLabel={registerLabel}
        />
      ))}
    </>
  );
}

interface ContentTextLabelProps {
  node: ContentSimNode;
  preview: LabelPreview;
  maxWidth: number;
  baseCardWidth: number;
  baseCardHeight: number;
  labelZ: number;
  registerLabel: (id: string, registration: ContentLabelRegistration | null) => void;
}

function ContentTextLabel({
  node,
  preview,
  maxWidth,
  baseCardWidth,
  baseCardHeight,
  labelZ,
  registerLabel,
}: ContentTextLabelProps) {
  const maskId = useMemo(() => hashId(node.id), [node.id]);
  const colorOption = useMemo(() => buildColorOption(preview), [preview]);
  const geometryEntry = useThreeTextGeometry({
    text: preview.text,
    fontSize: preview.fontSize,
    fontUrl: preview.fontUrl,
    lineHeight: preview.lineHeight,
    maxWidth,
    hyphenate: false,
    color: colorOption,
  });
  const groupRef = useRef<THREE.Group>(null);
  const registrationRef = useRef<ContentLabelRegistration | null>(null);
  const textRef = useRef<THREE.Mesh>(null);
  const maskRef = useRef<THREE.Mesh>(null);
  const clipGeometry = useMemo(() => createRoundedRectGeometry(1, 1, CARD_CORNER_RATIO), []);

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(1, 1, 1),
        transparent: true,
        toneMapped: false,
        depthTest: false,
        depthWrite: false,
        opacity: 1,
        vertexColors: true,
      }),
    []
  );

  const maskConfig = useMask(maskId);

  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => clipGeometry.dispose(), [clipGeometry]);

  useEffect(() => {
    Object.assign(material, maskConfig);
  }, [material, maskConfig]);

  const applyLayout = useCallback(
    ({ worldWidth, worldHeight }: { worldWidth: number; worldHeight: number }) => {
      if (!geometryEntry) return;
      const horizontalPadding = worldWidth * H_MARGIN_RATIO;
      const verticalPadding = worldHeight * V_MARGIN_RATIO;
      const innerWidth = Math.max(1e-3, worldWidth - 2 * horizontalPadding);
      const innerHeight = Math.max(1e-3, worldHeight - 2 * verticalPadding);
      const { min, max } = geometryEntry.planeBounds;
      const targetLeft = -worldWidth / 2 + horizontalPadding;
      const targetTop = worldHeight / 2 - verticalPadding;
      const offsetX = targetLeft - min.x;
      const offsetY = targetTop - max.y;
      if (textRef.current) {
        textRef.current.position.set(offsetX, offsetY, 0);
      }
      if (maskRef.current) {
        maskRef.current.scale.set(innerWidth, innerHeight, 1);
      }
    },
    [geometryEntry]
  );

  useEffect(() => {
    if (!geometryEntry) {
      registerLabel(node.id, null);
      registrationRef.current = null;
      return;
    }

    const planeBounds = geometryEntry.planeBounds;
    const geometryWidth = Math.max(1e-3, planeBounds.max.x - planeBounds.min.x);
    const geometryHeight = Math.max(1e-3, planeBounds.max.y - planeBounds.min.y);
    const registration: ContentLabelRegistration = {
      id: node.id,
      node,
      billboard: groupRef.current,
      material,
      baseFontSize: preview.fontSize,
      baseOpacity: 1,
      geometryWidth,
      geometryHeight,
      updateLayout: applyLayout,
    };
    registrationRef.current = registration;
    registerLabel(node.id, registration);
    // Apply a fallback layout until the parent updates us
    applyLayout({ worldWidth: baseCardWidth, worldHeight: baseCardHeight });

    return () => {
      registerLabel(node.id, null);
      registrationRef.current = null;
    };
  }, [geometryEntry, node, material, preview.fontSize, registerLabel, applyLayout, baseCardWidth, baseCardHeight]);

  const setGroupRef = useCallback((instance: THREE.Group | null) => {
    groupRef.current = instance;
    if (registrationRef.current) {
      registrationRef.current.billboard = instance;
    }
  }, []);

  if (!geometryEntry) {
    return null;
  }

  return (
    <group ref={setGroupRef} position={[node.x ?? 0, node.y ?? 0, labelZ]}>
      <Mask ref={maskRef} id={maskId} position={[0, 0, -0.001]} geometry={clipGeometry}>
        <meshBasicMaterial />
      </Mask>
      <mesh
        ref={textRef}
        geometry={geometryEntry.geometry}
        material={material}
        frustumCulled={false}
        position={[0, 0, 0]}
      />
    </group>
  );
}

function buildStyledPreview(content: string, baseFontSize: number, fallbackColor: string, colors?: ContentTextColors): LabelPreview | null {
  if (!content) return null;
  const segments = renderMarkdownToSegments(content, colors);
  const normalized = normalizeSegmentsForPreview(segments, fallbackColor, baseFontSize);
  const block = pickPrimaryBlock(normalized);
  if (!block || block.length === 0) return null;

  const text = block.map((segment) => segment.text ?? "").join("");
  if (text.trim().length === 0) return null;

  const baseSegment = block.find((segment) => (segment.text ?? "").trim().length > 0) ?? block[0];
  const baseColor = baseSegment.color ?? fallbackColor;
  const fontSize = baseSegment.fontSize ?? baseFontSize;
  const lineHeight = baseSegment.lineHeight ?? CONTENT_LINE_HEIGHT;
  const fontUrl = resolveSegmentFont(baseSegment);
  const colorRanges = buildColorRanges(block, baseColor);
  const truncated = truncateTextWithRanges(text, colorRanges, PREVIEW_CHAR_LIMIT);

  return {
    text: truncated.text,
    fontSize,
    lineHeight,
    fontUrl,
    baseColor,
    colorRanges: truncated.ranges,
  };
}

function normalizeSegmentsForPreview(
  segments: MarkdownSegment[],
  fallbackColor: string,
  baseFontSize: number
): MarkdownSegment[] {
  const trimmed = [...segments];
  while (trimmed.length > 0 && typeof trimmed[trimmed.length - 1]?.text === "string" && trimmed[trimmed.length - 1]?.text === "\n") {
    trimmed.pop();
  }
  return trimmed.map((segment) => ({
    ...segment,
    color: segment.color ?? fallbackColor,
    fontSize: segment.fontSize ?? baseFontSize,
    lineHeight: segment.lineHeight ?? CONTENT_LINE_HEIGHT,
  }));
}

function pickPrimaryBlock(segments: MarkdownSegment[]): MarkdownSegment[] | null {
  const blocks: MarkdownSegment[][] = [];
  let current: MarkdownSegment[] = [];

  const flush = () => {
    if (current.length === 0) return;
    blocks.push(current);
    current = [];
  };

  for (const segment of segments) {
    if (segment.blockBoundary) {
      flush();
      continue;
    }
    current.push(segment);
  }
  flush();

  return blocks.find((block) => block.some((segment) => (segment.text ?? "").trim().length > 0)) ?? null;
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
    const color = segment.color ?? baseColor;
    if (color.toLowerCase() !== baseColor.toLowerCase()) {
      ranges.push({ start, end: cursor, color });
    }
  }
  return ranges;
}

function truncateTextWithRanges(
  text: string,
  ranges: { start: number; end: number; color: string }[],
  limit: number
): { text: string; ranges: { start: number; end: number; color: string }[] } {
  if (text.length <= limit) {
    return { text, ranges };
  }
  const sliced = text.slice(0, limit);
  const trimmed = sliced.replace(/\s+\S*$/, "");
  const finalText = `${trimmed}…`;
  const finalLength = finalText.length;
  const adjusted = ranges
    .map((range) => ({
      start: Math.min(range.start, finalLength),
      end: Math.min(range.end, finalLength),
      color: range.color,
    }))
    .filter((range) => range.start < range.end);
  return { text: finalText, ranges: adjusted };
}

function resolveSegmentFont(segment: MarkdownSegment): string {
  if (segment.fontFamily && segment.fontFamily.toLowerCase().includes("mono")) {
    return CONTENT_FONT_MONO;
  }
  if (segment.fontWeight === "700") {
    return CONTENT_FONT_BOLD;
  }
  return CONTENT_FONT_DEFAULT;
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
  return [components[0] / 255, components[1] / 255, components[2] / 255];
}

function buildColorOption(preview: LabelPreview): [number, number, number] | {
  default: [number, number, number];
  byCharRange: Array<{ start: number; end: number; color: [number, number, number] }>;
} {
  const base = hexToRgbArray(preview.baseColor);
  if (!preview.colorRanges || preview.colorRanges.length === 0) {
    return base;
  }
  return {
    default: base,
    byCharRange: preview.colorRanges.map((range) => ({
      start: range.start,
      end: range.end,
      color: hexToRgbArray(range.color),
    })),
  };
}

function hashId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 131 + id.charCodeAt(i)) >>> 0;
  }
  return (hash % 0xfffe) + 1;
}

function createRoundedRectGeometry(width: number, height: number, radius: number): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  const hw = width / 2;
  const hh = height / 2;
  const clampedRadius = Math.min(radius, hw, hh);
  shape.moveTo(-hw + clampedRadius, -hh);
  shape.lineTo(hw - clampedRadius, -hh);
  shape.quadraticCurveTo(hw, -hh, hw, -hh + clampedRadius);
  shape.lineTo(hw, hh - clampedRadius);
  shape.quadraticCurveTo(hw, hh, hw - clampedRadius, hh);
  shape.lineTo(-hw + clampedRadius, hh);
  shape.quadraticCurveTo(-hw, hh, -hw, hh - clampedRadius);
  shape.lineTo(-hw, -hh + clampedRadius);
  shape.quadraticCurveTo(-hw, -hh, -hw + clampedRadius, -hh);
  return new THREE.ShapeGeometry(shape);
}
