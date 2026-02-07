import { useEffect, useMemo, useState } from "react";
import { Text } from "three-text/three";
import type { ThreeTextGeometryInfo } from "three-text/three";
import * as THREE from "three";
import { ensureThreeTextInitialized } from "@/lib/three-text-config";

export interface ThreeTextGeometryEntry {
  geometry: THREE.BufferGeometry;
  planeBounds: ThreeTextGeometryInfo["planeBounds"];
}

export interface ThreeTextGeometryOptions {
  text: string;
  fontUrl?: string;
  fontSize: number;
  lineHeight?: number;
  letterSpacing?: number;
  maxWidth?: number;
  hyphenate?: boolean;
}

const DEFAULT_FONT_URL = "/fonts/source-code-pro-regular.woff2";
const DEFAULT_LINE_HEIGHT = 1.1;
const geometryCache = new Map<string, ThreeTextGeometryEntry>();

function buildCacheKey(options: Required<Omit<ThreeTextGeometryOptions, "text">> & { text: string }) {
  const { fontUrl, fontSize, lineHeight, letterSpacing, maxWidth, hyphenate, text } = options;
  const widthKey = maxWidth ?? "auto";
  const hyphenateKey = hyphenate === undefined ? "auto" : String(hyphenate);
  return `${fontUrl}::${fontSize}::${lineHeight}::${letterSpacing}::${widthKey}::${hyphenateKey}::${text}`;
}

export function useThreeTextGeometry(
  options: ThreeTextGeometryOptions
): ThreeTextGeometryEntry | null {
  const normalized = useMemo(
    () => ({
      text: options.text,
      fontUrl: options.fontUrl ?? DEFAULT_FONT_URL,
      fontSize: options.fontSize,
      lineHeight: options.lineHeight ?? DEFAULT_LINE_HEIGHT,
      letterSpacing: options.letterSpacing ?? 0,
      maxWidth: options.maxWidth,
      hyphenate: options.hyphenate,
    }),
    [
      options.fontUrl,
      options.fontSize,
      options.lineHeight,
      options.letterSpacing,
      options.maxWidth,
      options.hyphenate,
      options.text,
    ]
  );

  const cacheKey = useMemo(() => buildCacheKey(normalized), [normalized]);
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

    Text.create({
      text: normalized.text,
      font: normalized.fontUrl,
      size: normalized.fontSize,
      lineHeight: normalized.lineHeight,
      letterSpacing: normalized.letterSpacing,
      color: [1, 1, 1],
      layout: layoutOption,
    })
      .then((result) => {
        if (cancelled) {
          result.geometry.dispose();
          return;
        }
        const newEntry: ThreeTextGeometryEntry = {
          geometry: result.geometry,
          planeBounds: result.planeBounds,
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
