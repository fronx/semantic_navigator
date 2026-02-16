/**
 * Utility functions for serving data from local JSON files (offline mode).
 * Falls back to API when local files aren't available.
 */

import fs from "fs/promises";
import path from "path";

const OFFLINE_DIR = path.join(process.cwd(), "data", "offline-cache");

export async function loadOfflineJSON<T>(filename: string): Promise<T | null> {
  try {
    const filepath = path.join(OFFLINE_DIR, filename);
    const content = await fs.readFile(filepath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export async function hasOfflineData(filename: string): Promise<boolean> {
  try {
    const filepath = path.join(OFFLINE_DIR, filename);
    await fs.access(filepath);
    return true;
  } catch {
    return false;
  }
}
