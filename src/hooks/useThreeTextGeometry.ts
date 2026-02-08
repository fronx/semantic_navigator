import { useEffect, useMemo, useState } from "react";
import { Text } from "three-text/three";
import type { ThreeTextGeometryInfo } from "three-text/three";
import type { ColorOptions } from "three-text/dist/core/types";
import * as THREE from "three";
import { ensureThreeTextInitialized } from "@/lib/three-text-config";
import { loadThreeTextFont } from "@/lib/three-text-fonts";

export interface ThreeTextGeometryEntry {
  geometry: THREE.BufferGeometry;
  planeBounds: ThreeTextGeometryInfo["planeBounds"];
  hasVertexColors: boolean;
}

export interface ThreeTextGeometryOptions {
  text: string;
  fontUrl?: string;
  fontSize: number;
  lineHeight?: number;
  letterSpacing?: number;
  maxWidth?: number;
  hyphenate?: boolean;
  color?: [number, number, number] | ColorOptions;
}

const DEFAULT_FONT_URL = "/fonts/source-code-pro-regular.woff2";
const DEFAULT_LINE_HEIGHT = 1.1;
const geometryCache = new Map<string, ThreeTextGeometryEntry>();

function serializeColorOptions(value: [number, number, number] | ColorOptions | undefined): string {
  if (!value) return "none";
  if (Array.isArray(value)) {
    return `rgb(${value.map((v) => v.toFixed(4)).join(",")})`;
  }
  return stableSerialize(value);
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableSerialize(val)}`).join(",")}}`;
}

function buildCacheKey(options: {
  text: string;
  fontUrl: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  maxWidth?: number;
  hyphenate?: boolean;
  colorKey: string;
}) {
  const { fontUrl, fontSize, lineHeight, letterSpacing, maxWidth, hyphenate, text, colorKey } = options;
  const widthKey = maxWidth ?? "auto";
  const hyphenateKey = hyphenate === undefined ? "auto" : String(hyphenate);
  return `${fontUrl}::${fontSize}::${lineHeight}::${letterSpacing}::${widthKey}::${hyphenateKey}::${colorKey}::${text}`;
}

export function useThreeTextGeometry(
  options: ThreeTextGeometryOptions
): ThreeTextGeometryEntry | null {
  const colorSignature = useMemo(() => serializeColorOptions(options.color), [options.color]);

  const normalized = useMemo(
    () => ({
      text: options.text,
      fontUrl: options.fontUrl ?? DEFAULT_FONT_URL,
      fontSize: options.fontSize,
      lineHeight: options.lineHeight ?? DEFAULT_LINE_HEIGHT,
      letterSpacing: options.letterSpacing ?? 0,
      maxWidth: options.maxWidth,
      hyphenate: options.hyphenate,
      color: options.color,
      colorSignature,
    }),
    [
      options.fontUrl,
      options.fontSize,
      options.lineHeight,
      options.letterSpacing,
      options.maxWidth,
      options.hyphenate,
      options.text,
      colorSignature,
      options.color,
    ]
  );

  const cacheKey = useMemo(() => buildCacheKey({ ...normalized, colorKey: normalized.colorSignature }), [normalized]);
  const [entry, setEntry] = useState<ThreeTextGeometryEntry | null>(() => geometryCache.get(cacheKey) ?? null);

  useEffect(() => {
    if (geometryCache.has(cacheKey)) {
      setEntry(geometryCache.get(cacheKey)!);
      return;
    }

    if (typeof window === "undefined") {
      setEntry(null);
      return;
    }

    let cancelled = false;
    ensureThreeTextInitialized();

    const layout: Record<string, unknown> = {};
    if (normalized.maxWidth !== undefined) layout.width = normalized.maxWidth;
    if (normalized.hyphenate !== undefined) layout.hyphenate = normalized.hyphenate;
    const layoutOption = Object.keys(layout).length > 0 ? layout : undefined;

    loadThreeTextFont(normalized.fontUrl)
      .then((fontBuffer) =>
        Text.create({
          text: normalized.text,
          font: fontBuffer,
          size: normalized.fontSize,
          lineHeight: normalized.lineHeight,
          letterSpacing: normalized.letterSpacing,
          color: normalized.color ?? [1, 1, 1],
          layout: layoutOption,
        })
      )
      .then((result) => {
        if (cancelled) {
          result.geometry.dispose();
          return;
        }
        const newEntry: ThreeTextGeometryEntry = {
          geometry: result.geometry,
          planeBounds: result.planeBounds,
          hasVertexColors: Boolean(result.geometry.getAttribute("color")),
        };
        geometryCache.set(cacheKey, newEntry);
        setEntry(newEntry);
      })
      .catch((error) => {
        console.error("Failed to create three-text geometry", error);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, normalized]);

  return entry;
}
