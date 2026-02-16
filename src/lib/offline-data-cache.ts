/**
 * In-memory cache for offline JSON files.
 * Preloads all files on server startup for instant access.
 */

import fs from "fs/promises";
import path from "path";

const OFFLINE_DIR = path.join(process.cwd(), "data", "offline-cache");

// In-memory cache
const cache = new Map<string, any>();
let isLoaded = false;
let loadPromise: Promise<void> | null = null;

/**
 * Preload all JSON files from offline-cache directory into memory.
 * Safe to call multiple times - only loads once.
 */
export async function preloadOfflineData(): Promise<void> {
  if (isLoaded) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const files = await fs.readdir(OFFLINE_DIR);
      const jsonFiles = files.filter((f) => f.endsWith(".json"));

      console.log(`[Offline Cache] Preloading ${jsonFiles.length} files...`);

      await Promise.all(
        jsonFiles.map(async (filename) => {
          try {
            const filepath = path.join(OFFLINE_DIR, filename);
            const content = await fs.readFile(filepath, "utf-8");
            cache.set(filename, JSON.parse(content));
          } catch (err) {
            console.warn(`[Offline Cache] Failed to load ${filename}:`, err);
          }
        })
      );

      isLoaded = true;
      console.log(`[Offline Cache] Loaded ${cache.size} files into memory`);
    } catch (err) {
      console.warn("[Offline Cache] Directory not found or empty:", err);
      isLoaded = true; // Mark as loaded to avoid repeated attempts
    }
  })();

  return loadPromise;
}

/**
 * Get cached offline data by filename.
 * Returns null if not in cache.
 */
export function getCachedOfflineData<T = any>(filename: string): T | null {
  return cache.get(filename) ?? null;
}

/**
 * Check if offline data is available.
 */
export function hasOfflineData(filename: string): boolean {
  return cache.has(filename);
}

/**
 * Get all cached filenames.
 */
export function getCachedFilenames(): string[] {
  return Array.from(cache.keys());
}

// Auto-preload on module import (server startup)
if (typeof window === "undefined") {
  preloadOfflineData().catch((err) => {
    console.error("[Offline Cache] Preload failed:", err);
  });
}
