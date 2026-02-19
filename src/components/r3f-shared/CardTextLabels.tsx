/**
 * Unified chunk card text labels for both ChunksView and TopicsView.
 *
 * Renders markdown content on chunk cards using screen-space scaling:
 * text fills the card width, centered horizontally, top-aligned with margins.
 *
 * Position source is abstracted via a callback ref so the component is
 * independent of the position data structure (Float32Array, node.x/y, etc).
 *
 * Opacity effects (zoom-fade, search) are opt-in via props so TopicsView
 * can enable them while ChunksView keeps it simple.
 */

import { useCallback, useEffect, useRef, useMemo, useState } from "react";
import type { MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useThreeTextGeometry } from "@/hooks/useThreeTextGeometry";
import { useTextClippingPlane, type ClippingPlaneUpdater } from "@/hooks/useTextClippingPlane";
import { renderMarkdownToSegments, readContentTextColors, type MarkdownSegment, type ContentTextColors } from "@/lib/r3f-markdown";
import type { ColorOptions } from "three-text/core";
import type { ScreenRect } from "@/lib/screen-rect-projection";
import { computeUnitsPerPixel, smoothstep } from "@/lib/three-text-utils";
import type { ZoomRange } from "@/lib/zoom-phase-config";
import { CARD_V_MARGIN_RATIO } from "@/lib/chunks-geometry";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FONT_URL_REGULAR = "/fonts/source-code-pro-regular.woff2";
const FONT_URL_BOLD = "/fonts/source-code-pro-bold.woff2";
const DEFAULT_BASE_FONT_SIZE = 1.2;
const DEFAULT_LINE_HEIGHT = 1.3;
/**
 * The paragraph font size used by renderMarkdownToSegments (in geometry units).
 * All segment fontSizes are normalized relative to this so baseFontSize controls
 * the actual geometry scale — making textMaxWidth and baseFontSize compatible.
 */
const MARKDOWN_REFERENCE_FONT_SIZE = 28;
const DEFAULT_H_MARGIN_RATIO = 0.12;
const MIN_SCREEN_WIDTH_PX = 40;
/** Pixel size at which text starts to fade (zoom-fade) */
const FADE_START_PX = 160;
/** Pixel size at which text is fully faded */
const FADE_END_PX = 320;
/** Max content chars to build geometry for (remainder clipped visually) */
const PREVIEW_CHAR_LIMIT = 5000;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CardTextItem {
  id: string | number;
  content: string;
  /** Parent keyword IDs for search opacity propagation (TopicsView) */
  parentIds?: string[];
}

export interface CardTextLabelsProps {
  /** Items to render — React state, triggers re-render on change */
  items: CardTextItem[];
  /**
   * Stable callback ref returning the current world position for item at index.
   * Parent updates the function body (not the ref itself) when position source changes.
   * Called in useFrame — must be cheap (reads from refs, no allocations).
   */
  getPosition: MutableRefObject<(index: number) => { x: number; y: number }>;
  /** Screen rects keyed by item.id, updated each frame by parent */
  screenRectsRef: MutableRefObject<Map<string | number, ScreenRect>>;
  /** Max text wrap width (geometry units, matches card width) */
  textMaxWidth: number;
  /** Horizontal margin as fraction of card width (default 0.12) */
  hMarginRatio?: number;
  /** Vertical margin as fraction of card height (default 0.12) */
  vMarginRatio?: number;
  /** Distance LOD cap — show nearest N labels to camera center */
  maxVisible?: number;
  /** External visibility filter — show only labels whose item.id is in this Set */
  visibleIdsRef?: MutableRefObject<Set<string | number>>;
  /** Search result opacities, keyed by item.id (TopicsView) */
  searchOpacities?: Map<string, number>;
  /** Enable zoom-based opacity fade (TopicsView) */
  enableZoomFade?: boolean;
  /** Base font size used for zoom-fade pixel-size calculation */
  baseFontSize?: number;
  zoomRange?: ZoomRange;
  /**
   * Fixed world Z for text group. If absent, screenRect.z is used.
   * TopicsView passes textFrontZ; ChunksView relies on per-card screenRect.z.
   */
  textZ?: number;
  /**
   * Show all markdown blocks instead of only the primary (first) block.
   * Use in ChunksView where cards are large enough to show full content.
   * Default false (TopicsView preview behavior).
   */
  showAllBlocks?: boolean;
  /**
   * Called once per item when its text geometry is first built, with the measured
   * text height in geometry units (planeBounds.max.y - min.y). Use this to size
   * cards from actual layout rather than a character-count prediction.
   */
  onItemGeomHeight?: (index: number, textGeomHeight: number) => void;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface LabelPreview {
  text: string;
  fontSize: number;
  lineHeight: number;
  fontUrl: string;
  baseColor: string;
  colorRanges: { start: number; end: number; color: string }[];
}

interface CardLabelRegistration {
  group: THREE.Group | null;
  textMesh: THREE.Mesh | null;
  material: THREE.MeshBasicMaterial;
  geometryWidth: number;
  planeBounds: { min: { x: number; y: number }; max: { x: number; y: number } };
  clippingUpdater: ClippingPlaneUpdater;
}

// ---------------------------------------------------------------------------
// Outer component
// ---------------------------------------------------------------------------

export function CardTextLabels({
  items,
  getPosition,
  screenRectsRef,
  textMaxWidth,
  hMarginRatio = DEFAULT_H_MARGIN_RATIO,
  vMarginRatio = CARD_V_MARGIN_RATIO,
  maxVisible,
  visibleIdsRef,
  searchOpacities,
  enableZoomFade = false,
  baseFontSize = DEFAULT_BASE_FONT_SIZE,
  textZ,
  showAllBlocks = false,
  onItemGeomHeight,
}: CardTextLabelsProps) {
  const { camera, size, gl } = useThree();
  const labelRegistry = useRef(new Map<number, CardLabelRegistration>());

  // Enable local clipping planes on the renderer
  useEffect(() => {
    gl.localClippingEnabled = true;
  }, [gl]);

  const contentColors = useMemo(() => readContentTextColors(), []);

  // Build LabelPreview per item (text + color ranges for geometry)
  const labelPreviews = useMemo(
    () => items.map((item) => buildLabelPreview(item.content, baseFontSize, contentColors, showAllBlocks)),
    [items, baseFontSize, contentColors, showAllBlocks]
  );

  // Visible indices — updated each frame imperatively; React re-renders only when set changes
  const [visibleIndices, setVisibleIndices] = useState<number[]>([]);
  const prevVisibleSetRef = useRef(new Set<number>());

  // Reusable scratch for projection
  const tempVec = useMemo(() => new THREE.Vector3(), []);
  const cameraPos = useMemo(() => new THREE.Vector3(), []);

  // Stable ref for searchOpacities so useFrame always reads current value
  const searchOpacitiesRef = useRef(searchOpacities);
  searchOpacitiesRef.current = searchOpacities;

  useFrame(() => {
    const n = items.length;
    if (n === 0) return;

    // ---- Determine visible indices ----
    let newVisible: number[];

    if (maxVisible !== undefined) {
      // Distance-LOD: nearest maxVisible items to camera center
      const cameraCenterX = camera.position.x;
      const cameraCenterY = camera.position.y;
      const ranked: { index: number; dist: number }[] = [];
      for (let i = 0; i < n; i++) {
        const pos = getPosition.current(i);
        tempVec.set(pos.x, pos.y, 0);
        tempVec.project(camera);
        // Skip items outside viewport (with margin for partially visible cards)
        if (tempVec.x < -1.3 || tempVec.x > 1.3 || tempVec.y < -1.3 || tempVec.y > 1.3) continue;
        const dx = pos.x - cameraCenterX;
        const dy = pos.y - cameraCenterY;
        ranked.push({ index: i, dist: dx * dx + dy * dy });
      }
      ranked.sort((a, b) => a.dist - b.dist);
      newVisible = ranked.slice(0, maxVisible).map((r) => r.index);
    } else if (visibleIdsRef) {
      // External set filter (TopicsView)
      const vIds = visibleIdsRef.current;
      newVisible = [];
      for (let i = 0; i < n; i++) {
        if (vIds.has(items[i].id)) newVisible.push(i);
      }
    } else {
      // All items
      newVisible = Array.from({ length: n }, (_, i) => i);
    }

    // Only trigger React re-render if visible set actually changed
    const newSet = new Set(newVisible);
    const prev = prevVisibleSetRef.current;
    if (newSet.size !== prev.size || newVisible.some((i) => !prev.has(i))) {
      prevVisibleSetRef.current = newSet;
      setVisibleIndices(newVisible);
    }

    // ---- Update registered labels imperatively ----
    labelRegistry.current.forEach((entry, index) => {
      const { group, textMesh, material, geometryWidth, planeBounds, clippingUpdater } = entry;
      if (!group) return;

      const isVisible = newSet.has(index);
      if (!isVisible) {
        group.visible = false;
        return;
      }

      const item = items[index];
      if (!item) { group.visible = false; return; }

      const screenRect = screenRectsRef.current.get(item.id);
      if (!screenRect || screenRect.width < MIN_SCREEN_WIDTH_PX) {
        group.visible = false;
        return;
      }

      const pos = getPosition.current(index);
      const z = textZ ?? screenRect.z;
      group.position.set(pos.x, pos.y, z);

      // Screen-space scaling: text fills usable card width
      const worldPosition = group.getWorldPosition(tempVec);
      const unitsPerPixel = computeUnitsPerPixel(camera, size, worldPosition, cameraPos);
      const usableScreenWidth = screenRect.width * (1 - 2 * hMarginRatio);
      const targetScale = (usableScreenWidth * unitsPerPixel) / (geometryWidth > 0 ? geometryWidth : 1);
      group.scale.setScalar(targetScale);

      // Layout: center horizontally, top-aligned with vertical margin.
      // Use worldHalfHeight (exact world units) instead of screenRect.height * unitsPerPixel:
      // the tangent-based unitsPerPixel diverges from projection-based screenRect.height for
      // off-axis cards, causing clip planes and offsetY to be slightly wrong.
      const worldHeight = screenRect.worldHalfHeight * 2;
      if (textMesh) {
        const { min, max } = planeBounds;
        const offsetX = -(min.x + max.x) / 2;
        const localCardHeight = worldHeight / targetScale;
        const offsetY = localCardHeight / 2 * (1 - 2 * vMarginRatio) - max.y;
        textMesh.position.set(offsetX, offsetY, 0);
      }

      // Clip text at card bottom
      clippingUpdater.setBottomClip(pos.y, worldHeight);

      // Opacity
      let opacity = 1;
      if (enableZoomFade) {
        const pixelSize = (baseFontSize * targetScale) / unitsPerPixel;
        opacity *= 1 - smoothstep((pixelSize - FADE_START_PX) / (FADE_END_PX - FADE_START_PX));
      }
      const searchOps = searchOpacitiesRef.current;
      if (searchOps && searchOps.size > 0) {
        const ownOp = searchOps.get(item.id as string) ?? 1;
        let parentOp = 1;
        if (item.parentIds && item.parentIds.length > 0) {
          for (const pid of item.parentIds) parentOp = Math.max(parentOp, searchOps.get(pid) ?? 1);
        }
        opacity *= ownOp * parentOp;
      }

      const clamped = THREE.MathUtils.clamp(opacity, 0, 1);
      if (Math.abs(material.opacity - clamped) > 0.01) {
        material.opacity = clamped;
        material.needsUpdate = true;
      }
      group.visible = clamped > 0.02;
    });
  });

  const registerLabel = useCallback((index: number, reg: CardLabelRegistration | null) => {
    if (reg) labelRegistry.current.set(index, reg);
    else labelRegistry.current.delete(index);
  }, []);

  if (visibleIndices.length === 0) return null;

  return (
    <>
      {visibleIndices.map((index) => {
        const preview = labelPreviews[index];
        if (!preview) return null;
        return (
          <CardTextLabel
            key={index}
            index={index}
            preview={preview}
            maxWidth={textMaxWidth}
            registerLabel={registerLabel}
            onItemGeomHeight={onItemGeomHeight}
          />
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Inner per-label component
// ---------------------------------------------------------------------------

interface CardTextLabelProps {
  index: number;
  preview: LabelPreview;
  maxWidth: number;
  registerLabel: (index: number, reg: CardLabelRegistration | null) => void;
  onItemGeomHeight?: (index: number, textGeomHeight: number) => void;
}

function CardTextLabel({ index, preview, maxWidth, registerLabel, onItemGeomHeight }: CardTextLabelProps) {
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
  const textMeshRef = useRef<THREE.Mesh>(null);
  const registrationRef = useRef<CardLabelRegistration | null>(null);

  const [clippingPlane, clippingUpdater] = useTextClippingPlane();

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        // Markdown geometry always has vertex colors; material color is white so vertex colors show through
        color: new THREE.Color(1, 1, 1),
        transparent: true,
        toneMapped: false,
        depthTest: true,
        depthWrite: false,
        opacity: 0,
        vertexColors: true,
        clippingPlanes: [clippingPlane],
      }),
    [clippingPlane]
  );

  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    if (!geometryEntry) {
      registerLabel(index, null);
      registrationRef.current = null;
      return;
    }
    const { min, max } = geometryEntry.planeBounds;
    const geometryWidth = Math.max(1e-3, max.x - min.x);
    const reg: CardLabelRegistration = {
      group: groupRef.current,
      textMesh: textMeshRef.current,
      material,
      geometryWidth,
      planeBounds: { min: { x: min.x, y: min.y }, max: { x: max.x, y: max.y } },
      clippingUpdater,
    };
    registrationRef.current = reg;
    registerLabel(index, reg);
    onItemGeomHeight?.(index, max.y - min.y);
    return () => {
      registerLabel(index, null);
      registrationRef.current = null;
    };
  }, [geometryEntry, index, material, clippingUpdater, registerLabel, onItemGeomHeight]);

  const setGroupRef = useCallback((instance: THREE.Group | null) => {
    groupRef.current = instance;
    if (registrationRef.current) registrationRef.current.group = instance;
  }, []);

  const setTextMeshRef = useCallback((instance: THREE.Mesh | null) => {
    textMeshRef.current = instance;
    if (registrationRef.current) registrationRef.current.textMesh = instance;
  }, []);

  if (!geometryEntry) return null;

  return (
    <group ref={setGroupRef} visible={false}>
      <mesh
        ref={setTextMeshRef}
        geometry={geometryEntry.geometry}
        material={material}
        position={[0, 0, 0]}
        frustumCulled={false}
        renderOrder={1}
      />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Text preparation (markdown → LabelPreview)
// ---------------------------------------------------------------------------

function buildLabelPreview(
  content: string,
  baseFontSize: number,
  colors: ContentTextColors,
  showAllBlocks = false,
): LabelPreview | null {
  if (!content) return null;
  const segments = renderMarkdownToSegments(content, colors);
  const normalized = normalizeSegments(segments, colors.text, baseFontSize);
  const block = showAllBlocks
    ? normalized.filter((s) => !s.blockBoundary)
    : pickPrimaryBlock(normalized);
  if (!block || block.length === 0) return null;

  const text = block.map((s) => s.text ?? "").join("");
  if (text.trim().length === 0) return null;

  const baseSegment = block.find((s) => (s.text ?? "").trim().length > 0) ?? block[0];
  const baseColor = baseSegment.color ?? colors.text;
  const fontSize = baseSegment.fontSize ?? baseFontSize;
  const lineHeight = baseSegment.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const fontUrl = resolveFont(baseSegment);
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

function normalizeSegments(
  segments: MarkdownSegment[],
  fallbackColor: string,
  baseFontSize: number
): MarkdownSegment[] {
  // Scale all font sizes so MARKDOWN_REFERENCE_FONT_SIZE maps to baseFontSize.
  // This makes textMaxWidth and baseFontSize compatible regardless of the
  // font sizes the markdown renderer uses internally.
  const fontScale = baseFontSize / MARKDOWN_REFERENCE_FONT_SIZE;
  const trimmed = [...segments];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1]?.text === "\n") {
    trimmed.pop();
  }
  return trimmed.map((s) => ({
    ...s,
    color: s.color ?? fallbackColor,
    fontSize: (s.fontSize ?? MARKDOWN_REFERENCE_FONT_SIZE) * fontScale,
    lineHeight: s.lineHeight ?? DEFAULT_LINE_HEIGHT,
  }));
}

function pickPrimaryBlock(segments: MarkdownSegment[]): MarkdownSegment[] | null {
  const blocks: MarkdownSegment[][] = [];
  let current: MarkdownSegment[] = [];
  const flush = () => { if (current.length > 0) { blocks.push(current); current = []; } };
  for (const s of segments) {
    if (s.blockBoundary) { flush(); continue; }
    current.push(s);
  }
  flush();
  return blocks.find((b) => b.some((s) => (s.text ?? "").trim().length > 0)) ?? null;
}

function buildColorRanges(
  segments: MarkdownSegment[],
  baseColor: string
): { start: number; end: number; color: string }[] {
  const ranges: { start: number; end: number; color: string }[] = [];
  let cursor = 0;
  for (const s of segments) {
    const text = s.text ?? "";
    if (text.length === 0) continue;
    const start = cursor;
    cursor += text.length;
    const color = s.color ?? baseColor;
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
  if (text.length <= limit) return { text, ranges };
  const sliced = text.slice(0, limit);
  const finalText = `${sliced.replace(/\s+\S*$/, "")}…`;
  const finalLength = finalText.length;
  return {
    text: finalText,
    ranges: ranges
      .map((r) => ({ ...r, start: Math.min(r.start, finalLength), end: Math.min(r.end, finalLength) }))
      .filter((r) => r.start < r.end),
  };
}

function resolveFont(segment: MarkdownSegment): string {
  if (segment.fontFamily?.toLowerCase().includes("mono")) return FONT_URL_REGULAR;
  if (segment.fontWeight === "700") return FONT_URL_BOLD;
  return FONT_URL_REGULAR;
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
  while (components.length < 3) components.push(255);
  return [components[0] / 255, components[1] / 255, components[2] / 255];
}

function buildColorOption(
  preview: LabelPreview
): [number, number, number] | ColorOptions {
  const base = hexToRgbArray(preview.baseColor);
  if (!preview.colorRanges || preview.colorRanges.length === 0) return base;
  return {
    default: base,
    byCharRange: preview.colorRanges.map((r) => ({
      start: r.start,
      end: r.end,
      color: hexToRgbArray(r.color),
    })),
  };
}
