/**
 * Download all data needed for offline use to local JSON files.
 * Run with: npm run script scripts/download-offline-data.ts
 *
 * Downloads:
 * - Topics data (keywords + edges)
 * - Chunks data (embeddings)
 * - Keywords data (keyword-chunk associations)
 * - Projects data
 */

import fs from "fs/promises";
import path from "path";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
const OUTPUT_DIR = path.join(process.cwd(), "data", "offline-cache");

interface DownloadResult {
  file: string;
  size: number;
  recordCount?: number;
}

async function downloadJSON(url: string, filename: string): Promise<DownloadResult> {
  console.log(`Fetching ${url}...`);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  }

  const data = await response.json();
  const json = JSON.stringify(data, null, 2);
  const filepath = path.join(OUTPUT_DIR, filename);

  await fs.writeFile(filepath, json, "utf-8");

  const size = Buffer.byteLength(json);
  const recordCount = Array.isArray(data)
    ? data.length
    : data.nodes?.length || data.chunks?.length || undefined;

  console.log(`✓ Saved ${filename} (${(size / 1024).toFixed(1)} KB${recordCount ? `, ${recordCount} records` : ""})`);

  return { file: filename, size, recordCount };
}

async function main() {
  console.log("Downloading offline data...\n");

  // Ensure output directory exists
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const results: DownloadResult[] = [];

  try {
    // Download topics data (keywords + edges) for both article and chunk modes
    results.push(
      await downloadJSON(`${BASE_URL}/api/topics?nodeType=chunk`, "topics-chunk.json")
    );
    results.push(
      await downloadJSON(`${BASE_URL}/api/topics?nodeType=article`, "topics-article.json")
    );

    // Download chunks embeddings
    results.push(
      await downloadJSON(`${BASE_URL}/api/chunks/embeddings`, "chunks-embeddings.json")
    );

    // Download projects
    results.push(
      await downloadJSON(`${BASE_URL}/api/projects`, "projects.json")
    );

    // Download precomputed clusters for common resolutions
    const resolutions = [0.1, 0.3, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0];
    for (const resolution of resolutions) {
      for (const nodeType of ["chunk", "article"]) {
        const response = await fetch(`${BASE_URL}/api/precomputed-clusters`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resolution, nodeType }),
        });

        if (response.ok) {
          const data = await response.json();
          const filename = `clusters-${nodeType}-${resolution}.json`;
          const json = JSON.stringify(data, null, 2);
          await fs.writeFile(path.join(OUTPUT_DIR, filename), json, "utf-8");
          const size = Buffer.byteLength(json);
          results.push({ file: filename, size });
          console.log(`✓ Saved ${filename} (${(size / 1024).toFixed(1)} KB)`);
        }
      }
    }

    // Write manifest
    const manifest = {
      timestamp: new Date().toISOString(),
      files: results,
      totalSize: results.reduce((sum, r) => sum + r.size, 0),
    };

    await fs.writeFile(
      path.join(OUTPUT_DIR, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8"
    );

    console.log("\n✓ Download complete!");
    console.log(`Total size: ${(manifest.totalSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Location: ${OUTPUT_DIR}`);
  } catch (error) {
    console.error("\n✗ Error downloading data:", error);
    process.exit(1);
  }
}

main();
